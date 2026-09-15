import { z } from "zod";

type Environment = Record<string, string | undefined>;

const portSchema = (name: string, fallback: number) =>
  z.coerce
    .number({ error: `${name} must be an integer from 1 through 65535.` })
    .int(`${name} must be an integer from 1 through 65535.`)
    .min(1, `${name} must be an integer from 1 through 65535.`)
    .max(65_535, `${name} must be an integer from 1 through 65535.`)
    .default(fallback);

const environmentSchema = z.object({
  API_PORT: portSchema("API_PORT", 3333),
  STOREFRONT_PORT: portSchema("STOREFRONT_PORT", 3000),
  ADMIN_PORT: portSchema("ADMIN_PORT", 3200),
  STOREFRONT_URL: z.string().optional(),
  ADMIN_URL: z.string().optional(),
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid URL."),
});

function readHttpOrigin(name: string, value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP URL containing only an origin.`);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be a valid HTTP URL containing only an origin.`);
  }

  return url.origin;
}

function effectivePort(origin: string): number {
  const url = new URL(origin);
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

function formatConfigurationError(error: z.ZodError): Error {
  return new Error(
    `Invalid API configuration: ${error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`,
  );
}

export type ApiConfig = {
  port: number;
  apiOrigin: string;
  storefrontOrigin: string;
  adminOrigin: string;
  databaseUrl: string;
};

export function readApiConfig(environment: Environment = process.env): ApiConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw formatConfigurationError(result.error);
  }

  const databaseUrlValue = new URL(result.data.DATABASE_URL);
  const databaseProtocol = databaseUrlValue.protocol;

  if (!["postgres:", "postgresql:"].includes(databaseProtocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL beginning with postgresql:// or postgres://.");
  }

  if (!databaseUrlValue.hostname || !databaseUrlValue.pathname.slice(1)) {
    throw new Error("DATABASE_URL must include a PostgreSQL host and database name.");
  }

  const {
    API_PORT: port,
    STOREFRONT_PORT: storefrontPort,
    ADMIN_PORT: adminPort,
    DATABASE_URL: databaseUrl,
  } = result.data;
  const apiOrigin = `http://127.0.0.1:${port}`;
  const storefrontOrigin = readHttpOrigin(
    "STOREFRONT_URL",
    result.data.STOREFRONT_URL ?? `http://localhost:${storefrontPort}`,
  );
  const adminOrigin = readHttpOrigin(
    "ADMIN_URL",
    result.data.ADMIN_URL ?? `http://127.0.0.1:${adminPort}`,
  );

  for (const [name, origin, expectedPort] of [
    ["STOREFRONT_URL", storefrontOrigin, storefrontPort],
    ["ADMIN_URL", adminOrigin, adminPort],
  ] as const) {
    if (effectivePort(origin) !== expectedPort) {
      throw new Error(`${name} must use the port selected by ${name.replace("URL", "PORT")}.`);
    }
  }

  for (const [leftName, leftPort, rightName, rightPort] of [
    ["API_PORT", port, "STOREFRONT_PORT", storefrontPort],
    ["API_PORT", port, "ADMIN_PORT", adminPort],
    ["STOREFRONT_PORT", storefrontPort, "ADMIN_PORT", adminPort],
  ] as const) {
    if (leftPort === rightPort) {
      throw new Error(`${leftName} and ${rightName} both resolve to ${leftPort}; application ports must be unique.`);
    }
  }

  return { port, apiOrigin, storefrontOrigin, adminOrigin, databaseUrl };
}
