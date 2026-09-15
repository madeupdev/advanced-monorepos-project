import { z } from "zod";

type Environment = Record<string, string | undefined>;

function readHttpOrigin(name: string, value: string | undefined, fallback: string): string {
  const rawValue = value ?? fallback;
  const result = z.string().url().safeParse(rawValue);

  if (!result.success) {
    throw new Error(`${name} must be a valid HTTP URL containing only an origin.`);
  }

  const url = new URL(result.data);

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

export function readStorefrontServerConfig(environment: Environment = process.env) {
  const apiPortResult = z.coerce.number().int().min(1).max(65_535).default(3333).safeParse(environment.API_PORT);
  const storefrontPortResult = z.coerce.number().int().min(1).max(65_535).default(3000).safeParse(environment.STOREFRONT_PORT);

  if (!apiPortResult.success) {
    throw new Error("API_PORT must be an integer from 1 through 65535.");
  }

  if (!storefrontPortResult.success) {
    throw new Error("STOREFRONT_PORT must be an integer from 1 through 65535.");
  }

  return {
    apiOrigin: readHttpOrigin(
      "API_URL",
      environment.API_URL,
      `http://127.0.0.1:${apiPortResult.data}`,
    ),
    port: storefrontPortResult.data,
  };
}

export function validateStorefrontConfiguration(environment: Environment = process.env) {
  const server = readStorefrontServerConfig(environment);
  const browserApiOrigin = readHttpOrigin(
    "NEXT_PUBLIC_API_URL",
    environment.NEXT_PUBLIC_API_URL,
    "http://127.0.0.1:3333",
  );

  if (server.apiOrigin !== browserApiOrigin) {
    throw new Error(
      "API_URL and NEXT_PUBLIC_API_URL must match.",
    );
  }

  const apiPortResult = z.coerce.number().int().min(1).max(65_535).default(3333).safeParse(environment.API_PORT);

  if (!apiPortResult.success) {
    throw new Error("API_PORT must be an integer from 1 through 65535.");
  }

  const apiUrl = new URL(server.apiOrigin);
  const configuredApiPort = Number(apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80));

  if (configuredApiPort !== apiPortResult.data) {
    throw new Error("API_URL and NEXT_PUBLIC_API_URL must use the port selected by API_PORT.");
  }

  return { ...server, browserApiOrigin };
}
