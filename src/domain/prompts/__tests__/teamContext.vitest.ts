import { describe, expect, test } from "vitest";

import { buildTeamPromptSection, parseTeamMarkdown } from "../teamContext.js";

const MARKDOWN = `
## Chen - Principal Engineer

**Goals:**
- Ship safely
- Keep systems observable

**Common Pushbacks:**
- Be precise about failure modes
- Refactor only when paying down debt

**Pet Peeves:**
- Silent swallowed errors

## Priya - Product

**Goals:**
- Understand user impact

## Review Questions

- Is the blast radius bounded?
- Can we revert without a migration?
`;

describe("parseTeamMarkdown", () => {
  test("extracts multiple personas with name + role + sections", () => {
    const ctx = parseTeamMarkdown(MARKDOWN);
    expect(ctx.personas.map((p) => p.name)).toEqual(["Chen", "Priya"]);
    expect(ctx.personas[0]!.role).toBe("Principal Engineer");
    expect(ctx.personas[0]!.goals).toEqual(["Ship safely", "Keep systems observable"]);
    expect(ctx.personas[0]!.pushbacks).toEqual([
      "Be precise about failure modes",
      "Refactor only when paying down debt",
    ]);
    expect(ctx.personas[0]!.petPeeves).toEqual(["Silent swallowed errors"]);
  });

  test("captures a dedicated Review Questions section", () => {
    const ctx = parseTeamMarkdown(MARKDOWN);
    expect(ctx.reviewQuestions).toEqual([
      "Is the blast radius bounded?",
      "Can we revert without a migration?",
    ]);
  });

  test("returns empty shape for empty input", () => {
    const ctx = parseTeamMarkdown("");
    expect(ctx.personas).toEqual([]);
    expect(ctx.reviewQuestions).toEqual([]);
  });

  test("preserves hyphens inside persona names by splitting on the LAST ` - `", () => {
    const ctx = parseTeamMarkdown(`
## Jean-Luc Picard - Captain

**Goals:**
- Make it so
`);
    expect(ctx.personas).toHaveLength(1);
    expect(ctx.personas[0]!.name).toBe("Jean-Luc Picard");
    expect(ctx.personas[0]!.role).toBe("Captain");
    expect(ctx.personas[0]!.goals).toEqual(["Make it so"]);
  });

  test("personas without a role render name-only", () => {
    const ctx = parseTeamMarkdown(`
## Yoda

**Goals:**
- Do or do not
`);
    expect(ctx.personas[0]!.name).toBe("Yoda");
    expect(ctx.personas[0]!.role).toBe("");
  });

  test("handles role strings that themselves contain a hyphen", () => {
    const ctx = parseTeamMarkdown(`
## Alice - Senior Engineer - SRE Team
`);
    // Only the LAST " - " separates name and role; hyphens within either
    // side are preserved.
    expect(ctx.personas[0]!.name).toBe("Alice - Senior Engineer");
    expect(ctx.personas[0]!.role).toBe("SRE Team");
  });
});

describe("buildTeamPromptSection", () => {
  test("renders personas + review questions into a markdown section", () => {
    const ctx = parseTeamMarkdown(MARKDOWN);
    const out = buildTeamPromptSection(ctx);
    expect(out).toContain("## Team Perspectives");
    expect(out).toContain("### Chen — Principal Engineer");
    expect(out).toContain("- Ship safely");
    expect(out).toContain("## Review Questions");
    expect(out).toContain("- Is the blast radius bounded?");
  });

  test("returns empty string when nothing to render", () => {
    expect(buildTeamPromptSection({ raw: "", personas: [], reviewQuestions: [] })).toBe("");
  });
});
