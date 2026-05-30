// Wraps a credential so accidental coercion (log/JSON/inspect/template) emits
// "[REDACTED]"; call .reveal() to read. A logging guardrail, not a secret store
// or encryption — protection ends once the value is handed to a provider SDK.
export class Secret {
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  reveal(): string {
    return this.value;
  }

  toString(): string {
    return "[REDACTED]";
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[REDACTED]";
  }
}

export type SecretLike = string | Secret;

export const revealSecret = (secret: SecretLike | undefined): string | undefined => {
  if (secret === undefined) return undefined;
  return typeof secret === "string" ? secret : secret.reveal();
};

export const wrapSecret = (value: SecretLike | undefined): Secret | undefined => {
  if (value === undefined) return undefined;
  return value instanceof Secret ? value : new Secret(value);
};
