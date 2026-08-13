import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { TitlesController } from "./titles.controller";

@Module({
  imports: [],
  controllers: [HealthController, TitlesController],
  providers: [],
})
export class AppModule {}
