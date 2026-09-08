import {
  LocalDevelopmentError,
  runDevelopment,
} from "./lib/local-development.mjs";

const [profile, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const unsupportedFlag = flags.find((flag) => flag !== "--dry-run");

try {
  if (unsupportedFlag) {
    throw new LocalDevelopmentError(
      `Unknown option ${JSON.stringify(unsupportedFlag)}. Use --dry-run to inspect a profile command.`,
    );
  }

  await runDevelopment(profile, { dryRun });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof LocalDevelopmentError ? error.exitCode ?? 1 : 1;
}
