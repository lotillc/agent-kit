/**
 * Logger port. Consumers inject their preferred logger (consola, pino, a shared logging library, etc.).
 *
 * Structured logging format (ADR-0017): messages are strings, structured data goes in attrs.
 */
export interface Logger {
  info(message: string, attrs?: Record<string, unknown>): void;
  warn(message: string, attrs?: Record<string, unknown>): void;
  error(message: string, attrs?: Record<string, unknown>): void;
  debug(message: string, attrs?: Record<string, unknown>): void;
}
