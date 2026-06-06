import { z } from "zod";
import {
  classifyProductArchetype,
  intentFromArchetype,
  listingBlurb,
} from "@/lib/aso/competitor-product-archetypes";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";
import type { AppMetadata, ListingContent } from "@/types/audit";

export const CompetitorSearchIntentSchema = z.object({

  productCategory: z.string().min(3).max(120),

  userIntentSummary: z.string().min(10).max(280),

  searchTerms: z.array(z.string().min(2).max(80)).min(3).max(6),

  excludeTerms: z.array(z.string().min(2).max(40)).min(2).max(12),

  competitorNames: z.array(z.string().min(2).max(60)).min(1).max(5),
});

export type CompetitorSearchIntent = z.infer<typeof CompetitorSearchIntentSchema>;

function buildIntentPrompt(metadata: AppMetadata, listing?: ListingContent): string {
  const genres = metadata.genres?.length
    ? metadata.genres.join(", ")
    : metadata.primaryGenreName ?? "unknown";
  return [
    "You identify App Store competitors for ASO audits.",
    "Given an app's metadata, output iTunes Search terms that find DIRECT SUBSTITUTES",
    "(apps solving the same user job), NOT apps in the same store category by accident.",
    "",
    "Critical rules:",
    "- Distinguish product TYPE from store category. Example: YouTube is Photo & Video",
    "  on the App Store but competes with TikTok/Twitch/Netflix — NOT video editors like Splice/CapCut.",
    "- Example: Spotify is Music — competitors are Apple Music/YouTube Music/Pandora, NOT Netflix or Disney+.",
    "  Words like 'stream' or 'subscribe' in copy do NOT automatically mean video streaming.",
    "- searchTerms must be user-intent phrases (2–5 words), NOT genre names like 'Photo & Video'.",
    "- excludeTerms are words/phrases that appear in WRONG product types (e.g. 'video editor' for streaming).",
    "- competitorNames: 1–5 well-known direct rivals, BEST substitute first (e.g. TikTok before Netflix for YouTube).",
    "",
    `App name: ${metadata.trackName}`,
    `Developer: ${metadata.artistName}`,
    `Store categories: ${genres}`,
    "",
    "Listing copy:",
    listingBlurb(metadata, listing).slice(0, 2500),
  ].join("\n");
}

export function fallbackCompetitorSearchIntent(
  metadata: AppMetadata,
  listing?: ListingContent,
): CompetitorSearchIntent {
  const arch = classifyProductArchetype(metadata, listing);
  return intentFromArchetype(arch, metadata);
}

