export type RentableCopy = {
  id: string;
  status: "AVAILABLE" | "RENTED";
};

export type CopySelection =
  | { ok: true; copyId: string }
  | { ok: false; reason: "NO_AVAILABLE_COPY" };

export function selectAvailableCopy(copies: RentableCopy[]): CopySelection {
  const copy = copies.find(({ status }) => status === "AVAILABLE");

  return copy
    ? { ok: true, copyId: copy.id }
    : { ok: false, reason: "NO_AVAILABLE_COPY" };
}
