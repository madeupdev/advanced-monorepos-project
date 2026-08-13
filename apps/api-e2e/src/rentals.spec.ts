import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../api/src/app/app.module";
import { configureApi } from "../../api/src/app/configure-api";
import {
  disconnectTestDatabase,
  exhaustTestTitleCopies,
  resetTestDatabase,
  seedActiveTestRental,
} from "../../../tests/helpers/database";

describe("rentals API", () => {
  let app: INestApplication | undefined;

  beforeEach(resetTestDatabase);

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(disconnectTestDatabase);

  it("lists the exact active rental contract", async () => {
    await seedActiveTestRental();

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
    await exhaustTestTitleCopies("title-midnight-rewind");
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

  it("returns a rental, restores its copy, and removes it from the active list", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");
    const apiOrigin = await app.getUrl();

    const createResponse = await fetch(`${apiOrigin}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "title-midnight-rewind" }),
    });
    const { rentalResponseSchema, rentalsResponseSchema, titlesResponseSchema } =
      await import("@madeup-video/contracts");
    const created = rentalResponseSchema.parse(await createResponse.json());

    const returnResponse = await fetch(
      `${apiOrigin}/api/rentals/${created.rental.id}/return`,
      { method: "POST" },
    );

    expect(returnResponse.status).toBe(200);

    const returned = rentalResponseSchema.parse(await returnResponse.json());
    expect(returned.rental).toEqual({
      ...created.rental,
      returnedAt: expect.any(String),
    });

    const activeResponse = await fetch(`${apiOrigin}/api/rentals`);
    expect(
      rentalsResponseSchema.parse(await activeResponse.json()),
    ).toEqual({ rentals: [] });

    const titlesResponse = await fetch(`${apiOrigin}/api/titles`);
    const titles = titlesResponseSchema.parse(await titlesResponse.json());
    expect(
      titles.titles.find(({ id }) => id === "title-midnight-rewind"),
    ).toEqual({
      id: "title-midnight-rewind",
      slug: "midnight-rewind",
      name: "Midnight Rewind",
      releaseYear: 1997,
      genre: "Mystery",
      certificate: "12",
      runtimeMinutes: 104,
      artworkKey: "midnight-rewind",
      availableCopies: 3,
      totalCopies: 3,
    });
  });

  it("returns the inherited not-found response for an unknown rental", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(
      `${await app.getUrl()}/api/rentals/rental-not-found/return`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RENTAL_NOT_FOUND",
        message: "That rental could not be found.",
      },
    });
  });

  it("returns the inherited conflict for an already returned rental", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");
    const apiOrigin = await app.getUrl();

    const createResponse = await fetch(`${apiOrigin}/api/rentals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "title-midnight-rewind" }),
    });
    const { rentalResponseSchema } = await import("@madeup-video/contracts");
    const created = rentalResponseSchema.parse(await createResponse.json());
    const returnUrl = `${apiOrigin}/api/rentals/${created.rental.id}/return`;

    expect((await fetch(returnUrl, { method: "POST" })).status).toBe(200);

    const response = await fetch(returnUrl, { method: "POST" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ALREADY_RETURNED",
        message: "That copy has already been returned.",
      },
    });
  });
});
