import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForDatabase = globalThis as unknown as {
  madeUpVideoDatabase?: PrismaClient;
};

function createDatabase(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env and provide PostgreSQL.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export function getDatabase(): PrismaClient {
  globalForDatabase.madeUpVideoDatabase ??= createDatabase();
  return globalForDatabase.madeUpVideoDatabase;
}
