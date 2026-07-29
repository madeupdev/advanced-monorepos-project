import { NextResponse } from "next/server";
import { returnRental } from "../../../../../lib/rentals";

type ReturnRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: ReturnRouteContext) {
  const { id } = await params;
  const result = await returnRental(id);

  if (!result.ok) {
    const rentalMissing = result.reason === "RENTAL_NOT_FOUND";

    return NextResponse.json(
      {
        error: {
          code: result.reason,
          message: rentalMissing
            ? "That rental could not be found."
            : "That copy has already been returned.",
        },
      },
      { status: rentalMissing ? 404 : 409 },
    );
  }

  return NextResponse.json({ rental: result.rental }, { status: 200 });
}
