# Zwift-Victims: Architecture & Design Decisions

## 1. Project Vision & Goals
**Zwift-Victims** is an evolving, modular Progressive Web App (PWA) hosted on **Cloudflare Workers (with Static Assets)** for a group of friends who race and ride on Zwift.

The project begins with solving a specific pain point—**accurate pairwise Head-to-Head Win/Loss records against friends** (which ZwiftPower frequently miscalculates or omits)—and is architected so new Zwift tools and analytics (historical race deep-dives, bike/wheel equipment analysis, telemetry & `.fit` file inspection, route/segment comparisons, etc.) can be added incrementally without locking into a single API or data source.

### Core Requirements
- **All-in-One Cloudflare Hosting (`wrangler.jsonc`):** Both the React PWA static frontend (`./dist`) and the `/api/*` serverless relay (`worker/index.ts`) run on a single Cloudflare Worker deployment connected directly to this GitHub repository.
- **Installable PWA (iOS, Android, Desktop):** Uses a Web App Manifest and Service Worker (`vite-plugin-pwa`) so users can "Add to Home Screen" on iOS and Android for a native-like full-screen app experience.
- **User-Owned Authentication (No Shared/Hardcoded Credentials):** Users log in with their own Zwift credentials. Credentials are never stored on a server; session tokens live strictly on the user's own device (`localStorage` / `IndexedDB`).
- **Multi-Source API Architecture:** Built with a clean service abstraction layer so any feature/ticket can pull from **Zwift Core API**, **ZwiftPower**, **ZwiftRacing.app**, or **Static Game Data (Bikes/Frames/Wheels/Routes)** as needed.

---

## 2. System Architecture

### Why All-in-One Cloudflare (Static Assets + `/api/*` Worker)?
When a web browser attempts to call `secure.zwift.com`, `us-or-rly101.zwift.com`, or `zwiftpower.com` directly from client-side JavaScript, the browser blocks the response due to **CORS (Cross-Origin Resource Sharing)** restrictions and prevents JavaScript from reading cross-domain `Set-Cookie` headers required by ZwiftPower.

By hosting both our React PWA and our stateless API Worker on **Cloudflare** under the **same domain**:
1. **Zero Cross-Origin / CORS Hassle:** The frontend calls `/api/...` on its own origin (`same-origin`).
2. **Automatic GitHub CI/CD + Preview URLs:** Pushing to `main` deploys production automatically, and every Pull Request gets its own isolated preview URL. When a PR is closed/merged or its branch is deleted, [`.github/workflows/cleanup-preview.yml`](../.github/workflows/cleanup-preview.yml) automatically removes the branch's Worker Preview via `wrangler preview delete` (requiring `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub Actions secrets).
3. **Stateless Cookie & Token Relay:** `worker/index.ts` intercepts `/api/*` requests, forwards them server-to-server to Zwift/ZwiftPower/ZwiftRacing, translates cookies/headers as needed, and serves static React assets (`env.ASSETS`) for all other routes.

```mermaid
flowchart LR
    subgraph Client ["User Device (Browser / iOS & Android PWA)"]
        UI["React + TS UI"]
        Store["Local Storage / IndexedDB\n(User Tokens & Cached Stats)"]
        Services["API Service Layer\n(Zwift / ZP / ZR / GameData)"]
        UI <--> Services
        Services <--> Store
    end

    subgraph Cloudflare ["Cloudflare Worker (Single Deployment)"]
        Assets["Static PWA Assets (./dist)"]
        Worker["/api/* Stateless Relay\n(worker/index.ts)"]
    end

    subgraph Upstream ["Upstream Unofficial APIs"]
        ZwiftAuth["secure.zwift.com\n(OAuth / OIDC Token)"]
        ZwiftCore["us-or-rly101.zwift.com\n(Core / Mobile API)"]
        ZwiftPower["zwiftpower.com\n(Race Results / Rankings)"]
        ZwiftRacing["zwiftracing.app\n(vELO / Compound Score)"]
    end

    UI <-->|"Same-Origin HTTPS"| Assets
    Services <-->|"Same-Origin /api/*"| Worker
    Worker <--> ZwiftAuth
    Worker <--> ZwiftCore
    Worker <--> ZwiftPower
    Worker <--> ZwiftRacing
```

---

