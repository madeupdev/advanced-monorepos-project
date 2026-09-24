import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const inputPath = new URL("../../cache-fixture-input.txt", import.meta.url);
const outputPath = new URL("../dist/observation.json", import.meta.url);

await mkdir(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  value: (await readFile(inputPath, "utf8")).trim(),
}), "utf8");
