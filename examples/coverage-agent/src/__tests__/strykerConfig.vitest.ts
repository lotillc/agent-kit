import { describe, expect, test } from "vitest";
import { buildStrykerConfig } from "../stryker/strykerConfig.js";

describe("buildStrykerConfig", () => {
  test("scopes mutate to the given relative target", () => {
    const cfg = buildStrykerConfig({ mutateRelativePath: "src/audit-aws-resources.ts" });
    expect(cfg.mutate).toEqual(["src/audit-aws-resources.ts"]);
  });

  test("always uses the vitest test runner with the package config", () => {
    const cfg = buildStrykerConfig({ mutateRelativePath: "src/foo.ts" });
    expect(cfg.testRunner).toBe("vitest");
    expect(cfg.vitest).toEqual({ configFile: "vitest.config.mts" });
  });

  test("default report path lands under reports/mutation", () => {
    const cfg = buildStrykerConfig({ mutateRelativePath: "src/foo.ts" });
    expect(cfg.jsonReporter).toEqual({
      fileName: "reports/mutation/mutation.json",
    });
  });

  test("accepts a custom report path and timeout", () => {
    const cfg = buildStrykerConfig({
      mutateRelativePath: "src/foo.ts",
      reportJsonRelativePath: "custom/out.json",
      timeoutMs: 30_000,
    });
    expect(cfg.jsonReporter).toEqual({ fileName: "custom/out.json" });
    expect(cfg.timeoutMS).toBe(30_000);
  });
});
