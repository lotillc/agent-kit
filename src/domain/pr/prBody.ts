/**
 * Composable PR-body builder. Section-oriented rendering with a fluent API.
 *
 * Replaces a monolithic `renderPrBody({12 fields})` pattern with a
 * composition model every agent can extend.
 *
 * Pure — no I/O, no network. Produces markdown strings.
 */

export interface PrBodySection {
  /** Section heading (rendered as `## ...`). Omit for an untitled lead. */
  heading?: string;
  /** Markdown body of the section. */
  body: string;
}

export interface PrBodyBuilder {
  section(section: PrBodySection): PrBodyBuilder;
  sectionIf(condition: unknown, section: PrBodySection): PrBodyBuilder;
  raw(markdown: string): PrBodyBuilder;
  render(): string;
}

export const prBodyBuilder = (): PrBodyBuilder => {
  const parts: string[] = [];

  const builder: PrBodyBuilder = {
    section({ heading, body }) {
      if (heading) parts.push(`## ${heading}\n\n${body.trim()}`);
      else parts.push(body.trim());
      return builder;
    },
    sectionIf(condition, section) {
      if (condition) builder.section(section);
      return builder;
    },
    raw(markdown) {
      parts.push(markdown.trim());
      return builder;
    },
    render() {
      return `${parts.filter((p) => p.length > 0).join("\n\n")}\n`;
    },
  };
  return builder;
};

// ---------------------------------------------------------------------------
// Common section helpers (opt-in; keep the builder itself minimal).
// ---------------------------------------------------------------------------

export interface CoverageDelta {
  before: number;
  after: number;
}

/**
 * Render a before/after/delta table with one row per metric. Values are
 * numeric percentages (or `null` when a measurement isn't available).
 */
export const renderDeltaTable = (
  rows: ReadonlyArray<{ label: string; before: number | null; after: number | null }>,
): string => {
  const header = "| Metric | Before | After | Δ |\n|---|---|---|---|";
  const body = rows
    .map(({ label, before, after }) => {
      const beforeStr = before === null ? "—" : `${before.toFixed(1)}%`;
      const afterStr = after === null ? "—" : `${after.toFixed(1)}%`;
      const deltaStr =
        before === null || after === null
          ? "—"
          : `${after - before >= 0 ? "+" : ""}${(after - before).toFixed(1)}%`;
      return `| ${label} | ${beforeStr} | ${afterStr} | ${deltaStr} |`;
    })
    .join("\n");
  return `${header}\n${body}`;
};

/**
 * Render a severity-grouped list of findings. Caller supplies headings;
 * findings within each group are listed as bullets. Returns empty string when
 * there are no findings.
 */
export interface FindingLike {
  file: string;
  line?: number;
  severity: string;
  issue: string;
  suggestion?: string;
}

export const renderFindingsSection = (findings: ReadonlyArray<FindingLike>): string => {
  if (findings.length === 0) return "";
  const bySeverity = new Map<string, FindingLike[]>();
  for (const f of findings) {
    const bucket = bySeverity.get(f.severity) ?? [];
    bucket.push(f);
    bySeverity.set(f.severity, bucket);
  }
  const order = ["critical", "high", "medium", "low", "info"];
  const sorted = [...bySeverity.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const lines: string[] = [];
  for (const [severity, group] of sorted) {
    lines.push(`**${severity}** (${group.length})`);
    for (const f of group) {
      const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
      const suggest = f.suggestion ? ` _Suggest: ${f.suggestion}_` : "";
      lines.push(`- \`${loc}\` — ${f.issue}${suggest}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
};