## 3. Tech Stack Decisions

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | **React 19 + TypeScript + Vite 6** | Fast build times, strong typing for complex API payloads, easy modular expansion. |
| **Styling** | **Tailwind CSS v4** | Rapid responsive design optimized for both mobile (iOS/Android) and desktop dashboards. |
| **PWA Support** | **`vite-plugin-pwa`** | Auto-generates `manifest.webmanifest`, service workers, offline caching, and iOS/Android install metadata. |
| **Local Data Caching** | **`IndexedDB` / `localStorage`** | Prevents re-fetching historical races on every page load; avoids rate-limiting against Zwift/ZwiftPower. |
| **Hosting & API Relay** | **Cloudflare Workers with Static Assets (`wrangler.jsonc`)** | Unified hosting + 100,000 free API requests/day, zero cold-start latency, automatic GitHub deployments. |

---

## 4. Repository Structure

```text
Zwift-Victims/
├── docs/
│   ├── ARCHITECTURE.md       # System design, tech stack, and domain rules (this file)
│   └── API_REFERENCE.md      # Comprehensive guide to Zwift, ZwiftPower, ZwiftRacing & Game Data APIs
├── worker/
│   └── index.ts              # Cloudflare Worker handling /api/* routes + SPA static asset fallback
├── src/                      # Frontend PWA source code
│   ├── api/                  # Modular API clients (separated by upstream provider)
│   ├── domain/               # Pure business logic (e.g., Head-to-Head Win/Loss engine, exclusions)
│   ├── components/           # Shared UI components
│   ├── pages/                # Feature views (Login, Head-to-Head, Race Inspector, Garage/Equipment)
│   ├── App.tsx
│   └── main.tsx
├── wrangler.jsonc            # Unified Cloudflare Worker + Static Assets configuration
├── vite.config.ts            # Vite + React + Tailwind + PWA configuration
└── package.json
```

---

## 5. Core Domain Rules

### Feature 1: Head-to-Head (Win/Loss) Engine ("Zwift Victims")
ZwiftPower's native head-to-head and win-loss statistics often fail to count races accurately or misattribute wins. Our Head-to-Head engine enforces explicit, transparent rules:

1. **Pairwise Comparison (`1v1` Matrix within Multi-Friend Races):**
   - Whenever 2 or more tracked friends participate in the same race, **every pair of friends** generates a `1-0` / `0-1` result based on finishing order.
   - *Example:* In a race where **Friend B finishes 4th**, **Friend A finishes 5th**, and **User finishes 6th**:
     - **Friend B** goes `1-0` vs. Friend A, and `1-0` vs. User (`2-0` total from that event).
     - **Friend A** goes `0-1` vs. Friend B, and `1-0` vs. User (`1-1` total from that event).
     - **User** goes `0-1` vs. Friend B, and `0-1` vs. Friend A (`0-2` total from that event).
2. **Race Exclusions & Filters (Team Races, TTTs, Group Rides):**
   - **Team Events (e.g., ZRL / WTRL Team Time Trials or Points Races where friends ride as teammates):** Can be excluded automatically via event title/type tags (e.g. matching `ZRL`, `WTRL`, `TTT`) or toggled off via a manual "Exclude Race / Team Event" list.
   - **Category / Subgroup Options:** Support toggling whether comparisons apply only when racing in the **same category/subgroup** or across **overall event time**.

### Feature 2: Race History (At-a-Glance) vs. Race Detail (Click-In)

1. **Provider Roles for Race History:**
   - **ZwiftPower (`/cache3/profile/{id}_all.json`) — Primary Race List:** Fast single fetch returning multi-year race history with power (`avg_power`, `np`), heart rate (`avg_hr`, `max_hr`), sprint/interval power (`w5`–`w1200`, `wkg5`–`wkg1200`), team (`tname`), `upg`, and penalties. *Caveat:* Drops private/non-ZwiftPower riders from standings, inflating category placings (`position_in_cat`) and sometimes reporting false podiums.
   - **ZwiftRacing.app (`zwiftracing.app/riders/{id}` SSR) — Standings & Rating Enrichment:** Preserves private riders in `place.positionInCategory` and `place.penTotal`, and adds course metadata (`routeName`, `elevation`, `subType`), vELO metrics (`before`, `after`, `expectedPosition`, `eventRating` SOF, 6-factor breakdown), and finish status (`didNotFinish`, `disqualified`). *Caveat:* Public history covers roughly the past ~90 days. (Rider-level ZR profile attributes such as overall vELO and phenotype belong to a separate Rider Profile ticket.)
   - **Zwift Core (`/api/profiles/{id}/activities`, `/api/activities/{id_str}`, `/api/public/events/{id}`, `/api/race-results/entries`) — Click-In Race Detail & >90-Day Fallback:** Avoided on list view to prevent N+1 calls and because activity `avgWatts` includes warm-up/cooldown. Used on the Race Detail view (`/riders/:riderId/races/:eventId` & `/races/:eventId`) to pull full activity details, `.fit` references (`fitFileBucket`/`fitFileKey`), screenshots (`primaryImageUrl`), calories, and **unfiltered finisher lists (`/api/race-results/entries?event_subgroup_id=...`) so races older than ZwiftRacing's ~90-day window still resolve true placings**.

