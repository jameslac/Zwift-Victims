# Zwift-Victims

An installable Progressive Web App (PWA) hosted on **Cloudflare** for tracking head-to-head race records ("Zwift Victims"), historical race analytics, equipment comparisons, and performance metrics with friends on Zwift.

## Documentation & Planning
We document all architectural decisions, domain rules, and unofficial API references in the [`docs/`](./docs/) folder so every new ticket or feature has a clear blueprint:

- **[Architecture & Design Decisions (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md)**
  - Project vision, All-in-One Cloudflare hosting (React PWA Static Assets + `/api/*` Stateless Worker Relay), Tech Stack (React + TypeScript + Vite + Tailwind + `vite-plugin-pwa`), and Head-to-Head Win/Loss domain rules.
- **[Zwift Ecosystem API Reference (`docs/API_REFERENCE.md`)](./docs/API_REFERENCE.md)**
  - Decision matrix and endpoint catalog for **Zwift Core API**, **ZwiftPower API**, **ZwiftRacing.app**, and **Static Game Data / Equipment Lookups**, including authentication flows and upstream community documentation links.

## API Docs (quick links)
Zwift has no official public API docs; these community references cover `/api/profiles/me` and the rest of the Core API. More detail and endpoint tables live in [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md).
- [`strukturunion-mmw/zwift-api-documentation`](https://github.com/strukturunion-mmw/zwift-api-documentation) – endpoint documentation
- [`Ogadai/zwift-mobile-api`](https://github.com/Ogadai/zwift-mobile-api) – mobile API client & protobuf reference
- [`rally25rs/zwift-api-wrapper`](https://github.com/rally25rs/zwift-api-wrapper) – TypeScript wrapper & payload types
- [`andipaetzold/zwift-data`](https://github.com/andipaetzold/zwift-data) – static routes/bikes/wheels data
- [`puckdoug/zpdatafetch`](https://github.com/puckdoug/zpdatafetch) – ZwiftPower JSON structures

## Local Development & Deployment
```bash
# Install dependencies
npm install

# Start local Vite dev server
npm run dev

# Build production PWA + verify TypeScript
npm run build

# Deploy to Cloudflare (or let Cloudflare Git integration deploy automatically on push)
npm run deploy
```

### PR Preview Cleanup (GitHub Actions)
Every PR/branch builds an isolated Cloudflare Worker Preview via `wrangler preview` (`wrangler.jsonc` `"previews"`). [`.github/workflows/cleanup-preview.yml`](./.github/workflows/cleanup-preview.yml) calls the shared reusable workflow in [`jameslac/github-workflows`](https://github.com/jameslac/github-workflows) (`cloudflare-preview-cleanup.yml`), which automatically deletes the branch's Worker Preview via `npx wrangler preview delete --name "<branch>" --skip-confirmation` when a PR is closed/merged or its branch is deleted.

To enable automatic cleanup, add these **Repository secrets** in GitHub (**Settings → Secrets and variables → Actions**):
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with **Account → Workers Scripts → Edit** permission (for example, the **Edit Cloudflare Workers** template).
- `CLOUDFLARE_ACCOUNT_ID` — Your 32-character Cloudflare Account ID (visible on the Workers & Pages overview dashboard).

If either secret is missing, the cleanup workflow emits a warning and skips deletion without failing PR close checks.

## Initial Roadmap
1. **Milestone 1: Foundation & Authentication**
   - [x] Scaffold Vite + React + TypeScript + Tailwind + PWA + Unified Cloudflare Worker (`wrangler.jsonc`).
   - [x] Implement authenticated, allow-listed `/api/zwift/*`, `/api/zwiftpower/*`, and `/api/zwiftracing/*` relay routes in `worker/index.ts`.
   - [x] Build the Login screen & local token management (`localStorage` + auto-refresh) and verify by fetching the logged-in user's Zwift profile and stats.
2. **Milestone 2: Head-to-Head ("Zwift Victims") Win/Loss Tracker**
   - [x] Select/manage the roster of favorited rivals (by Zwift ID search or from race standings).
   - [ ] Import/browse friends directly from the Zwift followees list.
   - [x] Fetch shared race history and compute pairwise `1v1` Win/Loss records across shared races.
   - [x] Exclude team events (`ZRL` / `WTRL` / `TTT`) via toggle.
   - [ ] Add manual per-race exclusions.
3. **Milestone 3: Race Deep-Dive & Equipment Inspector**
   - [x] Inspect individual races and activities, unified pen standings, interactive power curve (`5s`–`20m`), and vELO / ZRS / ZP ratings.
   - [x] Parse `.fit` / fitness telemetry in the browser and export selected activities as per-second CSV and/or `.fit` bundles.
   - [ ] Decode equipped bike frames/wheels (`frameId` / `wheelId` lookup).
   - [x] Build an in-app **Share Interval Bests** card/PNG export.
   - [ ] Extend in-app snapshot sharing to full-view race & head-to-head summaries on iOS and Android (since native OS long screenshots are not reliably supported in mobile Chrome or installed PWAs).
