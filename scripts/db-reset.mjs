import {
  createCourseEnvironment,
  LocalEnvironmentError,
} from "./lib/local-environment.mjs";

try {
  const environment = createCourseEnvironment();
  const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
  const unknownArguments = arguments_.filter((value) => value !== "--yes");

  if (unknownArguments.length > 0) {
    throw new LocalEnvironmentError(
      `Unknown database reset argument: ${unknownArguments.join(", ")}. Use --yes to confirm the destructive reset.`,
    );
  }

  const yes = arguments_.includes("--yes");
  const { volumeName } = environment.getComposeIdentity();

  if (yes) {
    console.log(
      `Destructive reset requested for Compose volume "${volumeName}". Preflight must succeed before the course volume is removed.`,
    );
  }

  await environment.resetDatabase({ yes });
  console.log(
    `PostgreSQL was reset, migrated, and seeded in volume "${volumeName}".`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
