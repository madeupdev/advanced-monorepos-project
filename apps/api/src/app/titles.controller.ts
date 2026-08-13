import { Controller, Get, HttpException, HttpStatus, Param } from "@nestjs/common";
import type { TitleResponse, TitlesResponse } from "@madeup-video/contracts";
import { getTitleById, listTitles } from "@madeup-video/database";

@Controller("titles")
export class TitlesController {
  @Get()
  async listTitles(): Promise<TitlesResponse> {
    return { titles: await listTitles() };
  }

  @Get(":id")
  async getTitle(@Param("id") id: string): Promise<TitleResponse> {
    const title = await getTitleById(id);

    if (!title) {
      throw new HttpException(
        {
          error: {
            code: "TITLE_NOT_FOUND",
            message: "That title could not be found.",
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return { title };
  }
}
