import { z } from "zod";

export const createRentalSchema = z.object({
  titleId: z.string().min(1),
});

export const titleSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  releaseYear: z.number().int(),
  genre: z.string(),
  certificate: z.string(),
  runtimeMinutes: z.number().int(),
  artworkKey: z.string(),
  availableCopies: z.number().int().nonnegative(),
  totalCopies: z.number().int().nonnegative(),
});

export const titleDetailsSchema = titleSummarySchema.extend({
  synopsis: z.string(),
});

export const rentalSummarySchema = z.object({
  id: z.string(),
  titleId: z.string(),
  titleName: z.string(),
  artworkKey: z.string(),
  copyBarcode: z.string(),
  customerName: z.string(),
  rentedAt: z.string(),
  dueAt: z.string(),
  returnedAt: z.string().nullable(),
});

export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const titlesResponseSchema = z.object({
  titles: z.array(titleSummarySchema),
});

export const titleResponseSchema = z.object({
  title: titleDetailsSchema,
});

export const rentalsResponseSchema = z.object({
  rentals: z.array(rentalSummarySchema),
});

export const rentalResponseSchema = z.object({
  rental: rentalSummarySchema,
});

export const errorResponseSchema = z.object({
  error: errorPayloadSchema,
});

export type TitleSummary = z.infer<typeof titleSummarySchema>;
export type TitleDetails = z.infer<typeof titleDetailsSchema>;
export type RentalSummary = z.infer<typeof rentalSummarySchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type TitlesResponse = z.infer<typeof titlesResponseSchema>;
export type TitleResponse = z.infer<typeof titleResponseSchema>;
export type RentalsResponse = z.infer<typeof rentalsResponseSchema>;
export type RentalResponse = z.infer<typeof rentalResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
