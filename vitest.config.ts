import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@madeup-video/contracts": fileURLToPath(
        new URL("./libs/contracts/src/index.ts", import.meta.url),
      ),
      "@madeup-video/database": fileURLToPath(
        new URL("./libs/database/src/index.ts", import.meta.url),
      ),
      "@madeup-video/rental-domain": fileURLToPath(
        new URL("./libs/rental-domain/src/index.ts", import.meta.url),
      ),
      "@madeup-video/testing": fileURLToPath(
        new URL("./libs/testing/src/index.ts", import.meta.url),
      ),
      "@madeup-video/ui": fileURLToPath(
        new URL("./libs/ui/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "apps/storefront/tests/integration/**/*.test.ts",
            "tests/integration/**/*.test.ts",
          ],
          environment: "node",
          setupFiles: ["tests/helpers/test-environment.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
