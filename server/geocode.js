'use strict';

const { errorBody, TtlCache, RateGuard } = require('./lib');

/**
 * Server-side forward geocoding via OpenStreetMap Nominatim. The browser never
 * calls Nominatim directly; this handler adds the required User-Agent, caches
 * results for 24h and rate-limits upstream to one request per second.
 */

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SolarRoofEstimator/1.0 developer-assessment';
const MIN_QUERY_LENGTH = 3;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10_000;

const cache = new TtlCache(CACHE_TTL_MS);
const rateGuard = new RateGuard(1000);

async function handleGeocode(req, res) {
  const raw = req.query.q;
  const q = typeof raw === 'string' ? raw.trim() : '';
  if (q.length < MIN_QUERY_LENGTH) {
    return res
      .status(400)
      .json(
        errorBody(
          'GEOCODE_INVALID_PARAMETERS',
          `Query "q" is required and must be at least ${MIN_QUERY_LENGTH} characters.`,
        ),
      );
  }

  let limit = Number(req.query.limit);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.floor(limit), MAX_LIMIT);

  const key = `${q.toLowerCase()}|${limit}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return res.json(cached); // cached responses bypass the rate guard
  }

  if (!rateGuard.tryAcquire()) {
    return res
      .status(429)
      .json(
        errorBody(
          'GEOCODE_RATE_LIMITED',
          'Too many geocoding requests. Please wait a second and retry.',
        ),
      );
  }

  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '0',
    limit: String(limit),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });

    if (!upstream.ok) {
      return res
        .status(502)
        .json(
          errorBody(
            'GEOCODE_UPSTREAM_HTTP_ERROR',
            `Nominatim request failed (upstream HTTP ${upstream.status}).`,
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
            'GEOCODE_INVALID_JSON',
            'Nominatim returned a response that could not be parsed as JSON.',
          ),
        );
    }

    const normalized = (Array.isArray(data) ? data : [])
      .map((r) => ({
        displayName: r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
      }))
      .filter(
        (r) =>
          typeof r.displayName === 'string' &&
          Number.isFinite(r.lat) &&
          Number.isFinite(r.lon),
      );

    cache.set(key, normalized);
    return res.json(normalized);
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return res
      .status(502)
      .json(
        errorBody(
          'GEOCODE_UNAVAILABLE',
          timedOut
            ? 'Nominatim request timed out.'
            : 'Nominatim is currently unavailable.',
        ),
      );
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { handleGeocode };
