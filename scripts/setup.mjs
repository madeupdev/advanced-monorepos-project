import { createCourseEnvironment } from "./lib/local-environment.mjs";

try {
  await createCourseEnvironment().setup();
  console.log(
    "Local setup is complete. PostgreSQL is healthy, both databases exist, migrations are applied, and development fixtures are seeded.",
  );
  console.log('Run "pnpm dev" to start the storefront.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
