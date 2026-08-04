import { createCourseEnvironment } from "./lib/local-environment.mjs";

try {
  await createCourseEnvironment().showComposeConfiguration();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
