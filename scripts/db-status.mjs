import { createCourseEnvironment } from "./lib/local-environment.mjs";

try {
  await createCourseEnvironment().showDatabaseStatus();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
