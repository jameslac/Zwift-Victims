# Agent Memory / Guidelines

## Git branching workflow
Always `git fetch origin` first and create new feature branches directly off `origin/main`
(e.g. `git checkout -f -B <branch-name> origin/main`). Never stall on leftover working-tree
changes from a previously checked-out branch—reset/force-checkout cleanly onto `origin/main`
(unless continuing an existing remote branch for the same ticket).

## Architecture changes → GitHub check decision
Whenever we make an architecture change (new framework/runtime, new Worker binding, new API surface,
new data store, build/deploy change, etc.), **explicitly decide whether a new GitHub check/validator
is needed for it**, and either add it under `.github/workflows/` or note in the PR why not.

## API Exploration & Reference
Whenever planning or implementing a feature, consult [docs/API_REFERENCE.md](docs/API_REFERENCE.md)
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) across all available providers (Zwift Core,
ZwiftPower, ZwiftRacing.app, Static Game Data) to pick the best data source for the task. Whenever
new upstream endpoints, Cloudflare Worker relay routes, or payload attributes are discovered or
modified, update [docs/API_REFERENCE.md](docs/API_REFERENCE.md) in the same PR so future tickets
know what already exists.

## UI Navigation, Sub-Tabbed Layout & Page vs. Section Placement
We organize the app into distinct top-level pages with **Hybrid Navigation** (fixed 3-tab bottom bar on mobile + segmented top pill bar on desktop + slide-over utility/theme menu in `src/components/AppShell.tsx`) rather than a single long scrolling page:
- **Profile (`/` & `/riders/:riderId` → `src/pages/ProfilePage.tsx`)**: All things about the rider, organized into a compact Rider Identity Hero + **Sub-Tabs** (`Overview & Bio` | `ZwiftRacing & Phenotype` | `Power Curve & Bests`).
- **Race History (`/history` & `/riders/:riderId/history` → `src/pages/RaceHistoryPage.tsx`)**: Activity & race history feed with activity-type sub-tabs (`All`, `Races`, `Group Rides`, `Workouts`, `Free Rides`), keyword search, and click-in links to **Race Detail** (`/races/:eventId`, sub-tabbed into `Standings` | `Ratings & Impact` | `Power Curve` | `Metrics & Photos`) and **Activity Detail** (`/activities/:activityId`, sub-tabbed into `Summary & Photos` | `Effort & Physiology` | `Context & Metadata`).
- **Victims (`/victims` → `src/pages/VictimsPage.tsx`)**: Favorited rivals and pairwise Head-to-Head Win/Loss records (`src/components/ZwiftVictimsSection.tsx`).

**Rules when building a new section or feature:**
1. **Determine Page vs. Sub-Tab Placement First**: Always explicitly decide whether a new feature warrants its own dedicated page/route under `src/pages/` (and top/bottom navigation entry in `src/components/AppShell.tsx`) or should be grouped as a sub-tab/section inside an existing page (`Profile`, `Race History`, `Victims`, `Race Detail`, or `Activity Detail`). Document that placement decision in the PR summary/assumptions (or ask in PR questions if ambiguous).
2. **Use Sub-Tabs to Prevent Long Vertical Scrolling & Avoid Duplicate Data Points**: Organize multi-section pages with horizontal sub-tabs so users can switch views without excessive scrolling, and ensure each metric/data point (e.g. Level/XP, FTP W/kg, Category, vELO) appears in one authoritative place rather than being repeated across multiple cards on the same page.
3. **Modular File Organization (Minimize Merge Conflicts)**: Keep each page in its own route file under `src/pages/` and each feature section in its own isolated component under `src/components/` so parallel tickets working on different pages or sections do not collide in a monolithic file.
4. **Mobile-First & Theme-Aware Styling**: Ensure every new section is responsive on narrow mobile screens (avoid crushing rider/race names on single flex rows with action buttons; position category pills/badges cleanly on the right) and uses theme accent tokens (`bg-accent`, `text-accent-text`, `border-accent`, `var(--zv-accent)`) rather than hardcoded `#fc6719` so all user-selectable color schemes work across the board.

## Existing checks
- `ci.yml`: ESLint, typecheck + build, validators (lockfile sync, npm audit, config parse, gitleaks).
- `ai-review.yml`: Centralized AI PR reviewer (`jameslac/github-workflows/.github/workflows/ai-review.yml@main`; auto-syncs the PR description to the latest diff and posts holistic + inline review comments).

## PR Description Hygiene (Keep PR Descriptions Realigned)
Whenever you push code or logic updates to an open PR branch (whether during follow-up passes or interactive chat adjustments), **always realign the PR description** (`gh pr edit --body ...`) so it accurately describes the **current cumulative changes** on the branch rather than leaving stale first-pass notes or superseded assumptions.

Run locally before pushing: `npm run lint && npm run build`.
