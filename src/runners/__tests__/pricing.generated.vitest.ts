import { describe, expect, test } from "vitest";

import { ANTHROPIC_PRICES, OPENAI_PRICES } from "../pricing.generated.js";

// Offline guard for the generated table (synced from LiteLLM by
// scripts/pricing-sync.ts). Catches a botched/empty sync being committed;
// refresh on demand with `pnpm --filter @lotiai/agent-kit pricing:sync`.
describe("generated pricing table", () => {
  test("includes current flagship sentinel models", () => {
    for (const model of ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
      expect(ANTHROPIC_PRICES[model], model).toBeDefined();
    }
    for (const model of ["gpt-5.5", "gpt-5", "gpt-4o", "gpt-4o-mini"]) {
      expect(OPENAI_PRICES[model], model).toBeDefined();
    }
  });

  test("every entry has positive finite input/output rates and non-negative cache rates", () => {
    for (const table of [ANTHROPIC_PRICES, OPENAI_PRICES]) {
      for (const [model, price] of Object.entries(table)) {
        expect(Number.isFinite(price.inputPerMTok), model).toBe(true);
        expect(price.inputPerMTok, model).toBeGreaterThan(0);
        expect(price.outputPerMTok, model).toBeGreaterThan(0);
        if (price.cacheReadPerMTok !== undefined) {
          expect(price.cacheReadPerMTok, model).toBeGreaterThanOrEqual(0);
        }
        if (price.cacheWritePerMTok !== undefined) {
          expect(price.cacheWritePerMTok, model).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test("tables are non-trivially populated", () => {
    expect(Object.keys(ANTHROPIC_PRICES).length).toBeGreaterThan(5);
    expect(Object.keys(OPENAI_PRICES).length).toBeGreaterThan(20);
  });
});
