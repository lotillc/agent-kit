import { SpanStatusCode, trace } from "@opentelemetry/api";
import { generateText, type LanguageModel } from "ai";

import type { Logger } from "../../ports/Logger.js";
import type { ModelRunner, ModelRunResult, RunCostContext } from "../../ports/ModelRunner.js";
import { safeCallCostListener } from "../costListener.js";
import { priceUsage, type UsageCounts } from "../pricing.js";
import type { CostListener, Provider } from "../RunnerSpec.js";

const TRACER_NAME = "@lotiai/agent-kit/runners";

export interface AiSdkRunnerOptions {
  readonly name: string;
  readonly provider: Provider;
  readonly modelId: string;
  readonly model: LanguageModel;
  readonly defaultSystem?: string;
  readonly timeoutMs?: number;
  readonly onCost?: CostListener;
  readonly logger?: Logger;
}

export const createAiSdkRunner = (opts: AiSdkRunnerOptions): ModelRunner => {
  const tracer = trace.getTracer(TRACER_NAME);

  const runOnce = async (
    prompt: string,
    kind: "review" | "generate",
    externalSignal?: AbortSignal,
    context?: RunCostContext,
  ): Promise<ModelRunResult> =>
    tracer.startActiveSpan(
      `runner.${opts.provider}.${kind}`,
      {
        attributes: {
          "runner.name": opts.name,
          "runner.provider": opts.provider,
          "runner.model": opts.modelId,
          "runner.kind": kind,
        },
      },
      async (span) => {
        const startedAt = Date.now();
        const controller = opts.timeoutMs !== undefined ? new AbortController() : undefined;
        const timeoutHandle =
          opts.timeoutMs !== undefined
            ? setTimeout(() => controller?.abort(), opts.timeoutMs)
            : undefined;
        // Abort on the runner's own timeout OR the breaker's cooperative signal.
        const abortSignal = combineSignals(controller?.signal, externalSignal);
        try {
          opts.logger?.debug("runner.invoke.start", {
            runner: opts.name,
            provider: opts.provider,
            model: opts.modelId,
            kind,
          });
          // maxRetries:0 — retries are owned by withBreaker, not the AI SDK.
          const response = await generateText({
            model: opts.model,
            system: opts.defaultSystem,
            prompt,
            abortSignal,
            maxRetries: 0,
          });
          const usage = normalizeUsage(response.usage, response.providerMetadata);
          const costUsd = priceUsage(opts.provider, opts.modelId, usage);
          const durationMs = Date.now() - startedAt;
          span.setAttributes({
            "runner.tokens.input": usage.inputTokens,
            "runner.tokens.output": usage.outputTokens,
            "runner.tokens.cache_read": usage.cacheReadTokens,
            "runner.tokens.cache_creation": usage.cacheCreationTokens,
            "runner.cost_usd": costUsd,
            "runner.duration_ms": durationMs,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          // safeCallCostListener: a thrown listener must not fall through to the
          // catch block (which would re-emit failure + return success:false).
          safeCallCostListener(
            opts.onCost,
            {
              runnerName: opts.name,
              provider: opts.provider,
              model: opts.modelId,
              kind,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              tokensSource: "provider",
              costUsd,
              durationMs,
              at: startedAt,
              success: true,
              correlationId: context?.correlationId,
              tags: context?.tags,
            },
            opts.logger,
          );
          opts.logger?.info("runner.invoke.success", {
            runner: opts.name,
            provider: opts.provider,
            model: opts.modelId,
            kind,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
            durationMs,
          });
          return { success: true, rawOutput: response.text, costUsd, durationMs };
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          const safeError = redactErrorMessage(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: safeError });
          // Record the redacted message, never the raw error — exporters emit
          // exception.message, which can carry the very secret we redact above.
          span.recordException(toRedactedException(err, safeError));
          safeCallCostListener(
            opts.onCost,
            {
              runnerName: opts.name,
              provider: opts.provider,
              model: opts.modelId,
              kind,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              tokensSource: "unavailable",
              costUsd: 0,
              durationMs,
              at: startedAt,
              success: false,
              correlationId: context?.correlationId,
              tags: context?.tags,
            },
            opts.logger,
          );
          opts.logger?.error("runner.invoke.failure", {
            runner: opts.name,
            provider: opts.provider,
            model: opts.modelId,
            kind,
            durationMs,
            error: safeError,
          });
          return {
            success: false,
            rawOutput: "",
            durationMs,
            error: safeError,
            errorStatusCode: extractStatusCode(err),
          };
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
          span.end();
        }
      },
    );

  return {
    name: opts.name,
    runReview: (prompt, _workingDir, signal, context) =>
      runOnce(prompt, "review", signal, context),
    runGenerate: (prompt, _workingDir, signal, context) =>
      runOnce(prompt, "generate", signal, context),
  };
};

const combineSignals = (
  a: AbortSignal | undefined,
  b: AbortSignal | undefined,
): AbortSignal | undefined => {
  const signals = [a, b].filter((s): s is AbortSignal => s !== undefined);
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
};

// Sanitized Error for span.recordException — preserves the original name but
// drops the raw message/stack so secrets can't reach trace exporters.
const toRedactedException = (err: unknown, safeMessage: string): Error => {
  const sanitized = new Error(safeMessage);
  if (err instanceof Error) sanitized.name = err.name;
  return sanitized;
};

const extractStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { statusCode?: unknown; status?: unknown };
  const raw = e.statusCode ?? e.status;
  return typeof raw === "number" ? raw : undefined;
};

// Strip Authorization / x-api-key / sk-... patterns from provider error
// messages so a key embedded in the error can't leak downstream. Best-effort.
const redactErrorMessage = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(authorization|bearer|x-api-key|api[_-]?key)[:=]\s*[^\s,;"}]+/gi, "$1: [REDACTED]")
    .replace(/(sk-[a-z0-9_-]{12,})/gi, "[REDACTED]");
};

const toNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeUsage = (usage: unknown, providerMetadata: unknown): UsageCounts => {
  const u = (usage ?? {}) as Record<string, unknown>;
  const inputDetails = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  const anthropicMeta = extractAnthropicMeta(providerMetadata);
  return {
    inputTokens: toNumber(u.inputTokens ?? u.promptTokens),
    outputTokens: toNumber(u.outputTokens ?? u.completionTokens),
    cacheReadTokens: toNumber(
      inputDetails.cacheReadTokens ?? u.cachedInputTokens ?? anthropicMeta?.cacheReadInputTokens,
    ),
    cacheCreationTokens: toNumber(
      inputDetails.cacheWriteTokens ?? anthropicMeta?.cacheCreationInputTokens,
    ),
  };
};

const extractAnthropicMeta = (providerMetadata: unknown): Record<string, unknown> | undefined => {
  if (!providerMetadata || typeof providerMetadata !== "object") return undefined;
  const root = providerMetadata as Record<string, unknown>;
  const anthropic = root.anthropic;
  return anthropic && typeof anthropic === "object"
    ? (anthropic as Record<string, unknown>)
    : undefined;
};
