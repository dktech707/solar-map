import { ApiError } from '../models/api.model';

/** Which set of backend codes to interpret. */
export type ApiErrorDomain = 'geocode' | 'pvgis';

const GEOCODE_MESSAGES: Record<string, string> = {
  GEOCODE_INVALID_PARAMETERS: 'Enter at least 3 characters.',
  GEOCODE_RATE_LIMITED:
    'Address search is rate limited. Please wait a moment and try again.',
  GEOCODE_UPSTREAM_HTTP_ERROR: 'Address search provider returned an error.',
  GEOCODE_INVALID_JSON: 'Address search returned an invalid response.',
  GEOCODE_UNAVAILABLE: 'Address search is currently unavailable.',
};

const PVGIS_MESSAGES: Record<string, string> = {
  INVALID_PARAMETERS: 'Solar calculation parameters are invalid.',
  PVGIS_RATE_LIMITED: 'Solar production service is busy. Please try again in a moment.',
  PVGIS_UPSTREAM_HTTP_ERROR: 'PVGIS returned an upstream error.',
  PVGIS_INVALID_JSON: 'PVGIS returned an invalid response.',
  PVGIS_INVALID_RESPONSE: 'PVGIS response did not include annual production.',
  PVGIS_TIMEOUT: 'PVGIS request timed out.',
  PVGIS_UNAVAILABLE: 'PVGIS is currently unavailable.',
};

/** Generic fallbacks when no known code is present (network errors, etc.). */
const GENERIC: Record<ApiErrorDomain, string> = {
  geocode: 'Address search failed. Check your connection and try again.',
  pvgis:
    'Could not reach PVGIS via the proxy. This can be a network issue, the ' +
    'backend not running, or a location outside PVGIS coverage. The local ' +
    'estimate below still applies.',
};

/**
 * Pull the backend error code out of an HttpErrorResponse-like value. The
 * server envelope is `{ error: { code, message } }`, which HttpClient exposes
 * on `HttpErrorResponse.error`. Never throws.
 */
function extractCode(error: unknown): string | null {
  const body = (error as { error?: unknown } | null | undefined)?.error;
  const envelope = (body as ApiError | null | undefined)?.error;
  const code = (envelope as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Map a backend error to a short, user-friendly message. Known codes get a
 * specific message; anything else falls back to a generic per-domain message.
 * No technical detail or stack trace is surfaced.
 */
export function describeApiError(error: unknown, domain: ApiErrorDomain): string {
  const code = extractCode(error);
  if (code) {
    const table = domain === 'geocode' ? GEOCODE_MESSAGES : PVGIS_MESSAGES;
    if (table[code]) {
      return table[code];
    }
  }
  return GENERIC[domain];
}
