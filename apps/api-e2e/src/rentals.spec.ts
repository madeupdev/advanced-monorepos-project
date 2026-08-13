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

  it("creates a rental with the inherited 201 response", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "title-midnight-rewind" }),
    });

    expect(response.status).toBe(201);

    const rawBody: unknown = await response.json();
    const { rentalResponseSchema } = await import("@madeup-video/contracts");
    const body = rentalResponseSchema.parse(rawBody);

    expect(Object.keys(rawBody as object)).toEqual(["rental"]);
    expect(Object.keys(body.rental)).toEqual([
      "id",
      "titleId",
      "titleName",
      "artworkKey",
      "copyBarcode",
      "customerName",
      "rentedAt",
      "dueAt",
      "returnedAt",
    ]);
    expect(body.rental).toEqual({
      id: expect.any(String),
      titleId: "title-midnight-rewind",
      titleName: "Midnight Rewind",
      artworkKey: "midnight-rewind",
      copyBarcode: "MUV-MR-001",
      customerName: "Jamie Vega",
      rentedAt: expect.any(String),
      dueAt: expect.any(String),
      returnedAt: null,
    });
    expect(
      Date.parse(body.rental.dueAt) - Date.parse(body.rental.rentedAt),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rejects malformed JSON with the inherited request error", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"titleId":',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Provide a valid JSON rental request.",
      },
    });
  });

  it("requires a title ID", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "A title ID is required to create a rental.",
      },
    });
  });

  it("returns the inherited not-found response for an unknown title", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "title-not-in-the-catalogue" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TITLE_NOT_FOUND",
        message: "That title could not be found.",
      },
    });
  });

  it("returns the inherited conflict when no copy is available", async () => {
    await database.physicalCopy.updateMany({
      where: { titleId: "title-midnight-rewind" },
      data: { status: "RENTED" },
    });
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "title-midnight-rewind" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NO_AVAILABLE_COPY",
        message: "All physical copies of this title are currently rented.",
      },
    });
  });
});
