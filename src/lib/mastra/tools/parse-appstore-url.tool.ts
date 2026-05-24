import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  parseAppStoreUrl,
  type ParsedAppStoreUrl,
} from "@/lib/security/url-guard";

export function runParseAppStoreUrl(input: { url: string }): ParsedAppStoreUrl {
  return parseAppStoreUrl(input.url);
}

export const parseAppStoreUrlTool = createTool({
  id: "parse-appstore-url",
  description:
    "Validates and normalizes an Apple App Store URL. Returns the appId, storefront, optional slug, and canonical URL. Use this before any fetch tool to make sure the URL is safe and well-formed.",
  inputSchema: z.object({
    url: z
      .string()
      .min(1)
      .describe("Raw user-supplied Apple App Store URL."),
  }),
  outputSchema: z.object({
    appId: z.string(),
    storefront: z.string(),
    slug: z.string().optional(),
    canonicalUrl: z.string().url(),
  }),
  execute: async (inputData) => runParseAppStoreUrl(inputData),
});
