type OldTitleSummary = {
  id: string;
  availableCopies: number;
  totalCopies: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseOldTitlesResponse(value: unknown): OldTitleSummary[] {
  if (!isRecord(value) || !Array.isArray(value.titles)) {
    throw new Error("Old consumer expected a titles array.");
  }

  return value.titles.map((title) => {
    if (
      !isRecord(title) ||
      typeof title.id !== "string" ||
      typeof title.availableCopies !== "number" ||
      typeof title.totalCopies !== "number"
    ) {
      throw new Error(
        "Old consumer expected id, availableCopies, and totalCopies fields.",
      );
    }

    return {
      id: title.id,
      availableCopies: title.availableCopies,
      totalCopies: title.totalCopies,
    };
  });
}
