import { z } from 'zod';

type PublicEnvironment = {
  VITE_API_URL?: string;
};

const apiOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    } catch {
      return false;
    }
  });

export function readAdminBrowserConfig(
  environment: PublicEnvironment = { VITE_API_URL: import.meta.env.VITE_API_URL },
) {
  const rawValue = environment.VITE_API_URL ?? 'http://127.0.0.1:3333';
  const result = apiOriginSchema.safeParse(rawValue);

  if (!result.success) {
    throw new Error('VITE_API_URL must be a valid HTTP URL containing only an origin.');
  }

  return { apiOrigin: new URL(result.data).origin };
}
