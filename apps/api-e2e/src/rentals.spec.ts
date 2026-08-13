import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { getDatabase } from "@madeup-video/database";

import { AppModule } from "../../api/src/app/app.module";
import { configureApi } from "../../api/src/app/configure-api";
import {
  disconnectTestDatabase,
  resetTestDatabase,
} from "../../../tests/helpers/database";

describe("rentals API", () => {
  let app: INestApplication | undefined;
  const database = getDatabase();

  beforeEach(resetTestDatabase);

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await database.$disconnect();
    await disconnectTestDatabase();
  });

  it("lists the exact active rental contract", async () => {
    await database.$transaction([
      database.physicalCopy.update({
        where: { id: "copy-midnight-rewind-1" },
        data: { status: "RENTED" },
      }),
      database.rental.create({
        data: {
          id: "rental-midnight-active",
          copyId: "copy-midnight-rewind-1",
          customerName: "Jamie Vega",
          rentedAt: new Date("2026-08-01T12:00:00.000Z"),
          dueAt: new Date("2026-08-08T12:00:00.000Z"),
        },
      }),
    ]);

    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/rentals`);

    expect(response.status).toBe(200);

    const { rentalsResponseSchema } = await import("@madeup-video/contracts");
    expect(rentalsResponseSchema.parse(await response.json())).toEqual({
      rentals: [
        {
          id: "rental-midnight-active",
          titleId: "title-midnight-rewind",
          titleName: "Midnight Rewind",
          artworkKey: "midnight-rewind",
          copyBarcode: "MUV-MR-001",
          customerName: "Jamie Vega",
          rentedAt: "2026-08-01T12:00:00.000Z",
          dueAt: "2026-08-08T12:00:00.000Z",
          returnedAt: null,
        },
      ],
    });
  });
});
