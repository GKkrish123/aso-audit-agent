# App Store Optimization(ASO) AI Audit Agent

Paste an Apple App Store URL into a chat UI and get a senior-grade ASO audit: per-dimension scores (0–10) weighted into a single 0–100 score, prioritized recommendations with before/after copy, and a competitor comparison.

Built with [Mastra](https://mastra.ai), [Next.js 16](https://nextjs.org), and [shadcn/ui](https://ui.shadcn.com). Requires Node 22.13+.

## Quick start

```bash
cp .env.example .env.local   # set PRIMARY_MODEL + matching API key
npm install
npm run dev
```

Open <http://localhost:3000> and paste e.g. `https://apps.apple.com/us/app/id324684580`.

## Configuration

Full list in [`.env.example`](.env.example). Most important:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRIMARY_MODEL` | `openai/gpt-5.5` | Any Mastra `"provider/model"` id. |
| `FALLBACK_MODELS` | _empty_ | Comma-separated failover chain. |
| `OPENAI_API_KEY` (or peer) | _empty_ | Credential for the chosen provider. |
| `MASTRA_DB_URL` | `file:./mastra.db` | LibSQL/Turso for workflow + chat persistence. |
| `FIRECRAWL_API_KEY` | _empty_ | Optional fallback scraper for App Store pages. |
| `RATE_LIMIT_RPM` / `RATE_LIMIT_BURST` | `30` / `10` | Token-bucket on mutating routes. |

## Architecture

- **Mastra workflow** (`asoAuditWorkflow`) — 3 steps with a `suspend()` for user confirmation. Snapshots persist to LibSQL, so the workflow run *is* the job store.
- **Tools** — `parse-appstore-url`, `fetch-app-metadata`, `fetch-listing-content`, `competitor-scan`. Each exports a pure function reusable outside the agent.
- **Skills** — `metadata-verification`, `scoring-normalization` (deterministic baseline), `recommendation-writer` (structured-output LLM call).
- **Chat persistence** — Chats and their bound audit live in LibSQL (`chat_sessions`, `audit_jobs`). One audit per chat; archived chats are restorable, deletable, and paginated separately from the active list.
- **Data precedence** — iTunes Lookup is canonical for structured metadata; Firecrawl markdown is preferred for long-form copy and media when `FIRECRAWL_API_KEY` is set, otherwise Cheerio scrapes the App Store HTML. Missing fields surface as partial-data warnings.
- **Reliability** — `p-retry` with exponential backoff + `AbortController` timeouts on every external call; LibSQL-backed crash recovery; per-step model fallback chain.
- **Security** — URL allowlist for outbound fetches ([`url-guard.ts`](src/lib/security/url-guard.ts)), token-bucket rate limit, zod-validated responses, pino redaction.
- **Observability** — Structured pino logs, counter/histogram metrics, and `GET /api/healthz` for scraping.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server. |
| `npm run build` / `npm start` | Production build / run. |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit`. |
| `npm test` / `test:watch` | Vitest. |

## Deployment

Default target is Vercel — [`vercel.json`](vercel.json) raises the confirm route's `maxDuration` to 120 s so audits finish in a single request. Set the env vars in the project settings and point `MASTRA_DB_URL` at hosted libsql/Turso so snapshots survive deploys. Any Node host that runs Next.js standalone (Fly.io, Render, App Runner, …) works the same way.

## Known limitations

- **Keyword field** — Apple's 100 char field is private. Only App Store Connect (OAuth + JWT-signed, app owner only) exposes it.
- **In-App Events / Custom Product Pages** — also App Store Connect-only.
- **App preview video qualitative review** — would need video download + transcription + a vision/audio model.