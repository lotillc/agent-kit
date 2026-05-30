import { createOpenAI } from "@ai-sdk/openai";

import type { Logger } from "../../ports/Logger.js";
import type { ModelRunner } from "../../ports/ModelRunner.js";
import type { CostListener, RunnerSpec } from "../RunnerSpec.js";
import { revealSecret } from "../secret.js";
import { createAiSdkRunner } from "./aiSdkRunner.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";

export const createOllamaRunner = (
  name: string,
  spec: RunnerSpec,
  onCost?: CostListener,
  logger?: Logger,
): ModelRunner => {
  const compatible = createOpenAI({
    apiKey: revealSecret(spec.apiKey) ?? "ollama",
    baseURL: spec.baseUrl ?? DEFAULT_BASE_URL,
  });
  return createAiSdkRunner({
    name,
    provider: "ollama",
    modelId: spec.model,
    model: compatible(spec.model),
    timeoutMs: spec.timeoutMs,
    onCost,
    logger,
  });
};
