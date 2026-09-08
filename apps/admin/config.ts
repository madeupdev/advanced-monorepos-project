import { z } from 'zod';

type Environment = Record<string, string | undefined>;

const portSchema = (name: string, fallback: number) =>
  z.coerce
    .number({ error: `${name} must be an integer from 1 through 65535.` })
    .int(`${name} must be an integer from 1 through 65535.`)
    .min(1, `${name} must be an integer from 1 through 65535.`)
    .max(65_535, `${name} must be an integer from 1 through 65535.`)
    .default(fallback);

const environmentSchema = z.object({
  API_PORT: portSchema('API_PORT', 3333),
  ADMIN_PORT: portSchema('ADMIN_PORT', 3200),
  API_URL: z.string().optional(),
  VITE_API_URL: z.string().optional(),
});

function readHttpOrigin(name: string, value: string): string {
  const result = z.string().url().safeParse(value);

  if (!result.success) {
    throw new Error(`${name} must be a valid HTTP URL containing only an origin.`);
  }

  const url = new URL(result.data);

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be a valid HTTP URL containing only an origin.`);
  }

  return url.origin;
}

export function readAdminDevelopmentConfig(environment: Environment = process.env) {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(
      `Invalid admin configuration: ${result.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; ')}`,
    );
  }

  const { API_PORT: apiPort, ADMIN_PORT: adminPort } = result.data;
  const defaultApiOrigin = `http://127.0.0.1:${apiPort}`;
  const apiOrigin = readHttpOrigin('API_URL', result.data.API_URL ?? defaultApiOrigin);
  const browserApiOrigin = readHttpOrigin(
    'VITE_API_URL',
    result.data.VITE_API_URL ?? 'http://127.0.0.1:3333',
  );

  if (apiOrigin !== browserApiOrigin) {
    throw new Error('API_URL and VITE_API_URL must match.');
  }

  const configuredApiPort = Number(new URL(apiOrigin).port || (new URL(apiOrigin).protocol === 'https:' ? 443 : 80));

  if (configuredApiPort !== apiPort) {
    throw new Error('API_URL and VITE_API_URL must use the port selected by API_PORT.');
  }

  if (apiPort === adminPort) {
    throw new Error(`API_PORT and ADMIN_PORT both resolve to ${apiPort}; application ports must be unique.`);
  }

  return {
    adminPort,
    adminOrigin: `http://127.0.0.1:${adminPort}`,
    apiOrigin,
    browserApiOrigin,
  };
}
