# Zwift Ecosystem API Reference & Service Catalog

Because Zwift does not offer an open public developer portal for hobbyist web apps, community applications rely on four distinct data sources. 

This document serves as our **central reference guide** so that whenever we pick up a new ticket or feature, we immediately know **which service has the data**, **how it authenticates**, **which endpoints to call**, and **where the upstream community documentation lives**.

---

## Quick Decision Matrix: Which Service Should a Ticket Use?

| Feature / Use Case | Primary Service | Secondary Service | Why? |
| :--- | :--- | :--- | :--- |
| **User Login & Token Refresh** | **1. Zwift Core OAuth** | — | Returns standard OIDC JWT (`access_token` + `refresh_token`) used across Zwift services. |
| **User Profile, Avatar, Weight, Height, FTP, Following/Friends List** | **1. Zwift Core API** | — | Real-time official profile and social graph (`followers` / `followees`). |
| **Official Unfiltered Event Results & Finishing Positions** | **1. Zwift Core API** | **2. ZwiftPower** | Zwift Core has EVERY finisher (even riders not registered on ZwiftPower) + equipped bike/wheel IDs. |
| **Filtered Race Results, DQs, ZP Categories, 15s/1m/5m/20m W/kg Splits** | **2. ZwiftPower API** | **1. Zwift Core API** | ZwiftPower applies category enforcement/DQ tags (`UPG`, `WKG`, `HR`) and pre-calculates critical power intervals per race. |
| **Equipment Used in a Race (Bike Frame & Wheels)** | **1. Zwift Core API** | **4. Static Game Data** | Zwift Core subgroup results & activity payloads include numeric `frameId` and `wheelId`; Static Game Data maps those IDs to actual bike/wheel names & aero/weight stats. |
| **Activity Telemetry (Second-by-Second Power, HR, Cadence, Altitude, `.fit` file)** | **1. Zwift Core API** | — | Provides direct S3 URLs to the raw `.fit` file and JSON fitness streams for any public activity. |
| **Rider Skill Rating (vELO), Phenotype (Sprinter/Climber), Race Difficulty** | **3. ZwiftRacing.app** | — | Best source for compound rider ratings (`vELO`), 5-minute vs. 30-second phenotypes, and predicted race rankings. |

---

## 1. Zwift Core / Mobile API (`secure.zwift.com` & `us-or-rly101.zwift.com`)

The official backend used by the **Zwift Game Client** and **Zwift Companion App**. It is a fast, RESTful API that supports JSON (`Accept: application/json`) as well as Protocol Buffers (`Accept: application/x-protobuf-lite`). Always pass `Accept: application/json` in our web app unless decoding live world positions.

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

### Key Endpoints (`https://us-or-rly101.zwift.com`)
| Endpoint | Method | What It Returns |
| :--- | :--- | :--- |
| `/api/profiles/me` | `GET` | Logged-in rider's full profile (`id`, `publicId`, `firstName`, `lastName`, `imageSrc`, `weight` in grams, `height` in mm, `ftp`, `competitionMetrics` including Racing Score). |
| `/api/profiles/{riderId}` | `GET` | Any rider's profile by integer Zwift ID. |
| `/api/profiles/{riderId}/followees` | `GET` | List of riders that `{riderId}` follows (great for auto-populating your friends list!). |
| `/api/profiles/{riderId}/followers` | `GET` | List of riders following `{riderId}`. |
| `/api/profiles/{riderId}/activities?start=0&limit=20` | `GET` | Rider's activity feed, including `id`, `name`, `distanceInMeters`, `duration`, `avgWatts`, `fitFileBucket`, and `fitFileKey` (to download full `.fit` telemetry). |
| `/api/profiles/{riderId}/activities/{activityId}` | `GET` | Detailed single activity metadata + equipment/fit file info. |
| `/api/public/events/{eventId}` | `GET` | Full event details, route ID, distance/laps, rules, and `eventSubgroups` array (each category A/B/C/D/E has its own `subgroupId`). |
| `/api/race-results/entries?event_subgroup_id={subgroupId}` | `GET` | **Crucial for Races & Equipment:** Returns all finishers in an event subgroup, including elapsed time (`activityData.durationInMilliseconds`), avg watts, HR, and **equipped bike/wheel IDs**! |

