import type { RentalSummary } from "./contracts";
import { getDatabase } from "./database";
import { selectAvailableCopy } from "./rental-rules";

type RentalRecord = {
  id: string;
  customerName: string;
  rentedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  copy: {
    barcode: string;
    title: {
      id: string;
      name: string;
      artworkKey: string;
    };
  };
};

type CreateRentalResult =
  | { ok: true; rental: RentalSummary }
  | { ok: false; reason: "TITLE_NOT_FOUND" | "NO_AVAILABLE_COPY" };

type ReturnRentalResult =
  | { ok: true; rental: RentalSummary }
  | { ok: false; reason: "RENTAL_NOT_FOUND" | "ALREADY_RETURNED" };

const rentalInclude = {
  copy: {
    include: {
      title: true,
    },
  },
} as const;

function toRentalSummary(rental: RentalRecord): RentalSummary {
  return {
    id: rental.id,
    titleId: rental.copy.title.id,
    titleName: rental.copy.title.name,
    artworkKey: rental.copy.title.artworkKey,
    copyBarcode: rental.copy.barcode,
    customerName: rental.customerName,
    rentedAt: rental.rentedAt.toISOString(),
    dueAt: rental.dueAt.toISOString(),
    returnedAt: rental.returnedAt?.toISOString() ?? null,
  };
}

export async function listActiveRentals(): Promise<RentalSummary[]> {
  const database = getDatabase();
  const rentals = await database.rental.findMany({
    where: { returnedAt: null },
    include: rentalInclude,
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
  });

  return rentals.map(toRentalSummary);
}

export async function createRental(titleId: string): Promise<CreateRentalResult> {
  const database = getDatabase();
  const title = await database.title.findUnique({
    where: { id: titleId },
    select: {
      copies: {
        orderBy: { id: "asc" },
        select: { id: true, status: true },
      },
    },
  });

  if (!title) {
    return { ok: false, reason: "TITLE_NOT_FOUND" };
  }

  const selection = selectAvailableCopy(title.copies);

  if (!selection.ok) {
    return selection;
  }

  const rentedAt = new Date();
  const dueAt = new Date(rentedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const rental = await database.$transaction(async (transaction) => {
    await transaction.physicalCopy.update({
      where: { id: selection.copyId },
      data: { status: "RENTED" },
    });

    return transaction.rental.create({
      data: {
        copyId: selection.copyId,
        customerName: "Jamie Vega",
        rentedAt,
        dueAt,
      },
      include: rentalInclude,
    });
  });

  return { ok: true, rental: toRentalSummary(rental) };
}

export async function returnRental(rentalId: string): Promise<ReturnRentalResult> {
  const database = getDatabase();
  const existingRental = await database.rental.findUnique({
    where: { id: rentalId },
    include: rentalInclude,
  });

  if (!existingRental) {
    return { ok: false, reason: "RENTAL_NOT_FOUND" };
  }

  if (existingRental.returnedAt) {
    return { ok: false, reason: "ALREADY_RETURNED" };
  }

  const returnedAt = new Date();
  const rental = await database.$transaction(async (transaction) => {
    await transaction.physicalCopy.update({
      where: { id: existingRental.copyId },
      data: { status: "AVAILABLE" },
    });

    return transaction.rental.update({
      where: { id: rentalId },
      data: { returnedAt },
      include: rentalInclude,
    });
  });

  return { ok: true, rental: toRentalSummary(rental) };
}
