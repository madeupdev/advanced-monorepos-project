import { NextResponse } from "next/server";
import { createRentalSchema } from "@madeup-video/contracts";
import { createRental, listActiveRentals } from "@madeup-video/database";

export async function GET() {
  const rentals = await listActiveRentals();

  return NextResponse.json({ rentals }, { status: 200 });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Provide a valid JSON rental request.",
        },
      },
      { status: 400 },
    );
  }

  const parsedRequest = createRentalSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "A title ID is required to create a rental.",
        },
      },
      { status: 400 },
    );
  }

  const result = await createRental(parsedRequest.data.titleId);

  if (!result.ok) {
    const titleMissing = result.reason === "TITLE_NOT_FOUND";

    return NextResponse.json(
      {
        error: {
          code: result.reason,
          message: titleMissing
            ? "That title could not be found."
            : "All physical copies of this title are currently rented.",
        },
      },
      { status: titleMissing ? 404 : 409 },
    );
  }

  return NextResponse.json({ rental: result.rental }, { status: 201 });
}
