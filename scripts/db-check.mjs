import { createCourseEnvironment } from "./lib/local-environment.mjs";

try {
  const { databases, counts } =
    await createCourseEnvironment().checkDatabaseState();
  console.log(`Databases: ${databases.join(", ")}`);
  console.log(
    `Seed counts: ${counts.titles}|${counts.physicalCopies}|${counts.rentals}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
