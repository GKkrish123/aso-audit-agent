import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { getLogger } from "@/lib/observability/logger";
import { getMetrics } from "@/lib/observability/metrics";
import { runParseAppStoreUrl } from "../tools/parse-appstore-url.tool";
import { runFetchAppMetadata } from "../tools/fetch-app-metadata.tool";
import { runFetchListingContent } from "../tools/fetch-listing-content.tool";
import { runCompetitorScan } from "../tools/competitor-scan.tool";
import {
  metadataVerificationSkill,
  MetadataConfirmationSchema,
} from "../skills/metadata-verification.skill";
import { scoringNormalizationSkill } from "../skills/scoring-normalization.skill";
import { recommendationWriterSkill } from "../skills/recommendation-writer.skill";
import {
  AppMetadataSchema,
  AuditReportSchema,
  CompetitorSchema,
  ListingContentSchema,
} from "@/types/audit";

const WorkflowInputSchema = z.object({
  url: z.string().min(1),
});

const WorkflowOutputSchema = z.object({
  metadata: AppMetadataSchema,
  listing: ListingContentSchema,
  competitors: z.array(CompetitorSchema),
  report: AuditReportSchema,
  warnings: z.array(z.string()).default([]),
});

const ParsedSchema = z.object({
  appId: z.string(),
  storefront: z.string(),
  canonicalUrl: z.string(),
});

const ConfirmationState = z.object({
  metadata: AppMetadataSchema.nullable().default(null),
  parsed: ParsedSchema.nullable().default(null),
  warnings: z.array(z.string()).default([]),
});

/**
 * Wrap an async hop with structured entry/exit logs so production deploys can
 * pinpoint which step is slow / stuck. Emits `{ phase, hop, durationMs, ok }`.
 */
async function timedHop<T>(
  hop: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const logger = getLogger();
  const started = performance.now();
  logger.info({ ...fields, hop, phase: "start" }, `▶ ${hop}`);
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - started);
    logger.info(
      { ...fields, hop, phase: "end", ok: true, durationMs },
      `✓ ${hop} (${durationMs}ms)`,
    );
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    logger.error(
      {
        ...fields,
        hop,
        phase: "end",
        ok: false,
        durationMs,
        err: (err as Error).message,
      },
      `✗ ${hop} failed (${durationMs}ms)`,
    );
    throw err;
  }
}

const fetchMetadataStep = createStep({
  id: "fetch-metadata",
  inputSchema: WorkflowInputSchema,
  outputSchema: z.object({
    parsed: ParsedSchema,
    metadata: AppMetadataSchema,
    confirmation: MetadataConfirmationSchema,
  }),
  stateSchema: ConfirmationState,
  execute: async ({ inputData, setState, state }) => {
    const logger = getLogger();
    const metrics = getMetrics();
    return await metrics.time("workflow.fetch_metadata", async () => {
      return await timedHop("workflow.fetch_metadata", { url: inputData.url }, async () => {
        const parsedRaw = await timedHop(
          "tool.parse_appstore_url",
          { url: inputData.url },
          async () => runParseAppStoreUrl({ url: inputData.url }),
        );
        const parsed = {
          appId: parsedRaw.appId,
          storefront: parsedRaw.storefront,
          canonicalUrl: parsedRaw.canonicalUrl,
        };
        const metadata = await timedHop(
          "tool.fetch_app_metadata",
          { appId: parsed.appId, storefront: parsed.storefront },
          async () =>
            runFetchAppMetadata({
              appId: parsed.appId,
              storefront: parsed.storefront,
            }),
        );
        const confirmation = metadataVerificationSkill.run(metadata);
        setState({ ...state, parsed, metadata, warnings: [] });
        logger.info(
          { appId: metadata.appId, storefront: metadata.storefront },
          "metadata fetched",
        );
        return { parsed, metadata, confirmation };
      });
    });
  },
});

const awaitConfirmationStep = createStep({
  id: "await-confirmation",
  inputSchema: z.object({
    parsed: ParsedSchema,
    metadata: AppMetadataSchema,
    confirmation: MetadataConfirmationSchema,
  }),
  outputSchema: z.object({
    parsed: ParsedSchema,
    metadata: AppMetadataSchema,
  }),
  resumeSchema: z.object({
    confirmed: z.boolean(),
  }),
  suspendSchema: z.object({
    confirmation: MetadataConfirmationSchema,
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ confirmation: inputData.confirmation });
    }
    if (!resumeData.confirmed) {
      throw new Error(
        "User rejected the app match. Ask them to paste a different URL.",
      );
    }
    return { parsed: inputData.parsed, metadata: inputData.metadata };
  },
});

