import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createRental,
  listActiveRentals,
  listTitles,
  returnRental,
} from "@madeup-video/database";
import {
  disconnectTestDatabase,
  exhaustTestTitleCopies,
  resetTestDatabase,
} from "../helpers/database";

describe("rental persistence", () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  it("creates, lists, and returns a rental while restoring availability", async () => {
    const result = await createRental("title-midnight-rewind");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected rental creation, received ${result.reason}`);
    }

    expect(result.rental).toEqual({
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
      Date.parse(result.rental.dueAt) - Date.parse(result.rental.rentedAt),
    ).toBe(7 * 24 * 60 * 60 * 1000);
    await expect(listActiveRentals()).resolves.toEqual([result.rental]);

    const returned = await returnRental(result.rental.id);
    expect(returned).toEqual({
      ok: true,
      rental: {
        ...result.rental,
        returnedAt: expect.any(String),
      },
    });
    await expect(listActiveRentals()).resolves.toEqual([]);
    await expect(listTitles()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "title-midnight-rewind",
          availability: { available: 3, total: 3 },
          availableCopies: 3,
          totalCopies: 3,
        }),
      ]),
    );

    await expect(returnRental(result.rental.id)).resolves.toEqual({
      ok: false,
      reason: "ALREADY_RETURNED",
    });
  });

  it("reports missing titles and unavailable copies without creating rentals", async () => {
    await expect(
      createRental("title-not-in-the-catalogue"),
    ).resolves.toEqual({ ok: false, reason: "TITLE_NOT_FOUND" });

    await exhaustTestTitleCopies("title-midnight-rewind");
    await expect(createRental("title-midnight-rewind")).resolves.toEqual({
      ok: false,
      reason: "NO_AVAILABLE_COPY",
    });
    await expect(listActiveRentals()).resolves.toEqual([]);
  });

  it("reports a missing rental", async () => {
    await expect(returnRental("rental-not-found")).resolves.toEqual({
      ok: false,
      reason: "RENTAL_NOT_FOUND",
    });
  });
});
