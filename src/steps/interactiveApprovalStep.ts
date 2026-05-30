import { createInterface } from "node:readline";

/**
 * Sync-mode interactive approval gate. Prints a summary to stdout, reads a
 * single line from stdin, returns the user's decision. Throws in async /
 * Temporal workflow contexts because stdin isn't a valid input there.
 *
 * ADR-0039 (aspects/steps) — we ship this as a pure helper; a consumer-side composer
 * step wrapper is one line around it.
 */

export type ApprovalDecision = "approved" | "rejected" | "revise";

export interface ApprovalResult {
  decision: ApprovalDecision;
  feedback?: string;
}

export interface PromptApprovalInput {
  phase: string;
  summary: string;
  /** Override stdin/stdout (testing seam). */
  readLine?: (query: string) => Promise<string>;
  /** Override process.stdout.write (testing seam). */
  write?: (message: string) => void;
}

/**
 * Thrown when `promptApproval` is invoked with the default readline reader in
 * a context where stdin is not an interactive TTY (CI runners, piped input,
 * async/Temporal workers). Without this guard, `rl.question` callback never
 * fires on a closed / non-TTY stdin and the workflow blocks forever.
 *
 * Consumers running in non-interactive contexts must either inject a custom
 * `readLine` or avoid calling `promptApproval` entirely.
 */
export class NonInteractiveStdinError extends Error {
  constructor() {
    super(
      "promptApproval requires an interactive stdin (TTY). Inject a custom `readLine` for non-interactive contexts (CI, Temporal workers, piped input).",
    );
    this.name = "NonInteractiveStdinError";
  }
}

const defaultReadLine = (query: string): Promise<string> =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });

const defaultWrite = (m: string) => process.stdout.write(m);

export const promptApproval = async ({
  phase,
  summary,
  readLine = defaultReadLine,
  write = defaultWrite,
}: PromptApprovalInput): Promise<ApprovalResult> => {
  // Fail fast when the default reader is used without an interactive stdin —
  // prevents a silent forever-hang. Consumers who inject their own readLine
  // are trusted (they supply the I/O, they handle the environment).
  if (readLine === defaultReadLine && !process.stdin.isTTY) {
    throw new NonInteractiveStdinError();
  }

  write(`\n=== ${phase} approval ===\n\n${summary}\n\n`);

  for (;;) {
    const answer = (await readLine("approve / reject / revise ? [y/n/r] ")).trim().toLowerCase();
    if (answer === "y" || answer === "yes" || answer === "approve" || answer === "approved") {
      return { decision: "approved" };
    }
    if (answer === "n" || answer === "no" || answer === "reject" || answer === "rejected") {
      return { decision: "rejected" };
    }
    if (answer === "r" || answer === "revise") {
      const feedback = await readLine("feedback > ");
      return { decision: "revise", feedback: feedback.trim() };
    }
    write(`unrecognized answer "${answer}"; please enter y, n, or r.\n`);
  }
};
