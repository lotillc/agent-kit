import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpawnFn } from "../../ports/SpawnFn.js";
import { defaultSpawn } from "../process/defaultSpawn.js";

/**
 * Thin wrapper over `gh pr create` for agents that don't want an Octokit
 * dependency.
 *
 * Writes the PR body to a temp file and invokes with `--body-file` to avoid
 * shell-escaping issues with multi-line bodies. `gh pr create` prints the new
 * PR's URL to stdout; we parse the trailing `/pull/<number>`, which works on
 * both github.com and GitHub Enterprise Server without hardcoding the host.
 */
export interface CreatePrInput {
  cwd: string;
  title: string;
  body: string;
  baseBranch: string;
  /** Optional label(s) to attach. */
  labels?: ReadonlyArray<string>;
  /** Draft PR. */
  draft?: boolean;
  spawn?: SpawnFn;
}

export interface CreatePrResult {
  ok: boolean;
  prUrl: string | null;
  prNumber: number | null;
  stdout: string;
  stderr: string;
}

export const createPr = ({
  cwd,
  title,
  body,
  baseBranch,
  labels = [],
  draft = false,
  spawn = defaultSpawn,
}: CreatePrInput): CreatePrResult => {
  const tmpDir = mkdtempSync(join(tmpdir(), "agent-kit-pr-"));
  const bodyPath = join(tmpDir, "body.md");
  writeFileSync(bodyPath, body, "utf-8");
  try {
    const args: string[] = [
      "pr",
      "create",
      "--title",
      title,
      "--body-file",
      bodyPath,
      "--base",
      baseBranch,
    ];
    if (draft) args.push("--draft");
    for (const label of labels) args.push("--label", label);
    const res = spawn("gh", args, { cwd });
    // SpawnFn contract: `error` set ⇒ spawn never started (ENOENT / EMFILE /
    // timeout). Surface it before reading exit codes so consumers can tell
    // "gh missing" apart from "gh ran and exited non-zero".
    if (res.error) {
      return {
        ok: false,
        prUrl: null,
        prNumber: null,
        stdout: res.stdout,
        stderr: `gh spawn failed: ${res.error.code ?? res.error.message}`,
      };
    }
    if (res.exitCode !== 0) {
      return { ok: false, prUrl: null, prNumber: null, stdout: res.stdout, stderr: res.stderr };
    }
    const parsed = parsePrUrl(res.stdout);
    return {
      ok: true,
      prUrl: parsed?.url ?? null,
      prNumber: parsed?.number ?? null,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
};

interface ParsedPrOutput {
  number: number;
  url: string;
}

/**
 * `gh pr create` prints the new PR's URL to stdout. The URL ends with
 * `/pull/<number>` on both github.com and GitHub Enterprise Server, so we can
 * extract both fields with one regex without hardcoding the hostname.
 */
const parsePrUrl = (stdout: string): ParsedPrOutput | null => {
  const trimmed = stdout.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+\/pull\/(\d+)/);
  if (!urlMatch) return null;
  const numberStr = urlMatch[1];
  if (!numberStr) return null;
  return { url: urlMatch[0], number: Number(numberStr) };
};
