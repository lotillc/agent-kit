import { createOpenAI } from "@ai-sdk/openai";

import type { Logger } from "../../ports/Logger.js";
import type { ModelRunner } from "../../ports/ModelRunner.js";
import type { CostListener, RunnerSpec } from "../RunnerSpec.js";
import { revealSecret } from "../secret.js";
import { createAiSdkRunner } from "./aiSdkRunner.js";

export const createOpenAiRunner = (
  name: string,
  spec: RunnerSpec,
  onCost?: CostListener,
  logger?: Logger,
): ModelRunner => {
  const openai = createOpenAI({
    apiKey: revealSecret(spec.apiKey) ?? process.env.OPENAI_API_KEY,
    baseURL: spec.baseUrl,
  });
  return createAiSdkRunner({
    name,
    provider: "openai",
    modelId: spec.model,
    model: openai(spec.model),
    timeoutMs: spec.timeoutMs,
    onCost,
    logger,
  });
};
