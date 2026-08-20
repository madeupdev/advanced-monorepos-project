import type { TitleDetails, TitleSummary } from "@madeup-video/contracts";
import { getDatabase } from "./database";

export async function listTitles(): Promise<TitleSummary[]> {
  const database = getDatabase();
  const titles = await database.title.findMany({
    include: {
      _count: {
        select: { copies: true },
      },
      copies: {
        where: { status: "AVAILABLE" },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return titles.map((title) => ({
    id: title.id,
    slug: title.slug,
    name: title.name,
    releaseYear: title.releaseYear,
    genre: title.genre,
    certificate: title.certificate,
    runtimeMinutes: title.runtimeMinutes,
    artworkKey: title.artworkKey,
    availability: {
      available: title.copies.length,
      total: title._count.copies,
    },
    availableCopies: title.copies.length,
    totalCopies: title._count.copies,
  }));
}

export async function getTitleById(id: string): Promise<TitleDetails | null> {
  const database = getDatabase();
  const title = await database.title.findUnique({
    where: { id },
    include: {
      _count: {
        select: { copies: true },
      },
      copies: {
        where: { status: "AVAILABLE" },
        select: { id: true },
      },
    },
  });

  if (!title) {
    return null;
  }

  return {
    id: title.id,
    slug: title.slug,
    name: title.name,
    synopsis: title.synopsis,
    releaseYear: title.releaseYear,
    genre: title.genre,
    certificate: title.certificate,
    runtimeMinutes: title.runtimeMinutes,
    artworkKey: title.artworkKey,
    availability: {
      available: title.copies.length,
      total: title._count.copies,
    },
    availableCopies: title.copies.length,
    totalCopies: title._count.copies,
  };
}
