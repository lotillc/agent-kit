import { defineConfig } from "vitest/config";

const isCi = process.env.CI === "true";

export default defineConfig({
  test: {
    name: "@lotiai/agent-kit",
    environment: "node",
    globals: false,
    pool: "forks",
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    include: ["**/*.vitest.ts"],
    testTimeout: isCi ? 20000 : undefined,
    hookTimeout: isCi ? 30000 : undefined,
    forbidOnly: isCi,
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.vitest.json",
      include: ["**/*.vitest.ts"],
    },
  },
});
