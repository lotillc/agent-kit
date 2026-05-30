import { describe, expect, test } from "vitest";

import { prBodyBuilder, renderDeltaTable, renderFindingsSection } from "../prBody.js";

describe("prBodyBuilder", () => {
  test("renders sections in insertion order with headings", () => {
    const body = prBodyBuilder()
      .section({ heading: "Summary", body: "first" })
      .section({ heading: "Details", body: "second" })
      .render();
    expect(body).toMatch(/^## Summary\n\nfirst\n\n## Details\n\nsecond\n$/);
  });

  test("sectionIf skips when condition is falsy", () => {
    const body = prBodyBuilder()
      .section({ heading: "A", body: "a" })
      .sectionIf(false, { heading: "Gone", body: "n/a" })
      .sectionIf("some truthy string", { heading: "B", body: "b" })
      .render();
    expect(body).toContain("## A");
    expect(body).toContain("## B");
    expect(body).not.toContain("Gone");
  });

  test("raw() appends without heading prefix", () => {
    const body = prBodyBuilder().raw("# Custom\n\nraw bits").render();
    expect(body.startsWith("# Custom")).toBe(true);
  });

  test("render is idempotent", () => {
    const b = prBodyBuilder().section({ heading: "A", body: "a" });
    expect(b.render()).toBe(b.render());
  });
});

describe("renderDeltaTable", () => {
  test("emits a 3-column table with Δ", () => {
    const out = renderDeltaTable([
      { label: "Line", before: 40, after: 60 },
      { label: "Branch", before: 30, after: 30 },
      { label: "Mutation", before: null, after: null },
    ]);
    expect(out).toContain("| Metric | Before | After | Δ |");
    expect(out).toContain("| Line | 40.0% | 60.0% | +20.0% |");
    expect(out).toContain("| Branch | 30.0% | 30.0% | +0.0% |");
    expect(out).toContain("| Mutation | — | — | — |");
  });
});

describe("renderFindingsSection", () => {
  test("groups by severity and orders critical→info", () => {
    const out = renderFindingsSection([
      { file: "a.ts", severity: "low", issue: "nit" },
      { file: "b.ts", severity: "critical", issue: "broken" },
      { file: "c.ts", severity: "high", issue: "bug", suggestion: "fix it" },
    ]);
    const criticalIdx = out.indexOf("**critical**");
    const highIdx = out.indexOf("**high**");
    const lowIdx = out.indexOf("**low**");
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(criticalIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lowIdx);
    expect(out).toContain("_Suggest: fix it_");
  });

  test("returns empty string when there are no findings", () => {
    expect(renderFindingsSection([])).toBe("");
  });

  test("includes line locator when present", () => {
    const out = renderFindingsSection([{ file: "x.ts", line: 42, severity: "low", issue: "y" }]);
    expect(out).toContain("x.ts:42");
  });
});
