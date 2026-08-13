import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@madeup-video/contracts": fileURLToPath(
        new URL("../../libs/contracts/src/index.ts", import.meta.url),
      ),
      "@madeup-video/database": fileURLToPath(
        new URL("../../libs/database/src/index.ts", import.meta.url),
      ),
      "@madeup-video/rental-domain": fileURLToPath(
        new URL("../../libs/rental-domain/src/index.ts", import.meta.url),
      ),
      "@madeup-video/testing": fileURLToPath(
        new URL("../../libs/testing/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["apps/api-e2e/src/**/*.spec.ts"],
    setupFiles: ["apps/api-e2e/src/test-setup.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
