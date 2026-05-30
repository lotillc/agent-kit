import { ANTHROPIC_PRICES, OPENAI_PRICES } from "./pricing.generated.js";
import type { Provider } from "./RunnerSpec.js";

export interface UsageCounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

export interface ModelPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheReadPerMTok?: number;
  readonly cacheWritePerMTok?: number;
}

// Tables are generated from LiteLLM's cost map by tools/cli/src/pricing-sync.ts;
// `cacheWritePerMTok` maps to Anthropic's 5-minute cache-write rate.
const ANTHROPIC = ANTHROPIC_PRICES;
const OPENAI = OPENAI_PRICES;

// Longest matching prefix wins, so a snapshot like `gpt-4o-mini-2024-07-18`
// resolves to the mini rate, not the shorter `gpt-4o` parent rate.
const ANTHROPIC_KEYS_BY_LENGTH = Object.keys(ANTHROPIC).sort((a, b) => b.length - a.length);
const OPENAI_KEYS_BY_LENGTH = Object.keys(OPENAI).sort((a, b) => b.length - a.length);

// Providers with a pricing table: a miss here is a bug (returning $0 would
// silently disable costBudgetUsd). Providers absent (e.g. `ollama`) don't warn.
const PROVIDERS_WITH_PRICING = new Set<Provider>(["anthropic", "openai", "claude-cli"]);
const warnedMisses = new Set<string>();

const lookup = (provider: Provider, model: string): ModelPrice | undefined => {
  if (provider === "anthropic" || provider === "claude-cli") {
    return matchPrefix(ANTHROPIC, ANTHROPIC_KEYS_BY_LENGTH, model);
  }
  if (provider === "openai") return matchPrefix(OPENAI, OPENAI_KEYS_BY_LENGTH, model);
  return undefined;
};

const matchPrefix = (
  table: Record<string, ModelPrice>,
  sortedKeys: readonly string[],
  model: string,
): ModelPrice | undefined => {
  if (table[model]) return table[model];
  for (const key of sortedKeys) {
    if (model.startsWith(key)) return table[key];
  }
  return undefined;
};

const warnPricingMiss = (provider: Provider, model: string): void => {
  const key = `${provider}:${model}`;
  if (warnedMisses.has(key)) return;
  warnedMisses.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[agent-kit/pricing] no entry for ${provider}/${model}; reporting $0. ` +
      `Run \`pnpm pricing:sync\` to refresh the table, ` +
      `or costBudgetUsd will not bind for this model.`,
  );
};

/** Test-only: reset the per-process "already warned" cache. */
export const __resetPricingWarnCacheForTesting = (): void => {
  warnedMisses.clear();
};

export const priceUsage = (provider: Provider, model: string, usage: UsageCounts): number => {
  const price = lookup(provider, model);
  if (!price) {
    if (PROVIDERS_WITH_PRICING.has(provider)) warnPricingMiss(provider, model);
    return 0;
  }
  // AI SDK v6 reports `inputTokens` as the grand total (incl. cache read+write),
  // so price only the non-cached remainder at the input rate and the cached
  // portions at their own rates — otherwise cached tokens are double-charged.
  // Missing cache rate falls back to the input rate (never undercharge).
  const cacheReadRate = price.cacheReadPerMTok ?? price.inputPerMTok;
  const cacheWriteRate = price.cacheWritePerMTok ?? price.inputPerMTok;
  const nonCachedInput = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheCreationTokens,
  );
  return (
    (nonCachedInput * price.inputPerMTok +
      usage.cacheReadTokens * cacheReadRate +
      usage.cacheCreationTokens * cacheWriteRate +
      usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
};
