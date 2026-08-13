import { z } from "zod";

export const createRentalSchema = z.object({
  titleId: z.string().min(1),
});

export type TitleSummary = {
  id: string;
  slug: string;
  name: string;
  releaseYear: number;
  genre: string;
  certificate: string;
  runtimeMinutes: number;
  artworkKey: string;
  availableCopies: number;
  totalCopies: number;
};

export type TitleDetails = TitleSummary & {
  synopsis: string;
};

export type RentalSummary = {
  id: string;
  titleId: string;
  titleName: string;
  artworkKey: string;
  copyBarcode: string;
  customerName: string;
  rentedAt: string;
  dueAt: string;
  returnedAt: string | null;
};
