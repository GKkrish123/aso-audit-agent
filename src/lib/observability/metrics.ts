import { getLogger } from "./logger";

type Tags = Record<string, string | number | boolean | undefined>;

class MetricsAdapter {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  private key(name: string, tags?: Tags): string {
    if (!tags) return name;
    const entries = Object.entries(tags)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(",");
    return entries ? `${name}{${entries}}` : name;
  }

  increment(name: string, tags?: Tags, value = 1): void {
    const k = this.key(name, tags);
    this.counters.set(k, (this.counters.get(k) ?? 0) + value);
    getLogger().debug({ metric: k, value }, "counter");
  }

  observe(name: string, valueMs: number, tags?: Tags): void {
    const k = this.key(name, tags);
    const arr = this.histograms.get(k) ?? [];
    arr.push(valueMs);
    if (arr.length > 1024) arr.shift();
    this.histograms.set(k, arr);
    getLogger().debug({ metric: k, valueMs }, "histogram");
  }

  async time<T>(
    name: string,
    fn: () => Promise<T>,
    tags?: Tags,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.observe(name, performance.now() - start, { ...tags, ok: true });
      return result;
    } catch (err) {
      this.observe(name, performance.now() - start, { ...tags, ok: false });
      throw err;
    }
  }

  snapshot(): {
    counters: Record<string, number>;
    histograms: Record<string, { count: number; p50: number; p95: number; p99: number }>;
  } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters.entries()) counters[k] = v;

    const histograms: Record<
      string,
      { count: number; p50: number; p95: number; p99: number }
    > = {};
    for (const [k, values] of this.histograms.entries()) {
      const sorted = [...values].sort((a, b) => a - b);
      const pick = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      histograms[k] = {
        count: sorted.length,
        p50: pick(0.5) ?? 0,
        p95: pick(0.95) ?? 0,
        p99: pick(0.99) ?? 0,
      };
    }
    return { counters, histograms };
  }
}

let cached: MetricsAdapter | undefined;
export function getMetrics(): MetricsAdapter {
  if (!cached) cached = new MetricsAdapter();
  return cached;
}
