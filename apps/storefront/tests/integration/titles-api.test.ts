import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TitleSummary } from "@madeup-video/contracts";
import { GET as listTitlesRoute } from "../../app/api/titles/route";
import {
  disconnectTestDatabase,
  resetTestDatabase,
} from "../../../../tests/helpers/database";

type TitlesResponse = {
  titles: TitleSummary[];
};

describe("titles API", () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  it("lists the deterministic catalogue with physical-copy counts", async () => {
    const response = await listTitlesRoute();
    const body = (await response.json()) as TitlesResponse;

    expect(response.status).toBe(200);
    expect(body.titles).toHaveLength(6);
    expect(
      body.titles.find(({ id }) => id === "title-midnight-rewind"),
    ).toMatchObject({
      name: "Midnight Rewind",
      availableCopies: 3,
      totalCopies: 3,
    });
  });
});
