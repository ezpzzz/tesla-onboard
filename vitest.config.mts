import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "services/**/test/**/*.test.ts", "lib/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
