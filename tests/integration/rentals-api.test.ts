import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { RentalSummary, TitleSummary } from "@madeup-video/contracts";
import { GET as listTitlesRoute } from "../../app/api/titles/route";
import {
  GET as listRentalsRoute,
  POST as createRentalRoute,
} from "../../app/api/rentals/route";
import { POST as returnRentalRoute } from "../../app/api/rentals/[id]/return/route";
import {
  disconnectTestDatabase,
  resetTestDatabase,
} from "../helpers/database";

type RentalResponse = {
  rental: RentalSummary;
};

type RentalsResponse = {
  rentals: RentalSummary[];
};

type TitlesResponse = {
  titles: TitleSummary[];
};

describe("rentals API", () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  it("creates, lists, and returns a rental while restoring availability", async () => {
    const createResponse = await createRentalRoute(
      new Request("http://localhost/api/rentals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId: "title-midnight-rewind" }),
      }),
    );
    const created = (await createResponse.json()) as RentalResponse;

    expect(createResponse.status).toBe(201);
    expect(created.rental).toMatchObject({
      titleName: "Midnight Rewind",
      copyBarcode: "MUV-MR-001",
      customerName: "Jamie Vega",
      returnedAt: null,
    });

    const listResponse = await listRentalsRoute();
    const listed = (await listResponse.json()) as RentalsResponse;

    expect(listResponse.status).toBe(200);
    expect(listed.rentals).toEqual([created.rental]);

    const returnResponse = await returnRentalRoute(
      new Request(
        `http://localhost/api/rentals/${created.rental.id}/return`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: created.rental.id }) },
    );
    const returned = (await returnResponse.json()) as RentalResponse;

    expect(returnResponse.status).toBe(200);
    expect(returned.rental.returnedAt).not.toBeNull();

    const activeResponse = await listRentalsRoute();
    const active = (await activeResponse.json()) as RentalsResponse;

    expect(active.rentals).toEqual([]);

    const titlesResponse = await listTitlesRoute();
    const titles = (await titlesResponse.json()) as TitlesResponse;

    expect(
      titles.titles.find(({ id }) => id === "title-midnight-rewind"),
    ).toMatchObject({
      availableCopies: 3,
      totalCopies: 3,
    });
  });

  it("returns the existing not-found response for an unknown title", async () => {
    const response = await createRentalRoute(
      new Request("http://localhost/api/rentals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId: "title-not-in-the-catalogue" }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TITLE_NOT_FOUND",
        message: "That title could not be found.",
      },
    });
  });
});
