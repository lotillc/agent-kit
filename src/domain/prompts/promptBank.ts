/**
 * In-memory prompt bank with runtime override support.
 *
 * A pure prompt-loader registry — no file-system I/O. Consumers load their
 * on-disk or in-repo prompts into the bank and look them up by name.
 */
export interface PromptBankEntry {
  name: string;
  description: string;
  systemPrompt: string;
  reviewInstructions?: string;
  version?: string;
}

export interface PromptBank {
  register(entry: PromptBankEntry): void;
  /** Returns the entry, or `null` if not registered. */
  get(name: string): PromptBankEntry | null;
  names(): string[];
  /** Bulk-load. Existing entries with the same name are replaced. */
  loadMany(entries: ReadonlyArray<PromptBankEntry>): void;
}

export const createPromptBank = (): PromptBank => {
  const entries = new Map<string, PromptBankEntry>();
  return {
    register(entry) {
      entries.set(entry.name, entry);
    },
    get(name) {
      return entries.get(name) ?? null;
    },
    names() {
      return [...entries.keys()];
    },
    loadMany(items) {
      for (const item of items) entries.set(item.name, item);
    },
  };
};