async function callIntentLlm(
  metadata: AppMetadata,
  listing: ListingContent | undefined,
  timeoutMs: number,
): Promise<CompetitorSearchIntent> {
  const { getMastra } = await import("@/lib/mastra");
  const mastra = getMastra();
  const agent =
    mastra.getAgentById("asoAuditor") ??
    (mastra as unknown as { getAgent: (n: string) => unknown }).getAgent(
      "asoAuditor",
    );
  if (!agent) throw new Error("asoAuditor agent not found");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const result = await (
      agent as {
        generate: (
          p: string,
          opts: {
            structuredOutput: { schema: typeof CompetitorSearchIntentSchema };
            abortSignal?: AbortSignal;
          },
        ) => Promise<{ object: unknown }>;
      }
    ).generate(buildIntentPrompt(metadata, listing), {
      structuredOutput: { schema: CompetitorSearchIntentSchema },
      abortSignal: ac.signal,
    });
    return CompetitorSearchIntentSchema.parse(result.object);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveCompetitorSearchIntent(input: {
  metadata: AppMetadata;
  listing?: ListingContent;
}): Promise<CompetitorSearchIntent> {
  const logger = getLogger();

  if (process.env.NODE_ENV === "test") {
    return fallbackCompetitorSearchIntent(input.metadata, input.listing);
  }

  const env = getEnv();
  const timeoutMs = Math.min(env.LLM_TIMEOUT_MS, 30_000);

  try {
    const intent = await callIntentLlm(input.metadata, input.listing, timeoutMs);
    logger.info(
      {
        appId: input.metadata.appId,
        productCategory: intent.productCategory,
        searchTerms: intent.searchTerms,
        excludeCount: intent.excludeTerms.length,
      },
      "Competitor search intent resolved via LLM",
    );
    return intent;
  } catch (err) {
    logger.warn(
      {
        appId: input.metadata.appId,
        err: (err as Error).message,
      },
      "Competitor search intent LLM failed; using heuristic fallback",
    );
    return fallbackCompetitorSearchIntent(input.metadata, input.listing);
  }
}

export function isExcludedCompetitor(
  intent: CompetitorSearchIntent,
  candidate: { trackName?: string; description?: string },
): boolean {
  const title = (candidate.trackName ?? "").toLowerCase();
  const body = (candidate.description ?? "").toLowerCase().slice(0, 800);
  for (const raw of intent.excludeTerms) {
    const term = raw.toLowerCase().trim();
    if (term.length < 3) continue;
    if (term.includes(" ")) {
      if (title.includes(term) || body.includes(term)) return true;
    } else if (term.length >= 5) {
      if (title.includes(term) || body.includes(term)) return true;
    } else if (title.includes(term)) {
      return true;
    }
  }
  return false;
}

export function buildSearchTermsWithIntent(
  metadata: AppMetadata,
  listing: ListingContent | undefined,
  intent: CompetitorSearchIntent,
  baseTerms: string[],
  maxTerms: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string | undefined | null): void => {
    const t = raw?.trim();
    if (!t || t.length < 2) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const t of intent.searchTerms) add(t);
  for (const t of intent.competitorNames) add(t);
  for (const t of baseTerms) {
    if (out.length >= maxTerms) break;
    add(t);
  }

  return out.slice(0, maxTerms);
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleMatchesCompetitorName(title: string, name: string): boolean {
  const t = normalizeTitle(title);
  const n = normalizeTitle(name);
  if (n.length < 2) return false;
  if (t.includes(n)) return true;
  const tFirst = t.split(" ")[0] ?? "";
  const nFirst = n.split(" ")[0] ?? "";
  return tFirst.length >= 3 && (tFirst === nFirst || tFirst.startsWith(nFirst));
}

export function intentAlignmentScore(
  intent: CompetitorSearchIntent,
  candidate: { trackName?: string; description?: string },
): number {
  const title = candidate.trackName ?? "";
  const body = (candidate.description ?? "").slice(0, 1000).toLowerCase();
  const all = `${normalizeTitle(title)} ${body}`;

  for (let i = 0; i < intent.competitorNames.length; i++) {
    if (titleMatchesCompetitorName(title, intent.competitorNames[i]!)) {
      return Math.max(0.92, 1 - i * 0.04);
    }
  }

  let termHits = 0;
  for (const term of intent.searchTerms) {
    const t = term.toLowerCase().trim();
    if (t.length >= 5 && all.includes(t)) {
      termHits += 1;
      continue;
    }
    const words = t.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0 && words.every((w) => all.includes(w))) {
      termHits += 0.75;
    }
  }
  const termScore = Math.min(1, termHits / Math.max(1, intent.searchTerms.length));

  const catWords = intent.productCategory
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  let catHits = 0;
  for (const w of catWords) if (all.includes(w)) catHits++;
  const catScore = catWords.length ? catHits / catWords.length : 0;

  return Math.min(1, 0.55 * termScore + 0.45 * catScore);
}

export function namedCompetitorRank(
  intent: CompetitorSearchIntent,
  trackName: string,
): number {
  for (let i = 0; i < intent.competitorNames.length; i++) {
    if (titleMatchesCompetitorName(trackName, intent.competitorNames[i]!)) return i;
  }
  return intent.competitorNames.length + 1;
}

const RerankSchema = z.object({
  orderedAppIds: z.array(z.string()).min(1).max(3),
});