### Community Reference Links for Zwift Core API
- **TypeScript Wrapper & Types:** [`rally25rs/zwift-api-wrapper`](https://github.com/rally25rs/zwift-api-wrapper) (Inspect `src/zwift-api.ts` and `src/types/` for payload schemas).
- **Endpoint Documentation:** [`strukturunion-mmw/zwift-api-documentation`](https://github.com/strukturunion-mmw/zwift-api-documentation)
- **Protobuf & Mobile API Reference:** [`Ogadai/zwift-mobile-api`](https://github.com/Ogadai/zwift-mobile-api)

---

## 2. ZwiftPower API (`zwiftpower.com`)

ZwiftPower is a PHP-based platform backed by cached JSON files (`cache3/`) and dynamic DataTables scripts (`api3.php`). While slower and morequirky than Zwift Core, it is the gold standard for **filtered race results (DQs removed)**, **race power curve intervals (`15s`, `1m`, `5m`, `20m` watts & W/kg)**, and **historical race logs per rider**.

### Authentication Flow
- ZwiftPower uses Single Sign-On (SSO) through `secure.zwift.com` (`https://zwiftpower.com/ucp.php?mode=login&login=external&oauth_service=oauthzpsso`).
- Because it sets a session cookie (`PHPSESSID` / `phpbb3_...`), our **Cloudflare Worker proxy** handles the OAuth handshake and bridges the session cookies so the browser can make authenticated requests.

### Key Endpoints (`https://zwiftpower.com`)
| Endpoint | Method | What It Returns |
| :--- | :--- | :--- |
| `/cache3/profile/{riderId}_all.json` | `GET` | **Goldmine for Head-to-Head:** Returns a rider's **entire historical race list** on ZwiftPower in a single JSON file! Includes `zid` (Event ID), `event_title`, `event_date`, `pos` (category position), `position_in_cat`, `category`, `time`, `avg_power`, `np` (Normalized Power), and critical power splits. |
| `/cache3/profile/{riderId}_rider.json` | `GET` | Rider's ZP summary profile, team affiliation, category status, and zPoints. |
| `/cache3/results/{eventId}_view.json` | `GET` | Official filtered results for a specific event (`zid`), including all categories, finish times, `15s/1m/5m/20m` power numbers, weight at time of race, and DQ codes (`UPG`, `WKG`, `ZHR`, etc.). |
| `/cache3/results/{eventId}_zwift.json` | `GET` | Unfiltered raw finishers list on ZwiftPower for that event. |
| `/api3.php?do=event_results&zid={eventId}` | `GET` | Fallback dynamic endpoint when `cache3` static JSON hasn't been written or for live events. |

### Community Reference Links for ZwiftPower API
- **TypeScript Implementation:** [`rally25rs/zwift-api-wrapper`](https://github.com/rally25rs/zwift-api-wrapper) (Inspect `src/zwift-power-api.ts` for exact SSO login redirect handling and endpoint patterns).
- **Python ZP Fetcher Reference:** [`puckdoug/zpdatafetch`](https://github.com/puckdoug/zpdatafetch) (Documents `cache3` JSON structures and fields).

---

## 3. ZwiftRacing.app API (`zwiftracing.app` / `api.zwiftracing.app`)

ZwiftRacing.app calculates the community-standard **vELO (velo rating)** and **Compound Score** (based on 5-minute and 15-to-60-second power ceilings) and tracks 10-tier racing categories (Bronze through Diamond).

### Key Capabilities
- Rider **vELO rating** (current & historical max30 / max90 ratings).
- Rider **Power Phenotype** (Sprinter, Puncheur, Pursuiter, Time Trialist, Climber).
- Post-race vELO rating changes and "expected vs. actual" finishing rank.

### Reference & Access Notes
- ZwiftRacing provides public rider profile lookups and an API for registered community projects (`Authorization` header token if using their developer API, or via public JSON endpoints).
- Reference documentation: Check `https://www.zwiftracing.app/reference` or network requests on `zwiftracing.app/riders/{riderId}`.

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
