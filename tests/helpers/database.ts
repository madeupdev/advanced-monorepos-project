import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { testDatabaseUrl } from "./environment";
import { testTitles } from "./fixtures";

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

export async function disconnectTestDatabase(): Promise<void> {
  await testDatabase.$disconnect();
}
