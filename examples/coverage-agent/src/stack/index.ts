// Coverage-agent-specific stack helpers. Generic stacked-PR utilities
// (listOpenPrs, resolveStackBase) are now consumed directly from
// `@lotiai/agent-kit/gh-cli`; the ancestry walk + quarantine-trailer parsing
// stay here because `inferSourceFromVitest` is coverage-shaped.
export * from "./commitTrailers.js";
export * from "./resolveStackBaseForRun.js";
export * from "./walkAncestry.js";
