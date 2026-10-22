import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Client tests that render hooks or components start with `// @vitest-environment jsdom`; the others stay in Node.
    include: ["server/src/**/*.test.ts", "client/src/**/*.test.{ts,tsx}"],
  },
});
