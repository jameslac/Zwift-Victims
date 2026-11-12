# Zwift-Victims

An installable Progressive Web App (PWA) hosted on **Cloudflare** for tracking head-to-head race records ("Zwift Victims"), historical race analytics, equipment comparisons, and performance metrics with friends on Zwift.

## Documentation & Planning
We document all architectural decisions, domain rules, and unofficial API references in the [`docs/`](./docs/) folder so every new ticket or feature has a clear blueprint:

- **[Architecture & Design Decisions (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md)**
  - Project vision, All-in-One Cloudflare hosting (React PWA Static Assets + `/api/*` Stateless Worker Relay), Tech Stack (React + TypeScript + Vite + Tailwind + `vite-plugin-pwa`), and Head-to-Head Win/Loss domain rules.
- **[Zwift Ecosystem API Reference (`docs/API_REFERENCE.md`)](./docs/API_REFERENCE.md)**
  - Decision matrix and endpoint catalog for **Zwift Core API**, **ZwiftPower API**, **ZwiftRacing.app**, and **Static Game Data / Equipment Lookups**, including authentication flows and upstream community documentation links.

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

## Initial Roadmap
1. **Milestone 1: Foundation & Authentication**
   - [x] Scaffold Vite + React + TypeScript + Tailwind + PWA + Unified Cloudflare Worker (`wrangler.jsonc`).
   - [x] Implement `/api/zwift/*` proxy routes (token + allow-listed Core API) in `worker/index.ts`. (`/api/zwiftpower/*` still TODO)
   - [x] Build the Login screen & local token management (`localStorage` + auto-refresh) and verify by fetching the logged-in user's Zwift profile and friends/followees list.
2. **Milestone 2: Head-to-Head ("Zwift Victims") Win/Loss Tracker**
   - [ ] Select/manage the roster of friends (from Zwift followees or by Zwift ID search).
   - [ ] Fetch shared race history and compute pairwise `1v1` Win/Loss records across every multi-friend race.
   - [ ] Add race exclusion filters (e.g., team events like ZRL/TTT or manual race exclusions).
3. **Milestone 3: Race Deep-Dive & Equipment Inspector**
   - [ ] Inspect individual races, power splits (`15s`, `1m`, `5m`, `20m`), and equipped bike frames/wheels.
