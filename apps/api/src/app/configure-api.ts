import type { INestApplication } from "@nestjs/common";
import { InvalidRentalJsonFilter } from "./invalid-rental-json.filter";

const defaultStorefrontOrigin = "http://localhost:3000";

export function configureApi(app: INestApplication): INestApplication {
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.STOREFRONT_URL ?? defaultStorefrontOrigin,
  });
  app.useGlobalFilters(new InvalidRentalJsonFilter());

  return app;
}
