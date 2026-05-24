import { describe, it, expect, beforeEach, vi } from "vitest";

describe("consumeRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("permits up to burst capacity", async () => {
    process.env.RATE_LIMIT_RPM = "60";
    process.env.RATE_LIMIT_BURST = "3";
    const env = await import("@/lib/env");
    env._resetEnvCache();
    const { consumeRateLimit } = await import("./rate-limit");
    const key = `test-${Date.now()}`;
    expect(consumeRateLimit(key).ok).toBe(true);
    expect(consumeRateLimit(key).ok).toBe(true);
    expect(consumeRateLimit(key).ok).toBe(true);
    const blocked = consumeRateLimit(key);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
