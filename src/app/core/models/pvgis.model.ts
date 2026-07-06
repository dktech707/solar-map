/**
 * Normalised PVGIS result as returned by the local Express proxy
 * (`GET /api/pvgis`). The proxy talks to the real PVGIS v5_3 `PVcalc`
 * endpoint server-side and extracts a single figure for the browser, so the
 * frontend never parses the large raw PVGIS payload directly.
 *
 * See server/index.js and the README for why the proxy exists.
 */
export interface PvgisProxyResult {
  /** Estimated annual production (kWh/year). */
  annualProductionKwh: number;
}
