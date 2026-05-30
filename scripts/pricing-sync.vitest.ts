import { describe, expect, it } from "vitest";

import { buildTables, diffTables } from "./pricing-sync.js";

const raw = {
  sample_spec: { litellm_provider: "anthropic", mode: "chat" },
  "claude-haiku-4-5": {
    litellm_provider: "anthropic",
    mode: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000005,
    cache_read_input_token_cost: 0.0000001,
    cache_creation_input_token_cost: 0.00000125,
  },
  "gpt-4o-mini": {
    litellm_provider: "openai",
    mode: "chat",
    input_cost_per_token: 0.00000015,
    output_cost_per_token: 0.0000006,
    cache_read_input_token_cost: 0.000000075,
  },
  "gpt-5.5-pro": {
    litellm_provider: "openai",
    mode: "responses",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00018,
  },
  "text-embedding-3-small": {
    litellm_provider: "openai",
    mode: "embedding",
    input_cost_per_token: 0.00000002,
    output_cost_per_token: 0,
  },
  "claude-3-5-sonnet-bedrock": {
    litellm_provider: "bedrock",
    mode: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  "openai/container": { litellm_provider: "openai", mode: "chat" },
};

describe("buildTables", () => {
  it("converts per-token costs to per-MTok and keeps cache fields", () => {
    const tables = buildTables(raw);
    expect(tables.anthropic["claude-haiku-4-5"]).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 1.25,
    });
    expect(tables.openai["gpt-4o-mini"]).toEqual({
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
      cacheReadPerMTok: 0.075,
    });
  });

  it("includes responses-mode models but omits absent cache fields", () => {
    const tables = buildTables(raw);
    expect(tables.openai["gpt-5.5-pro"]).toEqual({ inputPerMTok: 30, outputPerMTok: 180 });
  });

  it("skips non-text modes, other providers, prefixed keys, and missing costs", () => {
    const tables = buildTables(raw);
    expect(tables.openai["text-embedding-3-small"]).toBeUndefined();
    expect(tables.anthropic["claude-3-5-sonnet-bedrock"]).toBeUndefined();
    expect(tables.openai["openai/container"]).toBeUndefined();
    expect(tables.anthropic.sample_spec).toBeUndefined();
  });
});

describe("diffTables", () => {
  it("reports no drift for identical tables", () => {
    const tables = buildTables(raw);
    expect(diffTables(tables, tables)).toEqual([]);
  });

  it("reports added, removed, and changed models", () => {
    const live = buildTables(raw);
    const committed = buildTables(raw);
    delete committed.openai["gpt-4o-mini"]; // live has it, committed doesn't -> added
    committed.anthropic["claude-haiku-4-5"] = { inputPerMTok: 99, outputPerMTok: 99 }; // changed
    committed.openai["ghost-model"] = { inputPerMTok: 1, outputPerMTok: 2 }; // removed upstream
    const drift = diffTables(live, committed);
    expect(drift.some((l) => l.startsWith("+ openai/gpt-4o-mini"))).toBe(true);
    expect(drift.some((l) => l.startsWith("~ anthropic/claude-haiku-4-5"))).toBe(true);
    expect(drift.some((l) => l.startsWith("- openai/ghost-model"))).toBe(true);
  });
});
