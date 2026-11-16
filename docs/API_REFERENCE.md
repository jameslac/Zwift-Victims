# Zwift Ecosystem API Reference & Service Catalog

Because Zwift does not offer an open public developer portal for hobbyist web apps, community applications rely on four distinct data sources.

This document serves as our **central reference guide** so that whenever we pick up a new ticket or feature, we immediately know **which service has the data**, **how it authenticates**, **which endpoints & Cloudflare Worker relay routes already exist**, **every attribute those payloads expose**, and **where upstream community documentation lives**.

---

## Quick Decision Matrix: Which Service Should a Ticket Use?

| Feature / Use Case | Primary Service | Secondary Service | Why? |
| :--- | :--- | :--- | :--- |
| **User Login & Token Refresh** | **1. Zwift Core OAuth** | — | Returns standard OIDC JWT (`access_token` + `refresh_token`) used across Zwift services. |
| **User Profile, Avatar, Weight, Height, FTP, Following/Friends List** | **1. Zwift Core API** | **3. ZwiftRacing.app** | Real-time official profile and social graph (`followers` / `followees`); ZwiftRacing adds vELO, CP/AWC, Compound Score, and phenotype. |
| **Consolidated Race History List (At-a-Glance)** | **2. ZwiftPower API** | **3. ZwiftRacing.app** | ZwiftPower provides full multi-year race history and power/HR metrics; ZwiftRacing enriches recent races (~90 days) with true placings (including private riders), course data, and vELO. |
| **Official Unfiltered Event Results & >90-Day Fallback** | **1. Zwift Core API** | **2. ZwiftPower** | Zwift Core `/api/race-results/entries` has EVERY finisher regardless of event age or ZwiftPower opt-in + equipped bike/wheel IDs. |
| **Filtered Race Results, DQs, ZP Categories, 15s/1m/5m/20m W/kg Splits** | **2. ZwiftPower API** | **1. Zwift Core API** | ZwiftPower applies category enforcement/DQ tags (`UPG`, `WKG`, `HR`) and pre-calculates critical power intervals per race. |
| **Equipment Used in a Race (Bike Frame & Wheels)** | **1. Zwift Core API** | **4. Static Game Data** | Zwift Core subgroup results & activity payloads include numeric `frameId` and `wheelId`; Static Game Data maps those IDs to actual bike/wheel names & aero/weight stats. |
| **Activity Telemetry (Second-by-Second Power, HR, Cadence, Altitude, `.fit` file)** | **1. Zwift Core API** | — | Provides S3 bucket/key (`fitFileBucket` / `fitFileKey`) to raw `.fit` files and full activity snapshots. |
| **Rider Skill Rating (vELO), Phenotype (Sprinter/Climber), Race Difficulty** | **3. ZwiftRacing.app** | — | Best source for compound rider ratings (`vELO`), phenotype classification, Strength of Field (`eventRating`), and expected finishing rank. |

---

## Implemented Worker Relay Routes (`worker/index.ts`) & Client Helpers (`src/api/*`)

All browser calls hit same-origin `/api/*` endpoints exposed by [worker/index.ts](../worker/index.ts), which enforces path/query allowlists and manages auth/cookie forwarding.

