import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { LocationResult } from '../models/geocode.model';

/** Shortest query length we will send to the geocoder. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Forward-geocoding via the app's own Express proxy at `/api/geocode`.
 *
 * The browser never calls Nominatim directly: the proxy adds the required
 * User-Agent, caches, and rate-limits upstream (see server/geocode.js). A
 * small client-side cache still avoids re-issuing identical requests within a
 * session. Search is button-driven; there is no autocomplete.
 */
@Injectable({ providedIn: 'root' })
export class GeocodingService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/api/geocode';

  /** Cache of results keyed by trimmed lower-cased query + limit. */
  private readonly cache = new Map<string, LocationResult[]>();

  /** Search for an address; the server returns normalised results. */
  search(query: string, limit = 5): Observable<LocationResult[]> {
    const trimmed = query.trim();
    const key = `${trimmed.toLowerCase()}|${limit}`;

    const cached = this.cache.get(key);
    if (cached) {
      return of(cached);
    }

    const params = new HttpParams().set('q', trimmed).set('limit', String(limit));
    return this.http
      .get<LocationResult[]>(this.endpoint, { params })
      .pipe(tap((results) => this.cache.set(key, results)));
  }
}
