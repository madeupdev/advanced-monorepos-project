import assert from "node:assert/strict";
import test from "node:test";
import { verifyCacheInputCorrection } from "./cache-input-fixtures.mjs";

test("invalidates the cache when the declared controlled input changes", async () => {
  const observation = await verifyCacheInputCorrection();

  assert.equal(observation.initialRun.cacheStatus, "cache-miss");
  assert.equal(observation.falseHit.hash, observation.initialRun.hash);
  assert.equal(observation.falseHit.cacheStatus, "local-cache-hit");
  assert.equal(observation.correctedBaseline.cacheStatus, "cache-miss");
  assert.notEqual(observation.correctedRun.hash, observation.correctedBaseline.hash);
  assert.equal(observation.correctedRun.cacheStatus, "cache-miss");
  assert.equal(observation.replay.hash, observation.correctedRun.hash);
  assert.equal(observation.replay.cacheStatus, "local-cache-hit");
  assert.equal(observation.falseHit.outputValue, "before", observation.falseHit.output);
  assert.match(observation.falseHit.output, /local cache/i);
  assert.equal(observation.correctedRun.outputValue, "after");
  assert.doesNotMatch(observation.correctedRun.output, /local cache/i);
  assert.equal(observation.replay.outputValue, "after");
  assert.match(observation.replay.output, /local cache/i);
});