| Worker Route | Query Params Allowed | Upstream Target | Client Helper (`src/api/*`) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/health` | — | Local Worker | — | Health check JSON (`{ status, service, timestamp }`). |
| `POST /api/zwift/auth/token` | — | `secure.zwift.com/.../token` | `login`, `refresh` (`zwiftCore.ts`) | Relays `password` and `refresh_token` grants using `client_id: Zwift_Mobile_Link`. |
| `GET /api/zwift/api/profiles/me` | — | `us-or-rly101.zwift.com` | `fetchMyProfile` (`zwiftCore.ts`) | Requires `Authorization: Bearer <token>`. |
| `GET /api/zwift/api/profiles/{riderId}` | — | `us-or-rly101.zwift.com` | `fetchProfileById` (`zwiftCore.ts`) | Public profile lookup for any rider ID. |
| `GET /api/zwift/api/profiles/{riderId}/followees` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker (no UI helper yet)* | Riders followed by `{riderId}`. |
| `GET /api/zwift/api/profiles/{riderId}/followers` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker (no UI helper yet)* | Riders following `{riderId}`. |
| `GET /api/zwift/api/profiles/{riderId}/activities` | `start`, `limit` | `us-or-rly101.zwift.com` | `fetchRiderActivities` (`zwiftCore.ts`) | Returns activity feed (`ZwiftActivity[]`). |
| `GET /api/zwift/api/profiles/{riderId}/activities/{activityId}` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker* | Alternate rider-scoped activity detail path. |
| `GET /api/zwift/api/activities/{activityIdStr}` | `fetchSnapshots`, `fetchEvent` | `us-or-rly101.zwift.com` | `fetchActivityDetail` (`zwiftCore.ts`) | Calls with `?fetchSnapshots=true&fetchEvent=true`; always pass `id_str` (64-bit safe). |
| `GET /api/zwift/api/race-results/entries` | `event_subgroup_id` | `us-or-rly101.zwift.com` | `fetchRaceResults` (`zwiftCore.ts`) | Unfiltered finisher entries for a category subgroup. |
| `GET /api/zwift/api/public/events/{eventId}` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker (no UI helper yet)* | Event details and `eventSubgroups` mapping. |
| `GET /api/zwiftpower/cache3/profile/{riderId}_all.json` | — | `zwiftpower.com` | `fetchZwiftPowerRaces` (`zwiftPower.ts`) | Full rider race history; Worker seeds CloudFront cookies and retries once on `403`. |
| `GET /api/zwiftpower/cache3/results/{eventId}_(view\|zwift).json` | — | `zwiftpower.com` | *Allowlisted in Worker (no UI helper yet)* | Filtered (`_view`) or unfiltered (`_zwift`) event results on ZwiftPower. |
| `GET /api/zwiftracing/riders/{riderId}` | — | `zwiftracing.app/riders/{riderId}` | `fetchZwiftRacingRider` (`zwiftRacing.ts`) | Scrapes SSR HTML via [seroval.ts](../worker/seroval.ts) (`self.$R`) and returns `{ rider, overview }`. |

---

## 1. Zwift Core / Mobile API (`secure.zwift.com` & `us-or-rly101.zwift.com`)

The official backend used by the **Zwift Game Client** and **Zwift Companion App**. It supports JSON (`Accept: application/json`) as well as Protocol Buffers (`Accept: application/x-protobuf-lite`). Always pass `Accept: application/json` in our web app unless decoding live world positions, and always prefer string IDs (`id_str`) over 64-bit numeric `id` fields because JS numbers lose precision past `2^53 - 1`.

### Authentication Flow
- **Endpoint:** `POST https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token`
- **Headers:** `Content-Type: application/x-www-form-urlencoded`
- **Body Parameters (Login):**
  - `client_id`: `Zwift_Mobile_Link`
  - `grant_type`: `password`
  - `username`: `<user_email>`
  - `password`: `<user_password>`
- **Body Parameters (Refresh Token):**
  - `client_id`: `Zwift_Mobile_Link`
  - `grant_type`: `refresh_token`
  - `refresh_token`: `<refresh_token>`
- **Response:** `{ access_token, refresh_token, expires_in, token_type: "bearer" }`
- **Usage on Subsequent Requests:**
  - Base URL: `https://us-or-rly101.zwift.com`
  - Header: `Authorization: Bearer <access_token>`
  - Header: `Accept: application/json`

