import { Agent } from "@mastra/core/agent";
import { ASO_AUDITOR_SYSTEM_PROMPT } from "@/lib/aso/prompts";
import { getAgentModel } from "@/lib/providers/llm-client";
import { fetchAppMetadataTool } from "../tools/fetch-app-metadata.tool";
import { fetchListingContentTool } from "../tools/fetch-listing-content.tool";
import { competitorScanTool } from "../tools/competitor-scan.tool";
import { parseAppStoreUrlTool } from "../tools/parse-appstore-url.tool";

export const asoAuditorAgent = new Agent({
  id: "aso-auditor",
  name: "ASO Auditor",
  description:
    "Senior App Store Optimization expert that produces evidence-backed audits with prioritized recommendations.",
  instructions: ASO_AUDITOR_SYSTEM_PROMPT,
  model: getAgentModel(),
  tools: {
    parseAppStoreUrlTool,
    fetchAppMetadataTool,
    fetchListingContentTool,
    competitorScanTool,
  },
});
