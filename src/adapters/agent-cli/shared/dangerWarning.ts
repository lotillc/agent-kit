/**
 * One-line safety call-out when a runner is told to bypass its approval/
 * permission prompts (Claude `--dangerously-skip-permissions`, Codex
 * `--approval-mode never`, Gemini `--yolo`). Written to
 * stderr via `console.warn` so it is visible regardless of any injected
 * logger (ADR-0022). Autonomy is opt-in across runners; this fires only when a
 * caller explicitly enables it.
 */
export const warnDangerousAutonomy = (flag: string): void => {
  console.warn(
    `[agent-kit] ${flag} enabled — the agent can edit files and run commands without prompting. Use only under a sandboxed or ephemeral working tree.`,
  );
};
