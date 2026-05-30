import { z } from "zod";

export const PHASE_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type PhaseStatus = (typeof PHASE_STATUS_VALUES)[number];

export const PhaseStateSchema = z.strictObject({
  status: z.enum(PHASE_STATUS_VALUES),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  error: z.string().optional(),
});

export type PhaseState = z.infer<typeof PhaseStateSchema>;

/**
 * Persisted state for a phase-gated `Pipeline`. Consumer-specific fields
 * (a CLI's `requirements`, a coverage tool's target file, etc.) belong in
 * `metadata`; the rest is uniform across harnesses.
 */
export const PipelineStateSchema = z.strictObject({
  runId: z.string(),
  branchName: z.string().optional(),
  prNumber: z.number().int().optional(),
  iterationCount: z.number().int().nonnegative().default(0),
  phases: z.record(z.string(), PhaseStateSchema).default({}),
  totalCostUsd: z.number().nonnegative().default(0),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type PipelineState = z.infer<typeof PipelineStateSchema>;