export interface CompetitorRerankCandidate {
  appId: string;
  trackName: string;
  artistName: string;
  description?: string;
  relevance: number;
  intentAlign: number;
  compositeScore: number;
}

function buildRerankPrompt(
  metadata: AppMetadata,
  intent: CompetitorSearchIntent,
  candidates: CompetitorRerankCandidate[],
): string {
  const lines = candidates.map(
    (c, i) =>
      `${i + 1}. appId=${c.appId} | "${c.trackName}" by ${c.artistName} | relevance=${c.relevance.toFixed(2)} intent=${c.intentAlign.toFixed(2)} | ${(c.description ?? "").slice(0, 120)}`,
  );
  return [
    "Rank App Store competitors by substitutability for an ASO audit.",
    "Return the appIds of the TOP 3 direct substitutes, BEST first.",
    "Pick apps a user would realistically choose INSTEAD of the target app.",
    "Ignore same-category accidents (e.g. video editors vs streaming apps).",
    "",
    `Target: ${metadata.trackName} (${metadata.artistName})`,
    `User job: ${intent.userIntentSummary}`,
    `Product type: ${intent.productCategory}`,
    `Known rivals (preference order): ${intent.competitorNames.join(", ")}`,
    "",
    "Candidates:",
    ...lines,
  ].join("\n");
}

export async function rerankCompetitorCandidates(input: {
  metadata: AppMetadata;
  intent: CompetitorSearchIntent;
  candidates: CompetitorRerankCandidate[];
}): Promise<string[] | null> {
  if (process.env.NODE_ENV === "test" || input.candidates.length < 2) {
    return null;
  }

  const logger = getLogger();
  const env = getEnv();
  const timeoutMs = Math.min(env.LLM_TIMEOUT_MS, 20_000);

  try {
    const { getMastra } = await import("@/lib/mastra");
    const mastra = getMastra();
    const agent =
      mastra.getAgentById("asoAuditor") ??
      (mastra as unknown as { getAgent: (n: string) => unknown }).getAgent(
        "asoAuditor",
      );
    if (!agent) return null;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const result = await (
        agent as {
          generate: (
            p: string,
            opts: {
              structuredOutput: { schema: typeof RerankSchema };
              abortSignal?: AbortSignal;
            },
          ) => Promise<{ object: unknown }>;
        }
      ).generate(buildRerankPrompt(input.metadata, input.intent, input.candidates), {
        structuredOutput: { schema: RerankSchema },
        abortSignal: ac.signal,
      });
      const parsed = RerankSchema.parse(result.object);
      const valid = new Set(input.candidates.map((c) => c.appId));
      const ordered = parsed.orderedAppIds.filter((id) => valid.has(id));
      if (ordered.length === 0) return null;
      logger.info(
        { appId: input.metadata.appId, orderedAppIds: ordered },
        "Competitor rerank via LLM",
      );
      return ordered;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn(
      { appId: input.metadata.appId, err: (err as Error).message },
      "Competitor rerank LLM failed; using composite order",
    );
    return null;
  }
}

export function sortCompetitorsByRelevance<
  T extends {
    appId: string;
    trackName: string;
    userRatingCount?: number | null;
    _composite: number;
    _breakdown: Record<string, number>;
    _namedRank: number;
  },
>(ranked: T[]): T[] {
  return [...ranked].sort((a, b) => {
    if (b._composite !== a._composite) return b._composite - a._composite;
    if (a._namedRank !== b._namedRank) return a._namedRank - b._namedRank;
    const aIntent = a._breakdown.intentAlign ?? 0;
    const bIntent = b._breakdown.intentAlign ?? 0;
    if (bIntent !== aIntent) return bIntent - aIntent;
    const aRel = a._breakdown.relevance ?? 0;
    const bRel = b._breakdown.relevance ?? 0;
    if (bRel !== aRel) return bRel - aRel;
    const aCount = a.userRatingCount ?? 0;
    const bCount = b.userRatingCount ?? 0;
    if (bCount !== aCount) return bCount - aCount;
    return a.appId.localeCompare(b.appId);
  });
}
