/**
 * Parse a TEAM.md markdown file into structured personas, then render them as
 * a prompt section. Pure — caller supplies the raw markdown.
 *
 * Markdown format:
 *   `## <Name> - <Role>` headers delimit personas; under each, lists appear
 *   under `**Goals:**`, `**Common Pushbacks:**`, `**Pet Peeves:**` sections.
 */

export interface TeamPersona {
  name: string;
  role: string;
  goals: string[];
  pushbacks: string[];
  petPeeves: string[];
}

export interface TeamContext {
  raw: string;
  personas: TeamPersona[];
  reviewQuestions: string[];
}

/**
 * Parse a markdown TEAM file. Returns an empty-persona context if parsing
 * finds no H2 headers — safe default; callers can check `personas.length`.
 */
export const parseTeamMarkdown = (markdown: string): TeamContext => {
  // Strip a leading UTF-8 BOM; `trim()` doesn't remove U+FEFF, so otherwise
  // the first persona's `## Name - Role` heading wouldn't match the regex
  // (TEAM.md saved by some Windows editors / Git configs is BOM-prefixed).
  const normalized = markdown.replace(/^﻿/, "");
  const lines = normalized.split("\n");
  const personas: TeamPersona[] = [];
  const reviewQuestions: string[] = [];

  let current: TeamPersona | null = null;
  let section: "goals" | "pushbacks" | "petPeeves" | "reviewQuestions" | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      const heading = h2[1]!;
      if (/^review questions$/i.test(heading)) {
        if (current) personas.push(current);
        current = null;
        section = "reviewQuestions";
        continue;
      }
      // Split on the LAST " - " so names containing hyphens (e.g.,
      // "Jean-Luc Picard - Captain") still parse correctly. The previous
      // regex excluded "-" from the name capture group, which corrupted
      // persona metadata for hyphenated names.
      const { name, role } = splitNameAndRole(heading);
      if (current) personas.push(current);
      current = {
        name,
        role,
        goals: [],
        pushbacks: [],
        petPeeves: [],
      };
      section = null;
      continue;
    }

    if (/^\*\*Goals:\*\*/i.test(line)) {
      section = "goals";
      continue;
    }
    if (/^\*\*Common Pushbacks:\*\*/i.test(line) || /^\*\*Pushbacks:\*\*/i.test(line)) {
      section = "pushbacks";
      continue;
    }
    if (/^\*\*Pet Peeves:\*\*/i.test(line)) {
      section = "petPeeves";
      continue;
    }

    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet) {
      const text = bullet[1]!.trim();
      if (section === "reviewQuestions") {
        reviewQuestions.push(text);
      } else if (current && section) {
        current[section].push(text);
      }
    }
  }

  if (current) personas.push(current);

  return { raw: markdown, personas, reviewQuestions };
};

/**
 * Split an H2 heading into `name` and `role` on the LAST ` - ` separator so
 * names containing hyphens are preserved. Returns an empty role when no
 * separator is present.
 */
const splitNameAndRole = (heading: string): { name: string; role: string } => {
  const sep = heading.lastIndexOf(" - ");
  if (sep === -1) {
    return { name: heading.trim(), role: "" };
  }
  return {
    name: heading.slice(0, sep).trim(),
    role: heading.slice(sep + 3).trim(),
  };
};

/**
 * Format personas as a markdown prompt section suitable for injection into
 * plan / review prompts.
 */
export const buildTeamPromptSection = (team: TeamContext): string => {
  if (team.personas.length === 0 && team.reviewQuestions.length === 0) return "";
  const lines: string[] = ["## Team Perspectives", ""];
  for (const p of team.personas) {
    lines.push(`### ${p.name}${p.role ? ` — ${p.role}` : ""}`);
    if (p.goals.length > 0) {
      lines.push("**Goals:**");
      for (const g of p.goals) lines.push(`- ${g}`);
    }
    if (p.pushbacks.length > 0) {
      lines.push("**Pushbacks:**");
      for (const g of p.pushbacks) lines.push(`- ${g}`);
    }
    if (p.petPeeves.length > 0) {
      lines.push("**Pet Peeves:**");
      for (const g of p.petPeeves) lines.push(`- ${g}`);
    }
    lines.push("");
  }
  if (team.reviewQuestions.length > 0) {
    lines.push("## Review Questions");
    for (const q of team.reviewQuestions) lines.push(`- ${q}`);
  }
  return lines.join("\n").trim();
};
