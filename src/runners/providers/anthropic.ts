import { createAnthropic } from "@ai-sdk/anthropic";

import type { Logger } from "../../ports/Logger.js";
import type { ModelRunner } from "../../ports/ModelRunner.js";
import type { CostListener, RunnerSpec } from "../RunnerSpec.js";
import { revealSecret } from "../secret.js";
import { createAiSdkRunner } from "./aiSdkRunner.js";

export const createAnthropicRunner = (
  name: string,
  spec: RunnerSpec,
  onCost?: CostListener,
  logger?: Logger,
): ModelRunner => {
  const anthropic = createAnthropic({
    apiKey: revealSecret(spec.apiKey) ?? process.env.ANTHROPIC_API_KEY,
    baseURL: spec.baseUrl,
  });
  return createAiSdkRunner({
    name,
    provider: "anthropic",
    modelId: spec.model,
    model: anthropic(spec.model),
    timeoutMs: spec.timeoutMs,
    onCost,
    logger,
  });
};
