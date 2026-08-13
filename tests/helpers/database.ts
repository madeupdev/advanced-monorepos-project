import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { testTitles } from "@madeup-video/testing";
import { testDatabaseUrl } from "./environment";

const testDatabase = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
});

export async function resetTestDatabase(): Promise<void> {
  await testDatabase.$transaction(async (transaction) => {
    await transaction.rental.deleteMany();
    await transaction.physicalCopy.deleteMany();
    await transaction.title.deleteMany();

    for (const title of testTitles) {
      await transaction.title.create({
        data: {
          id: title.id,
          slug: title.slug,
          name: title.name,
          synopsis: title.synopsis,
          releaseYear: title.releaseYear,
          genre: title.genre,
          certificate: title.certificate,
          runtimeMinutes: title.runtimeMinutes,
          artworkKey: title.artworkKey,
          copies: {
            create: title.copies.map(([id, barcode]) => ({ id, barcode })),
          },
        },
      });
    }
  });
}

export async function seedActiveTestRental(): Promise<void> {
  await testDatabase.$transaction([
    testDatabase.physicalCopy.update({
      where: { id: "copy-midnight-rewind-1" },
      data: { status: "RENTED" },
    }),
    testDatabase.rental.create({
      data: {
        id: "rental-midnight-active",
        copyId: "copy-midnight-rewind-1",
        customerName: "Jamie Vega",
        rentedAt: new Date("2026-08-01T12:00:00.000Z"),
        dueAt: new Date("2026-08-08T12:00:00.000Z"),
      },
    }),
  ]);
}

export async function exhaustTestTitleCopies(titleId: string): Promise<void> {
  await testDatabase.physicalCopy.updateMany({
    where: { titleId },
    data: { status: "RENTED" },
  });
}

export async function disconnectTestDatabase(): Promise<void> {
  await testDatabase.$disconnect();
}
