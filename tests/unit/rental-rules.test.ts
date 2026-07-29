import { describe, expect, it } from "vitest";
import { selectAvailableCopy } from "../../lib/rental-rules";

describe("selectAvailableCopy", () => {
  it("selects the first available physical copy", () => {
    expect(
      selectAvailableCopy([
        { id: "copy-rented", status: "RENTED" },
        { id: "copy-available", status: "AVAILABLE" },
      ]),
    ).toEqual({ ok: true, copyId: "copy-available" });
  });

  it("rejects a rental when no physical copy is available", () => {
    expect(
      selectAvailableCopy([{ id: "copy-rented", status: "RENTED" }]),
    ).toEqual({ ok: false, reason: "NO_AVAILABLE_COPY" });
  });
});
