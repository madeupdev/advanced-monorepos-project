import {
  rentalsResponseSchema,
  titlesResponseSchema,
  type RentalSummary,
  type TitleSummary,
} from '@madeup-video/contracts';
import { readAdminBrowserConfig } from '../config';

const { apiOrigin } = readAdminBrowserConfig();

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${apiOrigin}/api${path}`);

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json();
}

export async function listTitles(): Promise<TitleSummary[]> {
  return titlesResponseSchema.parse(await get('/titles')).titles;
}

export async function listRentals(): Promise<RentalSummary[]> {
  return rentalsResponseSchema.parse(await get('/rentals')).rentals;
}
