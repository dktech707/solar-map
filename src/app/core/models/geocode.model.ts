/**
 * Normalised location returned by the `/api/geocode` proxy. Latitude and
 * longitude are already numbers (the Express server parses Nominatim's
 * string fields), so the browser never sees the raw Nominatim payload.
 */
export interface LocationResult {
  displayName: string;
  lat: number;
  lon: number;
}
