import { describe, expect, test, vi } from "vitest";

import * as openPrCommand from "../commands/openPr.js";
import type { CoverageAgentConfig } from "../config.js";
import { openPrStep } from "../steps/openPrStep.js";

describe("openPr stage/wrapper reuse", () => {
  test("runOpenPr maps a successful stage result to exit code 0", () => {
    const config = { metricsPath: "/tmp/metrics.json" } as unknown as CoverageAgentConfig;
    const stage = vi.fn().mockReturnValue({
      success: true,
      prUrl: "https://github.com/lotillc/loti-interchange-monorepo/pull/2886",
    });

    expect(openPrCommand.runOpenPr(config.metricsPath, config, stage)).toBe(0);
  });

  test("runOpenPr maps a failed stage result to exit code 1", () => {
    const config = { metricsPath: "/tmp/metrics.json" } as unknown as CoverageAgentConfig;
    const stage = vi.fn().mockReturnValue({
      success: false,
    });

    expect(openPrCommand.runOpenPr(config.metricsPath, config, stage)).toBe(1);
  });

  test("openPrStep returns the prUrl from the shared stage", () => {
    const config = { metricsPath: "/tmp/metrics.json" } as unknown as CoverageAgentConfig;
    vi.spyOn(openPrCommand, "openPrStage").mockReturnValue({
      success: true,
      prUrl: "https://github.com/lotillc/loti-interchange-monorepo/pull/2886",
    });

    expect(openPrStep.run({ config })).toEqual({
      prUrl: "https://github.com/lotillc/loti-interchange-monorepo/pull/2886",
    });
  });
});