### Key Endpoints (`https://us-or-rly101.zwift.com`) & Attribute Notes
| Endpoint | Method | Key Attributes Returned & Caveats |
| :--- | :--- | :--- |
| `/api/profiles/me` | `GET` | `id`, `publicId`, `firstName`, `lastName`, `male`, `imageSrc`, `imageSrcLarge`, `countryAlpha3`, `countryCode`, `useMetric`, `weight` (grams), `height` (mm), `ftp`, `competitionMetrics` (`racingScore`, `category`, `categoryWomen`), `socialFacts`, `privacy`, `privateAttributes`. |
| `/api/profiles/{riderId}` | `GET` | Public profile for any rider ID (same public fields as `/me`, excluding `privateAttributes`). |
| `/api/profiles/{riderId}/followees` | `GET` | List of riders that `{riderId}` follows (useful for auto-populating friends lists). |
| `/api/profiles/{riderId}/followers` | `GET` | List of riders following `{riderId}`. |
| `/api/profiles/{riderId}/activities?start=0&limit=20` | `GET` | `id_str`, `id`, `profileId`, `worldId`, `name`, `description`, `sport`, `startDate`, `endDate`, `duration`, `movingTimeInMs`, `distanceInMeters`, `totalElevation`, `avgWatts`, `calories`, `primaryImageUrl`, `fitFileBucket`, `fitFileKey`, `activityRideOnCount`, `activityCommentCount`, `privacy`, `utcOffsetMinutes`, nested `profile` snapshot. **Caveat:** `avgWatts` covers the entire recorded activity (including warm-up/cooldown) rather than race-only effort, and no race placing or category is returned here. |
| `/api/activities/{id_str}?fetchSnapshots=true&fetchEvent=true` | `GET` | Detailed single activity: `maxWatts`, `avgHeartRate`, `maxHeartRate`, `avgCadenceInRotationsPerMinute`, `maxCadenceInRotationsPerMinute`, `avgSpeedInMetersPerSecond`, `fitnessData` (`fullDataUrl`, `smallDataUrl`), `eventInfo` (`id`, `eventSubGroupId`, `name`, `laps`, `subgroupTotalEntrantCount`, `eventSubgroups`), `subgroupResults` (`topResults`, `nearPlayerResults`). |
| `/api/public/events/{eventId}` | `GET` | Event details, route ID, distance/laps, rules, and `eventSubgroups` (each category A/B/C/D/E maps to its own numeric `id` = `event_subgroup_id`). |
| `/api/race-results/entries?event_subgroup_id={subgroupId}` | `GET` | **Unfiltered subgroup finishers** (crucial fallback for Race Detail & >90-day races outside ZwiftRacing's window): `rank`, `profileId`, `eventSubgroupId`, `profileData` (`firstName`, `lastName`, `gender`, `weightInGrams`, `heightInCentimeters`), `activityData` (`activityId`, `durationInMilliseconds`, `endDate`, `segmentDistanceInCentimeters`, `elevationInCentimeters`, `calories`), `sensorData` (`avgWatts`, `heartRateData`, `powerType`, `pairedSteeringDevice`), `flaggedCheating`, `flaggedSandbagging`, `criticalP` (`criticalP15Seconds`, `1Minute`, `5Minutes`, `20Minutes`), plus equipped `frameId`/`wheelId`. |

### Community Reference Links for Zwift Core API
- **TypeScript Wrapper & Types:** [`rally25rs/zwift-api-wrapper`](https://github.com/rally25rs/zwift-api-wrapper) (Inspect `src/zwift-api.ts` and `src/types/` for payload schemas).
- **Endpoint Documentation:** [`strukturunion-mmw/zwift-api-documentation`](https://github.com/strukturunion-mmw/zwift-api-documentation)
- **Protobuf & Mobile API Reference:** [`Ogadai/zwift-mobile-api`](https://github.com/Ogadai/zwift-mobile-api)

---

## 2. ZwiftPower API (`zwiftpower.com`)

ZwiftPower is a PHP-based platform backed by cached JSON files (`cache3/`) and dynamic DataTables scripts (`api3.php`). It is our primary race-list source because it returns a rider's full historical race log in a single fast request with clean race-only power, HR, and critical-power splits.

### Cookie & Authentication Flow
- CloudFront sits in front of `zwiftpower.com/cache3/*` and blocks bare requests without session cookies.
- Our Cloudflare Worker (`worker/index.ts`) seeds cookies by fetching `https://zwiftpower.com/ucp.php?mode=login&login=external&oauth_service=oauthzpsso` with `redirect: 'manual'`, caches the `Set-Cookie` pairs in memory, and refreshes them automatically if upstream returns `403`.

### Key Endpoints (`https://zwiftpower.com`)
| Endpoint | Method | What It Returns |
| :--- | :--- | :--- |
| `/cache3/profile/{riderId}_all.json` | `GET` | `{ data: ZwiftPowerRaceEntry[] }` — Rider's entire ZwiftPower race & event history in one JSON response. |
| `/cache3/profile/{riderId}_rider.json` | `GET` | Rider's ZP summary profile, team affiliation, category status, and zPoints. |
| `/cache3/results/{eventId}_view.json` | `GET` | Official filtered results for event `{eventId}` (`zid`), with finish times, critical power splits, weight at race time, and DQ/enforcement flags. |
| `/cache3/results/{eventId}_zwift.json` | `GET` | Unfiltered raw finishers list on ZwiftPower for `{eventId}`. |
| `/api3.php?do=event_results&zid={eventId}` | `GET` | Dynamic DataTables fallback when `cache3` static JSON is unavailable or live. |

### Observed Attribute Schema: `/cache3/profile/{riderId}_all.json`
> **Tuple convention:** Many power/HR fields are two-element tuples `[value, flag]` (e.g., `avg_power: [163, 0]`, `avg_wkg: ["2.4", 0]`, `hrmax: [0, 0]`); use element `[0]` when non-empty.
> **Private-rider caveat:** ZwiftPower omits riders who are not opted in or have private profiles, so `position_in_cat` and `pos` can undercount competitors and show false podiums.

- **Event & Filter Classification:** `zid` (event ID), `event_title`, `event_date` (unix seconds), `f_t` (space-delimited type tags: races contain `TYPE_RACE` / `TYPE_TT`; group rides/workouts carry `TYPE_RIDE` / `TYPE_WORKOUT`), `distance` (km), `laps`, `dur`, `rt`, `reg`, `fl`.
- **Placing & Status:** `pos` (overall filtered ZP place), `position_in_cat` (category filtered ZP place), `display_pos`, `category` (`A+`, `A`, `B`, `C`, `D`, `E`), `upg` (`1` if upgraded), `penalty` (`"DQ"`, `"WKG"`, `"HR"`, `"UPG"`, or `""`), `zada`, `strike`, `info`, `info_notes`, `note`.
- **Timing:** `time` (`[raceTimeSec, flag]`), `time_gun`, `gap` (seconds behind category winner), `lag`, `vtta`, `vttat`.
- **Power, W/kg & Heart Rate Splits:** `avg_power`, `np` (Normalized Power), `avg_wkg`, `ftp`, `wftp`, `wkg_ftp`, `is_guess`, `wkg_guess`, `power_type`, `src`, `avg_hr`, `max_hr`, `hrmax`, `hrm`, `hrr`, `hreff`, and interval pairs `w5`/`wkg5`, `w15`/`wkg15`, `w30`/`wkg30`, `w60`/`wkg60`, `w120`/`wkg120`, `w300`/`wkg300`, `w1200`/`wkg1200`.
- **Team & ZP Ranking Internals:** `tid`, `tname`, `tc`, `tbc`, `tbd`, `div`, `divw`, `skill`, `skill_b`, `skill_gain`, `pts`, `pts_pos`, `cp`, `zeff`.
- **Rider Snapshot at Race Time:** `zwid`, `res_id`, `uid`, `name`, `male`, `age`, `flag`, `height`, `weight`, `friend`, `label`, `pt`, `DT_RowId`.

### Community Reference Links for ZwiftPower API
- **TypeScript Implementation:** [`rally25rs/zwift-api-wrapper`](https://github.com/rally25rs/zwift-api-wrapper) (Inspect `src/zwift-power-api.ts` for SSO redirect handling and endpoint patterns).
- **Python ZP Fetcher Reference:** [`puckdoug/zpdatafetch`](https://github.com/puckdoug/zpdatafetch) (Documents `cache3` JSON structures and fields).

---

## 3. ZwiftRacing.app API (`zwiftracing.app` / `api.zwiftracing.app`)

ZwiftRacing.app computes community **vELO ratings** (`v2` and legacy), **Compound Score**, **Power Phenotype**, and **true category standings** (retaining private/hidden Zwift riders that ZwiftPower drops).

### How We Fetch It Currently (`/api/zwiftracing/riders/{riderId}`)
- Instead of requiring a developer API token upfront, `worker/index.ts` fetches the SSR HTML page `https://zwiftracing.app/riders/{riderId}` and [worker/seroval.ts](file:///Users/jamesandrelacour/Documents/GitHub/Zwift-Victims/worker/seroval.ts) parses the embedded `self.$R` seroval hydration stream into `{ rider, overview }`.
- **Window caveat:** `overview.history` on the public SSR page covers roughly the last **~90 days** of scored races.
- Reference docs for their hosted API: `https://www.zwiftracing.app/reference`.

### Observed Attribute Schema: `rider` (Rider Profile)
*(Deferred from Race History cards; available for the Rider Profile enhancement ticket.)*
- **Identity & Status:** `riderId`, `name`, `imageSrc`, `country`, `male`, `age`, `height`, `weight`, `zpCategory`, `zpFTP`, `visibility`, `banned`, `optOut`, `club` (`clubId`, `name`, `backgroundColor`, `textColor`, `borderColor`).
- **Ratings & Power Model:**
  - `velo`: `race` (current v2 vELO), `timeTrial`, `handicap`, `max30`, `max90`, `factors` (multiplier factors), `skill`
  - `seed`: `race`, `factors`
  - `power`: `CP` (Critical Power), `AWC` (Anaerobic Work Capacity), `compoundScore`, `powerRating`, `w5`–`w1200`, `wkg5`–`wkg1200`
  - `phenotype`: `label` (`Sprinter`, `Puncheur`, `Pursuiter`, `Time Trialist`, `Climber`, `All-Rounder`), `value`, `bias`, `scores`, `confidence`
- **Career Totals & Series Points:** `race` (`finishes`, `wins`, `podiums`, `dnfs`), `points`.

### Observed Attribute Schema: `overview` & `overview.history[i]` (Race History)
- **Top-level `overview`:** `riderId`, `days` (~90), `latest`, `history` (`ZwiftRacingRaceEntry[]`), `scoring`, `rankings`, `gcOverallPlace`, `legacyRatings` (`live`, `max30`, `max90`, `max30Expires`, `max90Expires`), `legacyHistory`.
- **Per-race `overview.history[i]`:**
  - `event`: `eventId` (matches ZwiftPower `zid`), `time` (unix seconds), `title`, `type` (`"Race"`, etc.), `subType` (`"Scratch"`, `"Points"`, `"iTT"`, `"TTT"`, etc.), `imageUrl`, `subgroupId` (`A`–`E`), `distance` (km), `elevation` (meters), `numLaps`, `routeName`, `scoringEnabled`, `resultsFinalized`.
  - `place`: `positionInCategory` (true category finish **including private riders**), `penTotal` (total category entrants), `didNotFinish`, `disqualified`.
  - `race`: `time` (sec), `gap` (sec), `source`, `weight`, `height`, `age`, `distance`, `wkgAvg`, `wkg5`, `wkg15`, `wkg30`, `wkg60`, `wkg120`, `wkg300`, `wkg1200`.
  - `sensor`: `powerType`, `steering`, `trainerDifficulty`, `heartRateMonitor`.
  - `velo`: `intensity`, `seed`, `elo` (`before`, `after`, `eventRating` [SOF], `expectedPosition`, `adjustedChange`, `rawChange`, `factors`), `points` (`value`, `gc`, `sprint`, `climb`, `tt`).
  - `legacy` (`rating`, `ratingBefore`, `ratingDelta`, `eventRating`), `pointsStatus`, `classement`.

---

## 4. Static Game Data & Equipment Lookup (`zwift-data` & `.fit` Files)

When the Zwift Core API returns an activity or race result, it identifies routes, worlds, bike frames, and wheels by **numeric IDs** (e.g., `routeId: 2144768324`, `frameId: ...`). To display human-readable names and analyze equipment performance (e.g., Tron bike vs. S-Works Tarmac SL8 + ENVE SES 4.5 Pro wheels), we map those IDs against community-maintained static datasets:

### Key Community Repositories to Reference / Bundle
1. **[`andipaetzold/zwift-data`](https://github.com/andipaetzold/zwift-data)** (Updated regularly, installable via npm or fetched as JSON):
   - **Worlds & Routes:** Route names, distances, elevation gain, lead-in distance, and Strava segment links.
   - **Segments:** Sprint and KOM arches per world.
2. **Zwift Equipment / Frame & Wheel IDs (`bikes` & `wheels` lookup tables):**
   - Game asset dictionaries extracted from `ZwiftApp` log/asset files that map `frameId` and `wheelId` integers to frame/wheel names, star ratings, and community-tested CdA (aero) and weight parameters (similar to ZwiftER / ZwiftInsider speed test data).
3. **`.fit` File Parsing (Client-Side in Browser):**
   - Using `@garmin/fitsdk` (official Garmin FIT TypeScript SDK) in the browser to parse `.fit` files downloaded from Zwift's S3 bucket (`fitFileBucket` / `fitFileKey` from `/api/profiles/{riderId}/activities`) for second-by-second power, draft savings, heart rate, cadence, and gradient analysis.
