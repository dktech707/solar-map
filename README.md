# Solar Roof Estimator (`solar-map`)

Estimate rooftop solar potential from a satellite image. Search an address, trace
the roof, optionally mark obstacles (chimneys, skylights), set panel tilt/aspect,
and get an annual production estimate from PVGIS with a full area and system
breakdown.

The Angular client is a single-page app. A small Express server proxies the two
third-party APIs (PVGIS and Nominatim) so the browser never calls them directly.

## Stack

- Client: Angular 20 (standalone components + signals), Leaflet 1.9 + Leaflet.draw,
  Turf.js (`@turf/area`), RxJS `HttpClient`, SCSS.
- Server: Express 4 with `cors`. No database, no ORM, no auth.
- Geometry validation for obstacles is a small in-house utility (no extra deps).

## Requirements

- Node.js 20.19+ recommended (Angular 20 needs a modern Node; the server uses
  Node's global `fetch`/`AbortController`).
- npm.
- Chrome or Chromium is required to run the unit tests (Karma ChromeHeadless).

## Install and run

```bash
npm install            # or: npm ci
npm run dev            # Angular dev server (:4200) + Express proxy (:3000)
```

`npm run dev` runs both with `concurrently`. The Angular dev server forwards
`/api/*` to the Express server via `proxy.config.json`, so the browser only talks
to its own origin. Run pieces individually with `npm start` (client) and
`npm run server` (server).

```bash
npm run build          # production build -> dist/solar-map/browser (main portable check)
npm run verify         # Chrome-free check: build + node --check on every server file
npm test -- --watch=false --browsers=ChromeHeadless   # unit tests (requires Chrome or Chromium)
```

`PORT`, `PVGIS_ENDPOINT` and `ALLOWED_ORIGINS` are configurable via environment
variables (CORS override is documented under Backend).

## How to use

1. Search an address (minimum 3 characters) and pick a result.
2. Draw the roof outline with the polygon tool (top-right of the map).
3. Optionally draw obstacles fully inside the roof; overlapping or outside
   obstacles are rejected with a message. The bin tool removes shapes.
4. Optionally adjust Panel tilt (0-90, default 30) and Panel aspect (default 0;
   0 = south, 90 = west, -90 = east).
5. Click Calculate solar potential (enabled once at least one full panel fits).
6. Read the dashboard: annual production, roof/obstacle/available/usable area,
   panels, kWp, specific yield, price, and the tilt/aspect used. Optional
   name/email/phone are echoed into the summary only.

Selected location, roof, obstacles, tilt/aspect and the last production figure
are saved to `localStorage`, so a refresh resumes where you left off. Start over
clears saved state.

## Implemented scope

Mandatory:

- Address search (server-side Nominatim proxy).
- Satellite map (Esri World Imagery) with roof polygon drawing (Leaflet.draw).
- Geodesic area via Turf.js.
- PVGIS annual production through the Express proxy.
- Result dashboard.

Bonuses:

- `localStorage` save/restore of the full session.
- Display-only personal info form (never transmitted).
- Obstacle subtraction: obstacles are validated (inside roof, non-overlapping),
  their area is subtracted, and the available/usable area is shown.

## Backend

`GET /api/health` returns `{ "ok": true }`.

`GET /api/geocode?q=&limit=` proxies Nominatim. `q` is trimmed and must be at
least 3 characters; `limit` defaults to 5 and is capped at 5. It returns a
normalized array of `{ displayName, lat, lon }`. Requests carry the required
`User-Agent`. Results are cached in memory for 24h; identical cached queries are
served without hitting Nominatim.

`GET /api/pvgis?lat=&lon=&peakpower=&loss=&angle=&aspect=` proxies PVGIS
`PVcalc`. All parameters are validated (lat -90..90, lon -180..180, peakpower > 0,
loss 0..100, angle 0..90, aspect -180..180). The upstream request always sends
`mountingplace=building` (this app models rooftop systems) and has a 12s timeout.
Success returns `{ "annualProductionKwh": number }`. Results are cached for 1h.

Why proxy at all: PVGIS documentation states that direct browser/AJAX access is
not allowed, and Nominatim's policy needs a descriptive `User-Agent` that browsers
cannot set. Proxying also centralizes validation, caching and error handling.

Cache and rate guard: each proxy keeps an in-memory TTL cache (24h geocode, 1h
PVGIS). Cached responses are served without any upstream call. Nominatim keeps a
strict one-request-per-second guard (public-policy friendly); a burst of distinct
uncached geocode requests returns `GEOCODE_RATE_LIMITED`. PVGIS instead spaces
upstream calls: a request that arrives too soon waits up to about 1s and is then
sent, so a normal recalculate is never rejected; only when a waiter is already
queued does it return `PVGIS_RATE_LIMITED`.

CORS: no wildcard. By default only `http://localhost:4200` and
`http://127.0.0.1:4200` are allowed; requests with no origin (curl, manual
testing) are always allowed. Override the allowlist with a comma-separated
`ALLOWED_ORIGINS` env var (whitespace trimmed, empty values ignored), e.g.:

```bash
ALLOWED_ORIGINS=http://localhost:4200,https://example.com npm run server
```

Error contract: every error is `{ "error": { "code", "message" } }`. Geocode
codes: `GEOCODE_INVALID_PARAMETERS`, `GEOCODE_RATE_LIMITED`,
`GEOCODE_UPSTREAM_HTTP_ERROR`, `GEOCODE_INVALID_JSON`, `GEOCODE_UNAVAILABLE`.
PVGIS codes: `INVALID_PARAMETERS`, `PVGIS_RATE_LIMITED`,
`PVGIS_UPSTREAM_HTTP_ERROR`, `PVGIS_INVALID_JSON`, `PVGIS_INVALID_RESPONSE`,
`PVGIS_TIMEOUT`, `PVGIS_UNAVAILABLE`. Success shapes never carry an error object.

## Solar assumptions

| Assumption | Value |
| --- | --- |
| Panel size | 1.7 m x 1.1 m (1.87 m²) |
| Panel power | 440 Wp (0.44 kWp) |
| Usable roof factor | 80% of available area |
| System loss | 14% |
| Default tilt | 30 degrees |
| Default aspect | 0 (south; 90 = west, -90 = east) |
| Price | 1200 EUR/kWp |

Pipeline: `available = max(0, roof - obstacles)`, `usable = available * 0.8`,
`panels = floor(usable / 1.87)`, `kWp = panels * 0.44`, `price = kWp * 1200`.

## Limitations

- 2D footprint only: no per-plane pitch or true sloped area. Tilt/aspect are
  applied at PVGIS, not derived from the drawing.
- Obstacle validation uses Turf predicates (`booleanContains` / `booleanDisjoint`
  / `kinks`) and rejects overlaps, containment and boundary-touching rather than
  computing a polygon union. Areas are geodesic (Turf `area`).
- Panel count is area-based (floor), not a real module layout with row spacing.
- No structural analysis, no shading beyond the obstacles you draw.
- Nominatim/PVGIS coverage and availability still apply; failures return a clean
  error and the local estimate remains visible.
- The rate guard and cache are per-process and in-memory (reset on restart).

## Not implemented (by design)

- Google Solar API, automatic roof recognition, database, auth, deployment config.

## What I would improve with more time

- Support real polygon union for overlapping obstacles (currently overlaps are
  rejected).
- Per-plane roofs (multiple tilts/aspects) and a monthly-production chart from
  PVGIS `E_m`.
- Per-IP rate limiting and shared cache (e.g. Redis) instead of in-memory.
- Playwright end-to-end tests and wider unit coverage (map interactions).
- Shareable result via URL state, unit toggles, and HR/EN i18n.
