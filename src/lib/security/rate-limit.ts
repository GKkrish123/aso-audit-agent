// In-memory token bucket; sufficient for single-instance. Swap store for Redis in multi-instance.
import { LRUCache } from "lru-cache";
import { getEnv } from "../env";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

class RateLimiter {
  private readonly buckets: LRUCache<string, Bucket>;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(opts: { rpm: number; burst: number }) {
    this.capacity = opts.burst;
    this.refillPerMs = opts.rpm / 60_000;
    this.buckets = new LRUCache<string, Bucket>({
      max: 10_000,
      ttl: 1000 * 60 * 60, // 1h idle eviction
    });
  }

  consume(key: string, cost = 1): RateLimitResult {
    const now = Date.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket = existing
      ? {
          tokens: Math.min(
            this.capacity,
            existing.tokens + (now - existing.updatedAt) * this.refillPerMs,
          ),
          updatedAt: now,
        }
      : { tokens: this.capacity, updatedAt: now };

    if (bucket.tokens < cost) {
      const deficit = cost - bucket.tokens;
      const retryAfterMs = Math.ceil(deficit / this.refillPerMs);
      this.buckets.set(key, bucket);
      return { ok: false, remaining: Math.floor(bucket.tokens), retryAfterMs };
    }

    bucket.tokens -= cost;
    this.buckets.set(key, bucket);
    return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }
}

let cached: RateLimiter | undefined;
function get(): RateLimiter {
  if (!cached) {
    const env = getEnv();
    cached = new RateLimiter({ rpm: env.RATE_LIMIT_RPM, burst: env.RATE_LIMIT_BURST });
  }
  return cached;
}

export function consumeRateLimit(key: string, cost = 1): RateLimitResult {
  return get().consume(key, cost);
}

// Prefers forwarded IP; falls back to a stable anonymous bucket for local clients.
export function clientKeyFromRequest(req: Request): string {
  const fwd =
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || "anonymous";
}
