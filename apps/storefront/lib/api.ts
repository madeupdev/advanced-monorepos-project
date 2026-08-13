import {
  titlesResponseSchema,
  type TitleSummary,
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
