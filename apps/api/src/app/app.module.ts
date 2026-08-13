import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { RentalsController } from "./rentals.controller";
import { TitlesController } from "./titles.controller";

@Module({
  imports: [],
  controllers: [HealthController, TitlesController, RentalsController],
  providers: [],
})
export class AppModule {}
