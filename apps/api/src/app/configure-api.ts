import type { INestApplication } from "@nestjs/common";

const defaultStorefrontOrigin = "http://127.0.0.1:3100";

export function configureApi(app: INestApplication): INestApplication {
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.STOREFRONT_URL ?? defaultStorefrontOrigin,
  });

  return app;
}
