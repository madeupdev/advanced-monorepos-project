import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const label = process.argv[2];
const outputDirectory = process.env.SECTION8_PARALLEL_OUTPUT_DIRECTORY;
if (!outputDirectory) throw new Error("SECTION8_PARALLEL_OUTPUT_DIRECTORY is required");
const startedAt = Date.now();

await mkdir(outputDirectory, { recursive: true });
await new Promise((resolve) => setTimeout(resolve, 300));
await writeFile(join(outputDirectory, `${label}.json`), JSON.stringify({
  finishedAt: Date.now(),
  label,
  startedAt,
}), "utf8");
