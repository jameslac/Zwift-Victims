# Zwift Ecosystem API Reference & Service Catalog

Because Zwift does not offer an open public developer portal for hobbyist web apps, community applications rely on four distinct data sources.

This document serves as our **central reference guide** so that whenever we pick up a new ticket or feature, we immediately know **which service has the data**, **how it authenticates**, **which endpoints & Cloudflare Worker relay routes already exist**, **every attribute those payloads expose**, and **where upstream community documentation lives**.

---

## Quick Decision Matrix: Which Service Should a Ticket Use?

| Feature / Use Case | Primary Service | Secondary Service | Why? |
| :--- | :--- | :--- | :--- |
| **User Login & Token Refresh** | **1. Zwift Core OAuth** | — | Returns standard OIDC JWT (`access_token` + `refresh_token`) used across Zwift services. |
| **User Profile, Avatar, Weight, Height, FTP, Following/Friends List** | **1. Zwift Core API** | **3. ZwiftRacing.app** | Real-time official profile and social graph (`followers` / `followees`); ZwiftRacing adds vELO, CP/AWC, Compound Score, and phenotype. |
| **Power Curve & Personal Bests (5s – 60m), zFTP, zMAP, VO2max** | **1. Zwift Core API** | **2. ZwiftPower API** | Zwift Core `/api/power-curve/power-profile` supplies personal all-time (`cpBestEfforts`) & rolling 90-day (`relevantCpEfforts`) bests across all rides plus `zftp`, `zmap`, and `vo2max`; ZwiftPower supplies all-time race-only splits (`5s`–`20m`) + sustained full-race averages up to `60m`. |
| **Consolidated Activity & Race History List (At-a-Glance)** | **2. ZwiftPower API** + **1. Zwift Core API** | **3. ZwiftRacing.app** | ZwiftPower provides multi-year race/TT/group-ride/workout events with clean race power & HR splits; Zwift Core `/api/profiles/{riderId}/activities` adds free rides, solo workouts, runs, and 64-bit `id_str` links; ZwiftRacing enriches ~90 days of races with true placings, course metadata, and vELO. |
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
| `GET /api/zwift/api/profiles/me` | — | `us-or-rly101.zwift.com` | `fetchMyProfile` (`zwiftCore.ts`) | Requires `Authorization: Bearer <token>`. Falls back to `/api/profiles/{id}` and merges when `competitionMetrics` is null/missing. |
| `GET /api/zwift/api/profiles/{riderId}` | — | `us-or-rly101.zwift.com` | `fetchProfileById` (`zwiftCore.ts`) | Public profile lookup for any rider ID (populates `competitionMetrics`). |
| `GET /api/zwift/api/power-curve/power-profile` | — | `us-or-rly101.zwift.com` | `fetchPowerProfile` (`zwiftCore.ts`) | Authenticated user's Zwift Feed power curve (`cpBestEfforts` all-time, `relevantCpEfforts` rolling 90-day across all Zwift activities, `zftp`, `zmap`, `vo2max`). Also allowlists `/api/power-curve/(best-all-time\|all-time\|best)`. |
| `GET /api/zwift/api/competition-metrics/{riderId}` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker (no UI helper yet)* | Rider competition / category enforcement metrics lookup. |
| `GET /api/zwift/api/profiles/{riderId}/followees` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker (no UI helper yet)* | Riders followed by `{riderId}`. |
| `GET /api/zwift/api/profiles/{riderId}/followers` | — | `us-or-rly101.zwift.com` | *Allowlisted in Worker (no UI helper yet)* | Riders following `{riderId}`. |
| `GET /api/zwift/api/profiles/{riderId}/activities` | `start`, `limit` | `us-or-rly101.zwift.com` | `fetchRiderActivities` (`zwiftCore.ts`) | Returns activity feed (`ZwiftActivity[]`). |
| `GET /api/zwift/api/profiles/{riderId}/activities/{activityId}` | — | `us-or-rly101.zwift.com` | `fetchRiderActivityDetail` (`zwiftCore.ts`) | Alternate rider-scoped activity detail path (used as fallback on `ActivityDetailPage`). |
| `GET /api/zwift/api/activities/{activityIdStr}` | `fetchSnapshots`, `fetchEvent` | `us-or-rly101.zwift.com` | `fetchActivityDetail` (`zwiftCore.ts`) | Calls with `?fetchSnapshots=true&fetchEvent=true`; always pass `id_str` (64-bit safe). |
| `GET /api/zwift/activities/{activityIdStr}/fit` | `riderId` (optional) | `us-or-rly101.zwift.com` → Zwift S3 bucket | `fetchActivityFitFile` (`zwiftCore.ts`) | Resolves authoritative `fitFileBucket`/`fitFileKey` server-side (with `/api/profiles/{riderId}/activities/{id}` fallback), downloads `.fit` from allowlisted Zwift S3 hosts without forwarding `Authorization` to S3, and verifies the `.FIT` signature. |
| `GET /api/zwift/activities/{activityIdStr}/fitness-data` | `riderId` (optional) | `us-or-rly101.zwift.com` → `fitnessData.fullDataUrl` | `fetchActivityFitnessData` (`zwiftCore.ts`) | Resolves `fitnessData.fullDataUrl` (or `smallDataUrl`) server-side on allowlisted `zwift.com` / `amazonaws.com` / `cloudfront.net` hosts (forwarding `Authorization` only to `*.zwift.com`) as a telemetry JSON fallback. |
| `GET /api/zwift/api/race-results/entries` | `event_subgroup_id` | `us-or-rly101.zwift.com` | `fetchRaceResults` (`zwiftCore.ts`) | Unfiltered finisher entries for a category subgroup. |
| `GET /api/zwift/api/public/events/{eventId}` | — | `us-or-rly101.zwift.com` | `fetchPublicEvent` (`zwiftCore.ts`) | Event details and `eventSubgroups` mapping. |
| `GET /api/zwiftpower/cache3/profile/{riderId}_all.json` | — | `zwiftpower.com` | `fetchZwiftPowerRaces` (`zwiftPower.ts`) | Full rider race history; Worker seeds CloudFront cookies and retries once on `403`. |
| `GET /api/zwiftpower/cache3/results/{eventId}_(view\|zwift).json` | — | `zwiftpower.com` | `fetchZwiftPowerEventResults` (`zwiftPower.ts`) | Filtered (`_view`) or unfiltered (`_zwift`) event results on ZwiftPower. |
| `GET /api/zwiftracing/riders/{riderId}` | — | `zwiftracing.app/riders/{riderId}` | `fetchZwiftRacingRider` (`zwiftRacing.ts`) | Scrapes SSR HTML via [seroval.ts](../worker/seroval.ts) (`self.$R`) and returns `{ rider, overview }`. |
| `GET /api/zwiftracing/events/{eventId}` | — | `zwiftracing.app/events/{eventId}` | `fetchZwiftRacingEvent` (`zwiftRacing.ts`) | Scrapes SSR HTML via [seroval.ts](../worker/seroval.ts) and returns event metadata, ZRS pen ranges, and per-pen `riders[]` (with Mongoose `$__` internals stripped). |

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
| `/api/profiles/me` | `GET` | `id`, `publicId`, `firstName`, `lastName`, `male`, `imageSrc`, `imageSrcLarge`, `countryAlpha3`, `countryCode`, `useMetric`, `weight` (grams), `height` (mm), `ftp`, `achievementLevel` (`level * 100 + progressPct`), `totalExperiencePoints`, `targetExperiencePoints` (often `0` or equal to `totalExperiencePoints`; resolved via Zwift's cycling level XP curve when `<= totalExperiencePoints`), `totalGold` (Drops), `totalDistance` (meters), `totalDistanceClimbed` (meters), `socialFacts`, `privacy`, `privateAttributes`. **Caveat:** `competitionMetrics` (`racingScore`, `category`, `categoryWomen`) is returned as `null` here; `fetchMyProfile` fetches `/api/profiles/{me.id}` and merges `competitionMetrics` when missing. |
| `/api/profiles/{riderId}` | `GET` | Public profile for any rider ID (same public fields as `/me`, excluding `privateAttributes` and account-private stats, while populating `competitionMetrics`: `racingScore`, `category`, `categoryWomen`). |
| `/api/power-curve/power-profile` | `GET` | Authenticated user's personal power duration curve used by `zwift.com/feed` (`zftp`, `zmap`, `vo2max`, `validPowerProfile`, `cpBestEfforts` all-time, `relevantCpEfforts` rolling 90-day across all Zwift activities with watts, W/kg, and ISO 8601 UTC dates across 5s–40m). |
| `/api/competition-metrics/{riderId}` | `GET` | Competition & category enforcement metrics for `{riderId}` (`zftp`, `zmap`, racing score/category). |
| `/api/profiles/{riderId}/followees` | `GET` | List of riders that `{riderId}` follows (useful for auto-populating friends lists). |
| `/api/profiles/{riderId}/followers` | `GET` | List of riders following `{riderId}`. |
| `/api/profiles/{riderId}/activities?start=0&limit=20` | `GET` | `id_str`, `id`, `profileId`, `worldId`, `name`, `description`, `sport`, `startDate`, `endDate`, `duration`, `movingTimeInMs`, `distanceInMeters`, `totalElevation`, `avgWatts`, `calories`, `primaryImageUrl`, `fitFileBucket`, `fitFileKey`, `activityRideOnCount`, `activityCommentCount`, `privacy`, `utcOffsetMinutes`, nested `profile` snapshot. **Caveat:** `avgWatts` covers the entire recorded activity (including warm-up/cooldown) rather than race-only effort, and no race placing or category is returned here. |
| `/api/activities/{id_str}?fetchSnapshots=true&fetchEvent=true` | `GET` | Detailed single activity: `maxWatts`, `avgHeartRate`, `maxHeartRate`, `avgCadenceInRotationsPerMinute`, `maxCadenceInRotationsPerMinute`, `avgSpeedInMetersPerSecond`, `fitnessData` (`fullDataUrl`, `smallDataUrl`), `eventInfo` (`id`, `eventSubGroupId`, `name`, `laps`, `subgroupTotalEntrantCount`, `eventSubgroups`), `subgroupResults` (`topResults`, `nearPlayerResults`). |
| `/api/public/events/{eventId}` | `GET` | Event details, route ID, distance/laps, rules, `categoryEnforcement`, `accessExpression` (ZRS expressions use `scoring.max30`), `rangeAccessLabel`, and `eventSubgroups` (`id` = `event_subgroup_id`, `subgroupLabel`, `label` 1–5, `rangeAccessLabel`, `fromPaceValue`, `toPaceValue`; note `totalEntrantCount` is often `0` on completed events). |
| `/api/race-results/entries?event_subgroup_id={subgroupId}` | `GET` | **Unfiltered subgroup finishers** (crucial fallback for Race Detail & >90-day races outside ZwiftRacing's window): `rank`, `profileId`, `eventSubgroupId`, `profileData` (`firstName`, `lastName`, `gender`, `weightInGrams`, `heightInCentimeters`), `activityData` (`activityId`, `durationInMilliseconds`, `endDate`, `segmentDistanceInCentimeters`, `elevationInCentimeters`, `calories`), `sensorData` (`avgWatts`, `heartRateData`, `powerType`, `pairedSteeringDevice`), `flaggedCheating`, `flaggedSandbagging`, `scoreHistory` (`previousScore`/`newScore` when ZRS-ranked), `criticalP` (`criticalP15Seconds`, `1Minute`, `5Minutes`, `20Minutes`), plus equipped `frameId`/`wheelId`. |

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
- **Team & ZP Ranking Internals:** `tid`, `tname`, `tc`, `tbc`, `tbd`, `div` / `divw` (rider's actual ZP category code: `5` = `A+`, `10` = `A`, `20` = `B`, `30` = `C`, `40` = `D`, `50` = `E`), `skill`, `skill_b`, `skill_gain`, `pts`, `pts_pos`, `cp`, `zeff`.
- **Rider Snapshot at Race Time:** `zwid`, `res_id`, `uid` (prefixed by `event_subgroup_id` in `_view.json`), `name`, `male`, `age`, `flag`, `height`, `weight`, `friend`, `label` (`"1"`–`"5"` pen index), `pt`, `DT_RowId`.
- **Raw `_zwift.json` Schema Caveat:** Unlike `_view.json`, `/cache3/results/{eventId}_zwift.json` uses `watts`, `wkg`, `bpm`, `race_time`, `time_diff`, `dq_cat`, `label` (`"1"`–`"5"`), `pos`, `zwid`, `name`, `power_type`, `wkg_ftp`, and `wkg1200`.

### Community Reference Links for ZwiftPower API
- **TypeScript Implementation:** [`rally25rs/zwift-api-wrapper`](https://github.com/rally25rs/zwift-api-wrapper) (Inspect `src/zwift-power-api.ts` for SSO redirect handling and endpoint patterns).
- **Python ZP Fetcher Reference:** [`puckdoug/zpdatafetch`](https://github.com/puckdoug/zpdatafetch) (Documents `cache3` JSON structures and fields).

---

## 3. ZwiftRacing.app API (`zwiftracing.app` / `api.zwiftracing.app`)

ZwiftRacing.app computes community **vELO ratings** (`v2` and legacy), **Compound Score**, **Power Phenotype**, and **true category standings** (retaining private/hidden Zwift riders that ZwiftPower drops).

### How We Fetch It Currently (`/api/zwiftracing/riders/{riderId}` & `/api/zwiftracing/events/{eventId}`)
- Instead of requiring a developer API token upfront, `worker/index.ts` fetches the SSR HTML pages `https://zwiftracing.app/riders/{riderId}` and `https://zwiftracing.app/events/{eventId}` and [worker/seroval.ts](file:///Users/jamesandrelacour/Documents/GitHub/Zwift-Victims/worker/seroval.ts) parses the embedded `self.$R` seroval hydration stream (stripping Mongoose `$__` / `$isNew` / `_doc` metadata on event payloads).
- **Window caveat:** `overview.history` on `/riders/{riderId}` covers roughly the last **~90 days** of scored races, whereas `/events/{eventId}` returns full event details, `pens[]` (with ZRS `rangeLabel`, GPX `velo.factorWeights`, official vELO v2 `points.sof`, and Legacy v1 `results.averageRating`), `rules`, `route`, `courseProfile`, and per-pen `riders[]` (`position`, top-level legacy/overall `expectedPosition` + `expectedPlaceRange`, `velo.elo.expectedPosition` [course-weighted v2], `velo.seed.expectedPosition` [power-seed], `velo.elo.eventRating` [rider's course-weighted vELO — NOT pen SOF], `ratingBefore`, `rating`, `ratingDelta`, `phenotype`, `velo`, `wkg5`–`wkg1200`, `didNotFinish`, `disqualified`). True vELO v2 pen SOF comes from `pen.points.sof` (with `pen.riders[]` pre-race average fallback).
- Reference docs for their hosted API: `https://www.zwiftracing.app/reference`.

### Observed Attribute Schema: `rider` (Rider Profile)
*(Visualized in [ZwiftRacingProfileSection.tsx](../src/components/ZwiftRacingProfileSection.tsx); data helpers in [zwiftRacingProfile.ts](../src/lib/zwiftRacingProfile.ts).)*
- **Identity & Status:** `riderId`, `name`, `imageSrc`, `country`, `male`, `age`, `height`, `weight`, `visibility`, `banned`, `optOut`, `club` (`clubId`, `name` [may include HTML numeric entities], `backgroundColor`, `textColor`, `borderColor` — **hex strings omit leading `#`**), plus optional API fields `zpCategory`, `zpFTP`.
- **Ratings & Power Model:**
  - **Scales & Tiers:** Current **vELO v2** uses a `0–1000+` scale (Open cuts: Diamond `880+`, Ruby `800`, Emerald `720`, Sapphire `640`, Amethyst `580`, Platinum `520`, Gold `460`, Silver `400`, Bronze `350`, Copper `0`; Women cuts: `660 / 605 / 555 / 510 / 470 / 430 / 385 / 335 / 285 / 0`). Legacy **vELO1** uses Open `2200 / 1900 / 1650 / 1450 / 1300 / 1150 / 1000 / 850 / 650 / 0` (Women `1450 / 1250 / 1100 / 950 / 850 / 750 / 650 / 550 / 400 / 0`).
  - `velo`: `race` (current v2 vELO), `factors` (`sprint`, `punch`, `pursuit`, `climb`, `timeTrial`, `endurance`), `skill` ("RaceCraft" additive bonus where `velo.factors[k] = seed.factors[k] + velo.skill[k]`). Optional/v1 fields absent from live SSR: `timeTrial`, `handicap`, `max30`, `max90` (v2 30d/90d peaks are derived from `overview.history` when omitted).
  - `seed`: `race`, `factors` (same 6 factor keys).
  - `power`: `wkg5`, `wkg15`, `wkg30`, `wkg60`, `wkg120`, `wkg300`, `wkg1200`. Optional/v1 fields absent from live SSR: `CP`, `AWC`, `compoundScore`, `powerRating`, `w5`–`w1200`.
  - `phenotype`: `version` (`4` on live SSR), `label` (`"sprinter"`, `"puncheur"`, `"pursuiter"`, `"climber"`, `"tt"`, `"allRounder"`), `confidence` (`0..1`). In `version: 4`, `scores`, `value`, and `bias` are omitted on live SSR and the 5 phenotype roles (`sprinter`, `puncheur`, `pursuiter`, `climber`, `tt`) map 1:1 to `seed.factors.{sprint, punch, pursuit, climb, timeTrial}`.
- **90-Day Totals & Series Points:** `race` (`finishes`, `wins`, `podiums` [includes wins], `dnfs` over the 90-day window), `points` (`updatedAt`, `gc`, `sprint`, `climb`, `tt`).

### Observed Attribute Schema: `overview` & `overview.history[i]` (Race History)
- **Top-level `overview`:** `riderId`, `days` (~90), `latest`, `history` (`ZwiftRacingRaceEntry[]`, returned newest-first; `event.title` may have trailing whitespace/tabs), `scoring`, `rankings` (`gc`, `sprint`, `climb`, `tt` each with `ranking` `0–100` percentile, `open`/`women` `{ category, place, total }`, and `delta7d`), `gcOverallPlace` (`{ rank, total } | null`), `legacyRatings` (`live`, `max30`, `max90`, `max30Expires`, `max90Expires` on vELO1 scale), `legacyHistory` (`{ event: { eventId, time, title }, rating, archived }[]`).
- **Per-race `overview.history[i]`:**
  - `event`: `eventId` (matches ZwiftPower `zid`), `time` (unix seconds), `title`, `type` (`"Race"`, etc.), `subType` (`"Scratch"`, `"Points"`, `"iTT"`, `"TTT"`, etc.), `imageUrl`, `subgroupId` (`A`–`E`), `distance` (km), `elevation` (meters), `numLaps`, `routeName`, `scoringEnabled`, `resultsFinalized`.
  - `place`: `positionInCategory` (true category finish **including private riders**), `penTotal` (total category entrants), `didNotFinish`, `disqualified`.
  - `race`: `time` (sec), `gap` (sec), `source`, `weight`, `height`, `age`, `distance`, `wkgAvg`, `wkg5`, `wkg15`, `wkg30`, `wkg60`, `wkg120`, `wkg300`, `wkg1200`.
  - `sensor`: `powerType`, `steering`, `trainerDifficulty`, `heartRateMonitor`.
  - `velo`: `intensity`, `seed` (`before`, `after`, `eventRating`, `expectedPosition`, `confidence`, `factors`), `elo` (`before`, `after`, `eventRating` [rider's course-weighted vELO], `expectedPosition` [course-weighted vELO v2 estimate], `adjustedChange`, `rawChange`, `factors`), `points` (`value`, `gc`, `sprint`, `climb`, `tt`).
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
3. **`.fit` File Parsing & Telemetry Export (Client-Side in Browser):**
   - Using `@garmin/fitsdk` (official Garmin FIT TypeScript SDK) and `fflate` in [src/lib/fitTelemetry.ts](../src/lib/fitTelemetry.ts) to decode `.fit` files fetched via `/api/zwift/activities/{id}/fit` (with `/api/zwift/activities/{id}/fitness-data` JSON fallback) into per-second/resampled RFC-4180 CSVs, combined multi-activity CSVs, raw `.fit` downloads, ZIP bundles, and Gemini/Claude context summaries.

---

## 5. External Tool & Community Integrations

Community external deep-dive views linked directly from Race History card footers and the Race Detail Hero (`RaceExternalLinks` in [src/components/RaceUi.tsx](../src/components/RaceUi.tsx), URL builders in [src/lib/raceHistory.ts](../src/lib/raceHistory.ts)) whenever the required fields are available:

| Site / Tool | URL Format | Required Identifier(s) |
| :--- | :--- | :--- |
| **ZwiftPower Event** | `https://zwiftpower.com/events.php?zid={zid}` | ZwiftPower `zid` (`race.zp.zid`) |
| **ZwiftRacing.app Event** | `https://zwiftracing.app/events/{eventId}/{subgroup}` | ZwiftRacing `event.eventId` + category subgroup (`zr.event.subgroupId` / `zp.category`) |
| **ZwifterBikes Route** | `https://zwifterbikes.web.app/route/{routeSlug}` | Slugified ZwiftRacing `event.routeName` (`slugifyRouteName`) |
| **Zwift Activity** | `https://www.zwift.com/activity/{activityIdStr}` | 64-bit Zwift activity ID (`id_str` from `/api/profiles/{riderId}/activities`) |
| **ZwiftTools Bike Comparison** | `https://zwifttools.azurewebsites.net/bike-comparison?activity={activityIdStr}` | 64-bit Zwift activity ID (`id_str` from `/api/profiles/{riderId}/activities`) |
| **ZwiftTools Race Replay** | `https://zwifttools.azurewebsites.net/race-replay?activity_id={activityIdStr}` | 64-bit Zwift activity ID (`id_str` from `/api/profiles/{riderId}/activities`) |
