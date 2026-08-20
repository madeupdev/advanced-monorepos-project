import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../api/src/app/app.module";
import { configureApi } from "../../api/src/app/configure-api";
import {
  disconnectTestDatabase,
  resetTestDatabase,
} from "../../../tests/helpers/database";
import { parseOldTitlesResponse } from "./fixtures/old-title-consumer";

describe("title contract deployment compatibility", () => {
  let app: INestApplication | undefined;

  beforeEach(resetTestDatabase);

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(disconnectTestDatabase);

  it("continues to support an old flat-availability consumer", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/titles`);

    expect(response.status).toBe(200);
    const titles = parseOldTitlesResponse(await response.json());
    expect(titles[0]).toEqual({
      id: "title-midnight-rewind",
      availableCopies: 3,
      totalCopies: 3,
    });
  });

  it("serves grouped availability to the current consumer", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/titles`);
    const { titlesResponseSchema } = await import("@madeup-video/contracts");
    const body = titlesResponseSchema.parse(await response.json());

    expect(body.titles[0]?.availability).toEqual({
      available: 3,
      total: 3,
    });
  });
});
