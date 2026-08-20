type OldTitleSummary = {
  id: string;
  availableCopies: number;
  totalCopies: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOldTitleSummary(value: unknown): OldTitleSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.availableCopies !== "number" ||
    typeof value.totalCopies !== "number"
  ) {
    throw new Error(
      "Old consumer expected id, availableCopies, and totalCopies fields.",
    );
  }

  return {
    id: value.id,
    availableCopies: value.availableCopies,
    totalCopies: value.totalCopies,
  };
}

export function parseOldTitlesResponse(value: unknown): OldTitleSummary[] {
  if (!isRecord(value) || !Array.isArray(value.titles)) {
    throw new Error("Old consumer expected a titles array.");
  }

  return value.titles.map(parseOldTitleSummary);
}

export function parseOldTitleResponse(value: unknown): OldTitleSummary {
  if (!isRecord(value) || !("title" in value)) {
    throw new Error("Old consumer expected a title response.");
  }

  return parseOldTitleSummary(value.title);
}
