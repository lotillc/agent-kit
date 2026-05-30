/**
 * Metrics port. Implementations wire to OTel, noop, or anything else.
 *
 * Minimal surface by design — counter, histogram, gauge cover every case the
 * toolkit's consumers currently need.
 */
export interface Counter {
  add(value: number, attrs?: Record<string, string | number | boolean>): void;
}

export interface Histogram {
  record(value: number, attrs?: Record<string, string | number | boolean>): void;
}

export interface Gauge {
  set(value: number, attrs?: Record<string, string | number | boolean>): void;
}

export interface Metrics {
  counter(name: string, description?: string): Counter;
  histogram(name: string, description?: string): Histogram;
  gauge(name: string, description?: string): Gauge;
}
