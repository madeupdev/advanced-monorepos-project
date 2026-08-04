import { createCourseEnvironment } from "./lib/local-environment.mjs";

try {
  await createCourseEnvironment().stopDatabase();
  console.log("PostgreSQL is stopped. Its Compose-managed data is preserved.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
