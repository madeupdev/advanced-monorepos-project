import assert from "node:assert/strict";
import test from "node:test";
import { inspectAffectedSelection } from "./affected-selection-fixtures.mjs";
import { assertParallelProbeOutput, measureLocalParallelism } from "./parallelism-fixtures.mjs";

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
];

test("accepts Nx success output with CI terminal formatting", () => {
  assertParallelProbeOutput("\u001b[32mSuccessfully ran targets \u001b[1mmeasure:parallel-one\u001b[22m, \u001b[1mmeasure:parallel-two\u001b[22m\n  Cache: Skipped (--skip-nx-cache)");
});

test("keeps the root Nx configuration check explicitly repository-wide", async () => {
  const selection = await inspectAffectedSelection("nx.json");

  assert.deepEqual(selection.projects, allProjects);
});

test("runs independent local tooling probes sequentially and in parallel without cache", async () => {
  const measurement = await measureLocalParallelism();

  assert.equal(measurement.sequential.taskCount, 2);
  assert.equal(measurement.parallel.taskCount, 2);
  assert.equal(measurement.sequential.overlaps, false);
  assert.equal(measurement.parallel.overlaps, true);
  assert.equal(measurement.sequential.cacheDisabled, true);
  assert.equal(measurement.parallel.cacheDisabled, true);
});

test("keeps simultaneous local measurements isolated", async () => {
  const measurements = await Promise.all([
    measureLocalParallelism(),
    measureLocalParallelism(),
  ]);

  for (const measurement of measurements) {
    assert.equal(measurement.sequential.taskCount, 2);
    assert.equal(measurement.parallel.taskCount, 2);
    assert.equal(measurement.sequential.overlaps, false);
    assert.equal(measurement.parallel.overlaps, true);
  }
});