2. **Attribute Tiers:**
   - **Tier 1 — At-a-Glance Race History Card:**
     - *Placing & Integrity:* Top-right Placing Badge (`truePlace / fieldSize` from ZwiftRacing when available; muted `zpPlace (ZP*)` fallback when unscored or >90 days old; `DNF`/`DQ`/penalty states), hidden-rider inflation callout (`ZP shows X — N better than reality`), and >90-day disclaimer.
     - *Identity & Subtitle:* `event_title` / `event.title`, date (`event_date` / `event.time`), `Cat {category}` (`subgroupId`), `subType`, `routeName`, `tname` (`Team`), `eventId`, `UPG`.
     - *Core Metrics Grid (12 cards):* `Time`, `Gap`, `Distance`, `Elevation`, `Avg Power`, `NP`, `Avg W/kg`, `Avg / Max HR`, `5s Sprint` (`w5` / `wkg5`), `vELO` (`before → after`), `Expected Pos`, `SOF` (`eventRating`).
     - *External Footer Links:* Footer icon links opening in a new window/tab when their required identifiers exist on the race — ZwiftPower event (`zid`), ZwiftRacing.app event (`eventId` + `subgroup`), ZwifterBikes route (`routeName` slug), Zwift activity (`id_str`), ZwiftTools Bike Comparison (`?activity=<id_str>`), and ZwiftTools Race Replay (`?activity_id=<id_str>`).
   - **Tier 2 — Click-In Race Detail Page (`/riders/:riderId/races/:eventId` & `/races/:eventId`):**
     - *Combined Event Standings:* One unified leaderboard per pen merging Zwift Core `/api/race-results/entries`, ZwiftRacing.app `/events/{eventId}` (`vELO`, `Δ`, `phenotype`), and ZwiftPower `_view` & `_zwift` event results — highlighting the active rider, logged-in user, and favorited riders (`FavoritesContext`), displaying ZRS vs. Category Enforcement pen ranges without buggy entrant counts, showing actual rider categories (`div`/`divw`) + ZRS scores, offering a `W | W/kg` splits toggle for `5s/1m/5m/20m`, and persisting custom column visibility (`localStorage`, all on by default).
     - *Full Power & Physiology Profile:* Power curve (`5s`, `15s`, `30s`, `1m`, `2m`, `5m`, `20m` watts and W/kg across ZP, ZR, and Core `criticalP`), `wftp`/`ftp`, `hreff`/`hrr`, cadence/speed, `powerType`/`src`, `is_guess`.
     - *Rating & Event Internals:* ZR vELO `adjustedChange`/`rawChange`/`factors.*`, `velo.points`, `legacy`, ZP `skill`/`skill_gain`/`div`/`pts`, event rules & artwork (`imageUrl`), `laps`.
     - *Zwift Core Telemetry & Activity Media:* `.fit` file references & equipment IDs (`fitFileBucket`/`fitFileKey`, `frameId`/`wheelId`), photo gallery (`primaryImageUrl`, `activitySnapshots`, `snapshots`, event banner), `worldId`, `calories`, `movingTimeInMs`, `activityRideOnCount`.
     - *Customizable Sections & API Coverage Explorer:* Toggleable section visibility (`localStorage`, all on by default) plus a status matrix and collapsible attribute inspectors across all 9 race API calls.

---

## 6. UX & Platform Decisions

### Long Screenshots & Shareable Views (In-App Share Feature)
Native OS scrolling screenshots (Android Pixel **"Capture more"** and iOS **Full Page** screenshots) do not work reliably for this app across mobile browsers (Chrome on Android) or installed Home Screen PWAs (`standalone` and `minimal-ui` display modes).

- **Decision:** Keep the PWA in `display: 'standalone'` mode so the installed app retains its native-like full-screen feel, and **build a dedicated in-app Share / Snapshot feature** once the core views (Head-to-Head tables, race comparisons, equipment summaries) are fleshed out.
- **Planned Implementation:** Render purpose-built, formatted summary cards or full-view images on-device (client-side DOM/Canvas-to-PNG export paired with the mobile Web Share API `navigator.share` / image download) so users can share clean snapshots to group chats from both iOS and Android, whether in a browser tab or the installed PWA.
