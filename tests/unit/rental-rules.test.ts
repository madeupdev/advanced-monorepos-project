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

  it("selects deterministically when multiple physical copies are available", () => {
    expect(
      selectAvailableCopy([
        { id: "copy-first", status: "AVAILABLE" },
        { id: "copy-second", status: "AVAILABLE" },
      ]),
    ).toEqual({ ok: true, copyId: "copy-first" });
  });

  it("rejects a rental when no physical copy is available", () => {
    expect(
      selectAvailableCopy([{ id: "copy-rented", status: "RENTED" }]),
    ).toEqual({ ok: false, reason: "NO_AVAILABLE_COPY" });
  });

  it("rejects a rental when the copy list is empty", () => {
    expect(selectAvailableCopy([])).toEqual({
      ok: false,
      reason: "NO_AVAILABLE_COPY",
    });
  });
});
