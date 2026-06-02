/**
 * GitHub-specific: verifies `gh` is installed and works. Allowlisted by
 * the invariant in `__tests__/github-coupling.vitest.ts`. This is the only
 * non-VCS-neutral call outside src/pr/ and src/stack/.
 */
import { existsSync } from "node:fs";
import { resolveClaudeBinary } from "@lotiai/agent-kit/agent-cli/claude";
import { defaultSpawn } from "@lotiai/agent-kit/process";
import { createConsola } from "consola";

import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";

type CheckStatus = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

// anton-style preflight: verify every tool the pipeline depends on before we
// burn tokens. Exit 1 on any fail.
export async function runDoctor(config: CoverageAgentConfig = loadConfig()): Promise<number> {
  const checks: Check[] = [];

  checks.push(checkBin("git", ["--version"]));
  checks.push(checkBin("pnpm", ["--version"]));
  checks.push(checkBin("gh", ["--version"]));

  checks.push(checkClaudeCli());

  checks.push(
    process.env.ANTHROPIC_API_KEY
      ? { name: "ANTHROPIC_API_KEY", status: "ok", detail: "present" }
      : {
          name: "ANTHROPIC_API_KEY",
          status: "warn",
          detail: "not set (invoke-claude will fail)",
        },
  );

  checks.push({
    name: "coverage-summary",
    status: existsSync(config.coverageSummaryPath) ? "ok" : "warn",
    detail: existsSync(config.coverageSummaryPath)
      ? config.coverageSummaryPath
      : `missing — run pnpm test:coverage first`,
  });

  const log = createConsola({ defaults: { tag: "coverage-agent doctor" } });
  let hasFail = false;
  for (const c of checks) {
    const line = `${c.name.padEnd(22)} ${c.detail}`;
    if (c.status === "ok") log.success(line);
    else if (c.status === "warn") log.warn(line);
    else {
      log.error(line);
      hasFail = true;
    }
  }
  return hasFail ? 1 : 0;
}

function checkBin(bin: string, args: readonly string[]): Check {
  const res = defaultSpawn(bin, args, { timeoutMs: 5_000 });
  if (res.exitCode === 0) {
    return { name: bin, status: "ok", detail: firstLine(res.stdout) };
  }
  return { name: bin, status: "fail", detail: "not found or errored" };
}

function checkClaudeCli(): Check {
  try {
    // agent-kit owns claude-code binary resolution — handles both native
    // bin/claude.exe (v2.1.114+) and cli.js fallback (v2.1.91).
    const binary = resolveClaudeBinary();
    const res = defaultSpawn(binary.command, [...binary.prefixArgs, "--version"], {
      timeoutMs: 5_000,
    });
    if (res.exitCode !== 0) {
      return {
        name: "@anthropic-ai/claude-code",
        status: "fail",
        detail: "binary present but --version failed (run pnpm rebuild @anthropic-ai/claude-code)",
      };
    }
    return {
      name: "@anthropic-ai/claude-code",
      status: "ok",
      detail: firstLine(res.stdout),
    };
  } catch (err) {
    return {
      name: "@anthropic-ai/claude-code",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function firstLine(s: string): string {
  return s.split("\n")[0]?.trim() ?? "";
}
