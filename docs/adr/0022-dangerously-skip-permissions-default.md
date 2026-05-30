# ADR-0022 — `--dangerously-skip-permissions` default (opt-in)

- Status: Accepted (2026-05-31; supersedes the original "default on" decision)
- Date: 2026-04-20 (original); 2026-05-31 (current)

## Context

Skipping approval prompts lets an agent edit files and run tools unattended — usually required for CI-bound agentic runs, but dangerous as a silent default in a public library. Every CLI runner has an equivalent bypass: Claude `--dangerously-skip-permissions`, Codex `--approval-mode never`, Gemini `--yolo`.

## Decision

Bypass is **opt-in** and defaults **off** across all runners. `runClaudeCode` / `runAgenticClaude` take `dangerouslySkipPermissions`; `CodexRunner` / `GeminiRunner` take `dangerouslyBypassApprovals`. Whenever a caller enables it, a one-line WARNING is written to stderr (`warnDangerousAutonomy`), visible regardless of any injected logger. Enable only under a sandboxed/ephemeral working tree with a post-run diff gate.

## Consequences

Safe by default for a public package; the capability remains a single explicit flag away. Bypassed runs are always loudly called out. (Supersedes the prior default-on decision.)
