import { describe, it, expect, beforeEach, vi } from "vitest";

describe("assertModelConfigured", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "OPENROUTER_API_KEY",
      "CUSTOM_MODEL_URL",
      "CUSTOM_MODEL_API_KEY",
      "PRIMARY_MODEL",
      "FALLBACK_MODELS",
    ]) {
      delete process.env[k];
    }
  });

  it("throws a clear error when PRIMARY_MODEL needs a key that is missing", async () => {
    process.env.PRIMARY_MODEL = "openai/gpt-5.5";
    const envMod = await import("@/lib/env");
    envMod._resetEnvCache();
    const { assertModelConfigured, ModelConfigError } = await import("./llm-client");
    expect(() => assertModelConfigured()).toThrow(ModelConfigError);
    expect(() => assertModelConfigured()).toThrow(/OPENAI_API_KEY/);
  });

  it("passes when the matching API key is set", async () => {
    process.env.PRIMARY_MODEL = "openai/gpt-5.5";
    process.env.OPENAI_API_KEY = "sk-test";
    const envMod = await import("@/lib/env");
    envMod._resetEnvCache();
    const { assertModelConfigured } = await import("./llm-client");
    expect(() => assertModelConfigured()).not.toThrow();
  });

  it("requires CUSTOM_MODEL_API_KEY when CUSTOM_MODEL_URL is set", async () => {
    process.env.CUSTOM_MODEL_URL = "https://example.com/v1";
    process.env.PRIMARY_MODEL = "custom/some-model";
    const envMod = await import("@/lib/env");
    envMod._resetEnvCache();
    const { assertModelConfigured } = await import("./llm-client");
    expect(() => assertModelConfigured()).toThrow(/CUSTOM_MODEL_API_KEY/);
  });
});

describe("getAgentModel custom endpoint id preservation", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of [
      "OPENAI_API_KEY",
      "CUSTOM_MODEL_URL",
      "CUSTOM_MODEL_API_KEY",
      "PRIMARY_MODEL",
      "FALLBACK_MODELS",
    ]) {
      delete process.env[k];
    }
  });

  it("prepends 'custom/' so Mastra forwards the full upstream model id", async () => {
    process.env.CUSTOM_MODEL_URL = "https://integrate.api.nvidia.com/v1";
    process.env.CUSTOM_MODEL_API_KEY = "nvapi-xxx";
    process.env.PRIMARY_MODEL = "openai/gpt-oss-20b";
    const envMod = await import("@/lib/env");
    envMod._resetEnvCache();
    const { getAgentModel } = await import("./llm-client");
    const cfg = getAgentModel() as { id: string; url: string; apiKey: string };
    expect(cfg.id).toBe("custom/openai/gpt-oss-20b");
    expect(cfg.url).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("does not double-prefix when the user already wrote 'custom/...'", async () => {
    process.env.CUSTOM_MODEL_URL = "https://integrate.api.nvidia.com/v1";
    process.env.CUSTOM_MODEL_API_KEY = "nvapi-xxx";
    process.env.PRIMARY_MODEL = "custom/meta/llama-3.3-70b-instruct";
    const envMod = await import("@/lib/env");
    envMod._resetEnvCache();
    const { getAgentModel } = await import("./llm-client");
    const cfg = getAgentModel() as { id: string };
    expect(cfg.id).toBe("custom/meta/llama-3.3-70b-instruct");
  });

  it("returns a bare string when no custom URL and no fallbacks", async () => {
    process.env.PRIMARY_MODEL = "openai/gpt-5.1";
    process.env.OPENAI_API_KEY = "sk-test";
    const envMod = await import("@/lib/env");
    envMod._resetEnvCache();
    const { getAgentModel } = await import("./llm-client");
    const cfg = getAgentModel();
    expect(cfg).toBe("openai/gpt-5.1");
  });
});
