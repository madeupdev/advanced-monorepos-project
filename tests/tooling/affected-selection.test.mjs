import assert from "node:assert/strict";
import { watch } from "node:fs";
import test from "node:test";
import { inspectAffectedSelection } from "./affected-selection-fixtures.mjs";

const leafProjects = [
  "@madeup-video/api",
  "@madeup-video/api-e2e",
  "@madeup-video/database",
  "@madeup-video/rental-domain",
  "@madeup-video/repository-tooling",
  "@madeup-video/storefront",
  "@madeup-video/admin-e2e",
].sort();

const sharedContractProjects = [
  "@madeup-video/admin",
  "@madeup-video/admin-e2e",
  "@madeup-video/api",
  "@madeup-video/api-e2e",
  "@madeup-video/contracts",
  "@madeup-video/database",
  "@madeup-video/repository-tooling",
  "@madeup-video/storefront",
].sort();

const allProjects = [
  "@madeup-video/admin",
  "@madeup-video/admin-e2e",
  "@madeup-video/api",
  "@madeup-video/api-e2e",
  "@madeup-video/contracts",
  "@madeup-video/database",
  "@madeup-video/rental-domain",
  "@madeup-video/repository-tooling",
  "@madeup-video/storefront",
  "@madeup-video/testing",
  "@madeup-video/ui",
].sort();

test("selects the narrow rental-domain consumer closure and its unit validation", async () => {
  const selection = await inspectAffectedSelection("libs/rental-domain/src/index.ts");

  assert.deepEqual(selection.projects, leafProjects);
  assert.deepEqual(selection.tasks, ["@madeup-video/storefront:test:unit"]);
});

test("expands a contracts change to every consumer closure and its unit validation", async () => {
  const selection = await inspectAffectedSelection("libs/contracts/src/index.ts");

  assert.deepEqual(selection.projects, sharedContractProjects);
  assert.deepEqual(selection.tasks, ["@madeup-video/storefront:test:unit"]);
});

test("treats a root Nx configuration change as repository-wide", async () => {
  const selection = await inspectAffectedSelection("nx.json");

  assert.deepEqual(selection.projects, allProjects);
  assert.deepEqual(selection.tasks, ["@madeup-video/storefront:test:unit"]);
});

test("inspects affected selection without writing the tracked input", async () => {
  const events = [];
  const watcher = watch(new URL("../../libs/rental-domain/src/index.ts", import.meta.url));
  watcher.on("change", (event) => events.push(event));
  try {
    await inspectAffectedSelection("libs/rental-domain/src/index.ts");
    assert.deepEqual(events, []);
  } finally {
    watcher.close();
  }
});
