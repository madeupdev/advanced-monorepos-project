import type { INestApplication } from "@nestjs/common";
import { readApiConfig, type ApiConfig } from "./config";
import { InvalidRentalJsonFilter } from "./invalid-rental-json.filter";

export function configureApi(
  app: INestApplication,
  config: Pick<ApiConfig, "storefrontOrigin" | "adminOrigin"> = readApiConfig(),
): INestApplication {
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: [config.storefrontOrigin, config.adminOrigin],
  });
  app.useGlobalFilters(new InvalidRentalJsonFilter());

  return app;
}
