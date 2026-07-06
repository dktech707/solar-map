'use strict';

const {
  errorBody,
  parseNumber,
  resolveOptional,
  TtlCache,
  UpstreamSpacer,
} = require('./lib');

/**
 * Server-side PVGIS proxy. PVGIS forbids browser/AJAX access, so the upstream
 * call is made here. Requests are validated, sent with mountingplace=building,
 * cached for 1h and rate-limited upstream to one request per second. The
 * endpoint is configurable via the PVGIS_ENDPOINT env var.
 */

const PVGIS_ENDPOINT =
  process.env.PVGIS_ENDPOINT || 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
const UPSTREAM_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MOUNTING_PLACE = 'building';
const DEFAULT_LOSS = 14;
const DEFAULT_ANGLE = 30;
const DEFAULT_ASPECT = 0;

const cache = new TtlCache(CACHE_TTL_MS);
// Space upstream PVGIS calls (wait rather than 429 for a normal recalculate).
const spacer = new UpstreamSpacer(1000, 1000);

async function handlePvgis(req, res) {
  const lat = parseNumber(req.query.lat, { min: -90, max: 90 });
  const lon = parseNumber(req.query.lon, { min: -180, max: 180 });
  const peakpower = parseNumber(req.query.peakpower, { min: 0.0001 }); // > 0
  const loss = resolveOptional(req.query.loss, { min: 0, max: 100 }, DEFAULT_LOSS);
  const angle = resolveOptional(req.query.angle, { min: 0, max: 90 }, DEFAULT_ANGLE);
  const aspect = resolveOptional(req.query.aspect, { min: -180, max: 180 }, DEFAULT_ASPECT);

  if (!lat.ok || !lon.ok || !peakpower.ok || !loss.ok || !angle.ok || !aspect.ok) {
    return res
      .status(400)
      .json(
        errorBody(
          'INVALID_PARAMETERS',
          'Required: lat in [-90, 90], lon in [-180, 180], peakpower > 0. ' +
            'Optional: loss [0, 100], angle [0, 90], aspect [-180, 180].',
        ),
      );
  }

  const params = new URLSearchParams({
    lat: lat.value.toFixed(6),
    lon: lon.value.toFixed(6),
    peakpower: String(peakpower.value),
    loss: String(loss.value),
    angle: String(angle.value),
    aspect: String(aspect.value),
    mountingplace: MOUNTING_PLACE,
    outputformat: 'json',
  });

  const key = params.toString();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return res.json(cached); // cached responses bypass the spacer
  }

  try {
    // Waits up to ~1s to honour the upstream interval; rejects only if a
    // waiter is already queued (server busy), which is a genuine rate-limit.
    await spacer.acquire();
  } catch {
    return res
      .status(429)
      .json(
        errorBody(
          'PVGIS_RATE_LIMITED',
          'Solar production service is busy. Please try again in a moment.',
        ),
      );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${PVGIS_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!upstream.ok) {
      return res
        .status(502)
        .json(
          errorBody(
            'PVGIS_UPSTREAM_HTTP_ERROR',
            `PVGIS request failed (upstream HTTP ${upstream.status}).`,
          ),
        );
    }

    let data;
    try {
      data = await upstream.json();
    } catch {
      return res
        .status(502)
        .json(
          errorBody(
            'PVGIS_INVALID_JSON',
            'PVGIS returned a response that could not be parsed as JSON.',
          ),
        );
    }

    const annual = data?.outputs?.totals?.fixed?.E_y;
    if (typeof annual !== 'number' || !Number.isFinite(annual)) {
      return res
        .status(502)
        .json(
          errorBody(
            'PVGIS_INVALID_RESPONSE',
            'PVGIS response did not contain a valid annual production value.',
          ),
        );
    }

    const payload = { annualProductionKwh: annual };
    cache.set(key, payload);
    return res.json(payload);
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return res
      .status(502)
      .json(
        timedOut
          ? errorBody('PVGIS_TIMEOUT', 'PVGIS request timed out.')
          : errorBody(
              'PVGIS_UNAVAILABLE',
              'PVGIS is currently unavailable. Please try again.',
            ),
      );
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { handlePvgis };
