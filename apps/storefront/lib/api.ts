import {
  errorResponseSchema,
  rentalsResponseSchema,
  titleResponseSchema,
  titlesResponseSchema,
  type TitleDetails,
  type TitleSummary,
  type RentalSummary,
} from "@madeup-video/contracts";

const serverApiOrigin =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:3333";

export async function listTitlesFromApi(): Promise<TitleSummary[]> {
  const response = await fetch(`${serverApiOrigin}/api/titles`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Title catalogue request failed with ${response.status}.`);
  }

  return titlesResponseSchema.parse(await response.json()).titles;
}

export async function getTitleFromApi(id: string): Promise<TitleDetails | null> {
  const response = await fetch(
    `${serverApiOrigin}/api/titles/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  const body: unknown = await response.json();

  if (response.status === 404) {
    const error = errorResponseSchema.parse(body);

    if (error.error.code === "TITLE_NOT_FOUND") {
      return null;
    }
  }

  if (!response.ok) {
    throw new Error(`Title detail request failed with ${response.status}.`);
  }

  return titleResponseSchema.parse(body).title;
}

export async function listRentalsFromApi(): Promise<RentalSummary[]> {
  const response = await fetch(`${serverApiOrigin}/api/rentals`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Rental list request failed with ${response.status}.`);
  }

  return rentalsResponseSchema.parse(await response.json()).rentals;
}
