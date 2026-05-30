/**
 * Notification port. Concrete SlackNotifier in PR 7.
 */
export interface Notification {
  title: string;
  body?: string;
  severity?: "info" | "warning" | "error";
  fields?: ReadonlyArray<{ label: string; value: string }>;
}

export interface Notifier {
  notify(message: Notification): Promise<void>;
}
