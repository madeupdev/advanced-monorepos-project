import type { INestApplication } from "@nestjs/common";

const defaultStorefrontOrigin = "http://localhost:3000";

export function configureApi(app: INestApplication): INestApplication {
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.STOREFRONT_URL ?? defaultStorefrontOrigin,
  });

  return app;
}
