import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@madeup-video/contracts": fileURLToPath(
        new URL("../../libs/contracts/src/index.ts", import.meta.url),
      ),
      "@madeup-video/ui": fileURLToPath(
        new URL("../../libs/ui/src/index.ts", import.meta.url),
      ),
    },
  },
});
