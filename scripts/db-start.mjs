import { createCourseEnvironment } from "./lib/local-environment.mjs";

try {
  await createCourseEnvironment().startDatabase();
  console.log("PostgreSQL is running and healthy.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
