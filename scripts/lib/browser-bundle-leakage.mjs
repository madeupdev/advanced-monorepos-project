import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function findValueInFiles(directory, value) {
  const matches = [];
  const needle = Buffer.from(value);

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      matches.push(...await findValueInFiles(path, value));
    } else if (entry.isFile() && (await readFile(path)).includes(needle)) {
      matches.push(path);
    }
  }

  return matches.sort();
}
