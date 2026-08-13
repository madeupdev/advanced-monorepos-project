import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../api/src/app/app.module";
import { configureApi } from "../../api/src/app/configure-api";
import {
  disconnectTestDatabase,
  resetTestDatabase,
} from "../../../tests/helpers/database";

describe("title catalogue API", () => {
  let app: INestApplication | undefined;

  beforeEach(resetTestDatabase);

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(disconnectTestDatabase);

  it("lists the seeded catalogue with grouped availability", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/titles`);

    expect(response.status).toBe(200);

    const { titlesResponseSchema } = await import("@madeup-video/contracts");
    const body = titlesResponseSchema.parse(await response.json());

    expect(body.titles).toHaveLength(6);
    expect(body.titles).toContainEqual(
      expect.objectContaining({
        name: "Midnight Rewind",
        availableCopies: 3,
        totalCopies: 3,
      }),
    );
  });
});
