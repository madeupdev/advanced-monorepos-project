import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTitleById, listTitles } from "@madeup-video/database";
import {
  disconnectTestDatabase,
  resetTestDatabase,
} from "../helpers/database";

describe("title persistence", () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  it("maps the deterministic catalogue and physical-copy counts", async () => {
    const titles = await listTitles();

    expect(titles.map(({ id }) => id)).toEqual([
      "title-midnight-rewind",
      "title-rental-hearts",
      "title-signal-lost",
      "title-static-summer",
      "title-last-matinee",
      "title-weekend-at-orion",
    ]);
    expect(titles[0]).toEqual({
      id: "title-midnight-rewind",
      slug: "midnight-rewind",
      name: "Midnight Rewind",
      releaseYear: 1997,
      genre: "Mystery",
      certificate: "12",
      runtimeMinutes: 104,
      artworkKey: "midnight-rewind",
      availability: { available: 3, total: 3 },
      availableCopies: 3,
      totalCopies: 3,
    });
  });

  it("maps complete title details and reports a missing title", async () => {
    await expect(getTitleById("title-midnight-rewind")).resolves.toEqual({
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
      availability: { available: 3, total: 3 },
      availableCopies: 3,
      totalCopies: 3,
    });
    await expect(
      getTitleById("title-not-in-the-catalogue"),
    ).resolves.toBeNull();
  });
});