const runAuditStep = createStep({
  id: "run-audit",
  inputSchema: z.object({
    parsed: ParsedSchema,
    metadata: AppMetadataSchema,
  }),
  outputSchema: WorkflowOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const logger = getLogger();
    const metrics = getMetrics();
    const warnings: string[] = [];
    const appId = inputData.metadata.appId;

    return await metrics.time("workflow.run_audit", async () => {
      return await timedHop("workflow.run_audit", { appId }, async () => {
        // Listing fetch + competitor scan are independent network-bound hops.
        // Running them in parallel saves the slower of the two on every audit
        // (typically 4-15s, can be more if Firecrawl or one of the iTunes
        // searches retries). Promise.all preserves error propagation - if
        // either rejects the whole audit fails fast.
        const [listing, competitorResult] = await Promise.all([
          timedHop(
            "tool.fetch_listing_content",
            { appId, canonicalUrl: inputData.parsed.canonicalUrl },
            async () =>
              runFetchListingContent({
                appId: inputData.parsed.appId,
                storefront: inputData.parsed.storefront,
                canonicalUrl: inputData.parsed.canonicalUrl,
                metadata: inputData.metadata,
              }),
          ),
          timedHop("tool.competitor_scan", { appId }, async () =>
            runCompetitorScan({ metadata: inputData.metadata }),
          ),
        ]);

        if (listing.sources.longText === "none") {
          warnings.push(
            "Could not extract description text from any source (Firecrawl, App Store HTML, iTunes Lookup); description-related scores are heuristic only.",
          );
        } else if (listing.sources.longText === "itunes") {
          warnings.push(
            "Description text came from iTunes Lookup as a last-resort fallback; Firecrawl/HTML extraction returned nothing.",
          );
        }
        if (listing.sources.screenshots === "none") {
          warnings.push(
            "No screenshots could be extracted; screenshot dimension scored as missing.",
          );
        } else if (listing.sources.screenshots === "firecrawl") {
          // Firecrawl's markdown body returns 1x1.gif placeholders for App Store
          // screenshots, so we never actually want screenshots from there. If
          // the merge picked Firecrawl it usually means iTunes had no shots
          // either - worth surfacing because the screenshot dimension is 15%.
          warnings.push(
            "Screenshot URLs came from Firecrawl - these may be placeholder/social-share images rather than real screenshots; verify visually before acting on the screenshot score.",
          );
        }

        const { competitors, fallbackReason } = competitorResult;
        if (fallbackReason) warnings.push(fallbackReason);
        logger.info(
          {
            appId,
            longText: listing.sources.longText,
            screenshots: listing.sources.screenshots,
            competitorCount: competitors.length,
            fallback: fallbackReason ?? null,
          },
          "audit inputs ready",
        );

        const { dimensionScores, overallScore } = await timedHop(
          "skill.scoring_normalization",
          { appId, competitorCount: competitors.length },
          async () =>
            scoringNormalizationSkill.run({
              metadata: inputData.metadata,
              listing,
              competitors,
            }),
        );

        if (!mastra) {
          throw new Error("Mastra instance not available in workflow context");
        }
        const report = await timedHop(
          "skill.recommendation_writer",
          { appId, baselineScore: overallScore },
          async () =>
            recommendationWriterSkill.run({
              mastra,
              agentId: "asoAuditor",
              metadata: inputData.metadata,
              listing,
              competitors,
              baselineScores: dimensionScores,
              baselineOverallScore: overallScore,
            }),
        );

        logger.info(
          { appId, score: report.overallScore },
          "audit complete",
        );

        return {
          metadata: inputData.metadata,
          listing,
          competitors,
          report: { ...report, warnings: [...warnings, ...report.warnings] },
          warnings,
        };
      });
    });
  },
});

export const asoAuditWorkflow = createWorkflow({
  id: "aso-audit",
  description:
    "Run an evidence-backed Apple App Store ASO audit. Suspends for user confirmation after fetching surface metadata, then produces a prioritized recommendation report.",
  inputSchema: WorkflowInputSchema,
  outputSchema: WorkflowOutputSchema,
})
  .then(fetchMetadataStep)
  .then(awaitConfirmationStep)
  .then(runAuditStep)
  .commit();

export { fetchMetadataStep, awaitConfirmationStep, runAuditStep };
