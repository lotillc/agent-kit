/**
 * @lotiai/agent-kit — reusable primitives for building agentic harnesses.
 *
 * See docs/adr/ for architecture context.
 *
 * This is the curated top-level surface. Prefer the subpath imports for narrower
 * pulls:
 *   - `@lotiai/agent-kit/ports`           — interfaces only
 *   - `@lotiai/agent-kit/artifacts`       — defineArtifact + errors
 *   - `@lotiai/agent-kit/process`         — defaultSpawn + SpawnFn types
 *   - `@lotiai/agent-kit/agent-cli/claude` — Claude Code CLI runner + helpers
 *   - `@lotiai/agent-kit/agent-cli/shared` — PATH munging helpers
 */

export {
  type AgenticClaudeOptions,
  type AuthMode,
  type AuthResolution,
  applyEnvOverrides,
  type ClaudeCodeRunnerOptions,
  extractStats,
  formatStreamEvent,
  parseStreamEventLine,
  type ResolvedBinary,
  type RunClaudeLogger,
  resolveAuth,
  resolveClaudeBinary,
  runAgenticClaude,
  runClaudeCode,
  type SpawnChildFn,
  type StreamAssistantMessage,
  type StreamContentBlock,
  type StreamEvent,
  type StreamModelTokenUsage,
} from "./adapters/agent-cli/claude/index.js";
export { CodexRunner, type CodexRunnerOptions } from "./adapters/agent-cli/codex/index.js";
export { GeminiRunner, type GeminiRunnerOptions } from "./adapters/agent-cli/gemini/index.js";
export { ensureNodeOnPath, findBinDir } from "./adapters/agent-cli/shared/index.js";
export {
  FileSystemArtifactStore,
  type FileSystemArtifactStoreOptions,
} from "./adapters/artifact-store/index.js";
export * from "./adapters/concurrency/index.js";
export * from "./adapters/gh-cli/index.js";
export * from "./adapters/git/index.js";
export * from "./adapters/github/index.js";
export * from "./adapters/notifications/index.js";
export { defaultSpawn } from "./adapters/process/defaultSpawn.js";
export * from "./aspects/index.js";
export * from "./domain/artifacts/index.js";
export * from "./domain/diff/index.js";
export {
  type CreateCostBudgetInput,
  createCostBudget,
  PHASE_STATUS_VALUES,
  type PhaseState,
  PhaseStateSchema,
  type PhaseStatus,
  Pipeline,
  type PipelineOptions,
  type PipelineState,
  PipelineStateSchema,
} from "./domain/pipeline/index.js";
export * from "./domain/pr/index.js";
export * from "./domain/prompts/index.js";
export * from "./domain/review/index.js";
export * from "./flows/index.js";
export * from "./models/index.js";
export * from "./ports/index.js";
export * from "./steps/index.js";
