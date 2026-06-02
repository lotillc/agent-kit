import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runDoctor } from "./commands/doctor.js";
import { runInvokeClaude } from "./commands/invokeClaude.js";
import { runOpenPr } from "./commands/openPr.js";
import { runPipeline } from "./commands/pipeline.js";
import { runReview } from "./commands/review.js";
import { runSelect } from "./commands/select.js";
import { runStrykerBaseline } from "./commands/strykerBaseline.js";
import { runSummary } from "./commands/summary.js";
import { runValidate } from "./commands/validate.js";
import { runValidateDiff } from "./commands/validateDiff.js";

async function main(): Promise<number> {
  const parser = yargs(hideBin(process.argv))
    .scriptName("coverage-agent")
    .strict()
    .demandCommand(1)
    .command("select", "Pick the next package/file target", {}, () => {
      process.exit(runSelect());
    })
    .command("doctor", "Verify prerequisites for an agent run", {}, async () => {
      process.exit(await runDoctor());
    })
    .command(
      "stryker-baseline",
      "Run Stryker on the selected file and record the baseline mutation score",
      {},
      () => {
        process.exit(runStrykerBaseline());
      },
    )
    .command(
      "invoke-claude",
      "Invoke Claude Code headless to draft tests for the selected file",
      {},
      async () => {
        process.exit(await runInvokeClaude());
      },
    )
    .command(
      "validate",
      "Run quality gates on the agent's output; writes metrics.json on success",
      {},
      async () => {
        process.exit(await runValidate());
      },
    )
    .command(
      "review",
      "Invoke configured reviewer(s) and write .coverage-agent-run/review.json",
      {},
      async () => {
        process.exit(await runReview());
      },
    )
    .command(
      "pipeline",
      "End-to-end: select → doctor → stryker-baseline → invoke-claude → validate → open-pr → record-run",
      {},
      async () => {
        process.exit(await runPipeline());
      },
    )
    .command("validate-diff", "Fail if the working tree contains non-test file changes", {}, () => {
      process.exit(runValidateDiff());
    })
    .command(
      "summary",
      "Render a markdown run summary to $GITHUB_STEP_SUMMARY (or stdout locally)",
      {},
      () => {
        process.exit(runSummary());
      },
    )
    .command(
      "open-pr <metrics-json>",
      "Commit staged changes and open a PR against the sandbox branch",
      (y) =>
        y.positional("metrics-json", {
          type: "string",
          demandOption: true,
          describe: "Path to a metrics JSON file",
        }),
      (argv) => {
        process.exit(runOpenPr(argv.metricsJson as string));
      },
    )
    .help();

  await parser.parseAsync();
  return 0;
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});

export {
  runDoctor,
  runInvokeClaude,
  runOpenPr,
  runPipeline,
  runReview,
  runSelect,
  runStrykerBaseline,
  runSummary,
  runValidate,
  runValidateDiff,
};
