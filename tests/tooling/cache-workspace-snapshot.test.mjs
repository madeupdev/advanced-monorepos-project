import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { snapshotWorkspace } from "./cache-input-fixtures.mjs";

test("freezes source files independently of later worktree changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "section-8-cache-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const destination = join(directory, "snapshot");
  await mkdir(join(source, "node_modules"), { recursive: true });
  await mkdir(join(source, ".git"));
  await mkdir(join(source, ".nx"));
  await mkdir(destination);
  await writeFile(join(source, "nx.json"), "{\"before\":true}\n");
  await writeFile(join(source, ".env"), "private-source-value\n");
  await writeFile(join(source, ".nx", "state.json"), "generated-state\n");

  await snapshotWorkspace(destination, source, ["nx.json"]);
  await writeFile(join(source, "nx.json"), "{\"after\":true}\n");

  assert.equal(await readFile(join(destination, "nx.json"), "utf8"), "{\"before\":true}\n");
  assert.equal((await lstat(join(destination, "node_modules"))).isSymbolicLink(), true);
  await assert.rejects(lstat(join(destination, ".git")), { code: "ENOENT" });
  await assert.rejects(lstat(join(destination, ".nx")), { code: "ENOENT" });
  await assert.rejects(lstat(join(destination, ".env")), { code: "ENOENT" });
});

test("rejects a snapshot missing a cache proof input", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "section-8-cache-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const destination = join(directory, "snapshot");
  await mkdir(join(source, "node_modules"), { recursive: true });
  await mkdir(destination);
  await writeFile(join(source, "nx.json"), "{}\n");

  await assert.rejects(
    snapshotWorkspace(destination, source, ["tests/cache-fixture-input.txt"]),
    /workspace snapshot is missing tests\/cache-fixture-input\.txt/i,
  );
});
