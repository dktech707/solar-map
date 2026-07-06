'use strict';

/**
 * Express bootstrap for the Solar Roof Estimator proxy.
 *
 * Endpoints:
 *   GET /api/health   -> { ok: true }
 *   GET /api/geocode  -> normalized Nominatim results (see geocode.js)
 *   GET /api/pvgis    -> { annualProductionKwh } (see pvgis.js)
 *
 * CORS is restricted to the local Angular dev origins; requests with no origin
 * (curl, manual testing) are allowed. Requires Node's global fetch +
 * AbortController (run on Node 20.19+, per Angular 20).
 */

const express = require('express');
const cors = require('cors');
const { handleGeocode } = require('./geocode');
const { handlePvgis } = require('./pvgis');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

/**
 * Allowed browser origins. Defaults to the local Angular dev origins; override
 * with a comma-separated ALLOWED_ORIGINS env var (whitespace trimmed, empties
 * ignored). No wildcard is ever used.
 */
function resolveAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw) {
    const list = raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (list.length > 0) {
      return new Set(list);
    }
  }
  return new Set(['http://localhost:4200', 'http://127.0.0.1:4200']);
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      // No origin (curl / server-to-server) is allowed; browsers must be on
      // one of the two dev origins. No wildcard.
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/geocode', handleGeocode);
app.get('/api/pvgis', handlePvgis);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Solar proxy listening on http://localhost:${PORT}`);
});
