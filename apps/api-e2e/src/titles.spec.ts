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

  it("lists the complete seeded catalogue contract", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(`${await app.getUrl()}/api/titles`);

    expect(response.status).toBe(200);

    const { titlesResponseSchema } = await import("@madeup-video/contracts");
    const body = titlesResponseSchema.parse(await response.json());

    expect(body).toEqual({
      titles: [
        {
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
        },
        {
          id: "title-rental-hearts",
          slug: "rental-hearts",
          name: "Rental Hearts",
          releaseYear: 1996,
          genre: "Romance",
          certificate: "PG",
          runtimeMinutes: 101,
          artworkKey: "rental-hearts",
          availableCopies: 2,
          totalCopies: 2,
        },
        {
          id: "title-signal-lost",
          slug: "signal-lost",
          name: "Signal Lost",
          releaseYear: 1994,
          genre: "Science Fiction",
          certificate: "PG",
          runtimeMinutes: 96,
          artworkKey: "signal-lost",
          availableCopies: 2,
          totalCopies: 2,
        },
        {
          id: "title-static-summer",
          slug: "static-summer",
          name: "Static Summer",
          releaseYear: 1998,
          genre: "Adventure",
          certificate: "PG",
          runtimeMinutes: 98,
          artworkKey: "static-summer",
          availableCopies: 3,
          totalCopies: 3,
        },
        {
          id: "title-last-matinee",
          slug: "the-last-matinee",
          name: "The Last Matinee",
          releaseYear: 1992,
          genre: "Drama",
          certificate: "12",
          runtimeMinutes: 109,
          artworkKey: "the-last-matinee",
          availableCopies: 2,
          totalCopies: 2,
        },
        {
          id: "title-weekend-at-orion",
          slug: "weekend-at-orion",
          name: "Weekend at Orion",
          releaseYear: 1999,
          genre: "Comedy",
          certificate: "PG",
          runtimeMinutes: 91,
          artworkKey: "weekend-at-orion",
          availableCopies: 3,
          totalCopies: 3,
        },
      ],
    });
  });

  it("returns the complete title detail contract", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(
      `${await app.getUrl()}/api/titles/title-midnight-rewind`,
    );

    expect(response.status).toBe(200);

    const { titleResponseSchema } = await import("@madeup-video/contracts");
    expect(titleResponseSchema.parse(await response.json())).toEqual({
      title: {
        id: "title-midnight-rewind",
        slug: "midnight-rewind",
        name: "Midnight Rewind",
        synopsis:
          "A night clerk discovers that one returned tape records tomorrow's local news. With sunrise approaching, she must decide which future is worth changing.",
        releaseYear: 1997,
        genre: "Mystery",
        certificate: "12",
        runtimeMinutes: 104,
        artworkKey: "midnight-rewind",
        availableCopies: 3,
        totalCopies: 3,
      },
    });
  });

  it("returns the inherited not-found contract for an unknown title", async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApi(app);
    await app.listen(0, "127.0.0.1");

    const response = await fetch(
      `${await app.getUrl()}/api/titles/title-not-in-the-catalogue`,
    );

    expect(response.status).toBe(404);

    const { errorResponseSchema } = await import("@madeup-video/contracts");
    expect(errorResponseSchema.parse(await response.json())).toEqual({
      error: {
        code: "TITLE_NOT_FOUND",
        message: "That title could not be found.",
      },
    });
  });
});
