import assert from "node:assert/strict";
import test from "node:test";

import { ESLint } from "eslint";

test("generated Nx cache files are ignored by repository-wide lint", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  assert.equal(
    await eslint.isPathIgnored(".nx/cache/generated-output.js"),
    true,
  );
});
