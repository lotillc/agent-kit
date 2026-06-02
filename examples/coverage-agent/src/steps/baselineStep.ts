import { existsSync, readFileSync } from "node:fs";
import { defaultSpawn } from "@lotiai/agent-kit/process";

import { AbortedError, type CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const BASELINE_STEP_NAME = "baseline" as const;

export const baselineStep: PipelineStep<CoverageAgentBag> = {
  name: BASELINE_STEP_NAME,
  run: (bag) => {
    const { config } = bag;
    // Redirect noisy coverage output into the log file.
    const { command, args } = config.packageManager.runCoverage();
    const quoted = [command, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const res = defaultSpawn("sh", ["-c", `${quoted} > "${config.coverageRunLogPath}" 2>&1`], {
      cwd: config.workingTree,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=4096",
      },
    });
    const exitCode = res.exitCode ?? 1;
    if (exitCode !== 0) {
      // Tail the log so failures are visible immediately.
      if (existsSync(config.coverageRunLogPath)) {
        const tail = readFileSync(config.coverageRunLogPath, "utf8")
          .split("\n")
          .slice(-40)
          .join("\n");
        process.stderr.write(`${tail}\n`);
      }
      throw new AbortedError("baseline", `baseline coverage failed (exit ${exitCode})`);
    }
    return {};
  },
};
