import { Controller, Get } from "@nestjs/common";
import type { TitlesResponse } from "@madeup-video/contracts";
import { listTitles } from "@madeup-video/database";

@Controller("titles")
export class TitlesController {
  @Get()
  async listTitles(): Promise<TitlesResponse> {
    return { titles: await listTitles() };
  }
}
