import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { PvgisProxyResult } from '../models/pvgis.model';
import { SOLAR_CONSTANTS } from '../models/solar.model';

/** Inputs for a PVGIS fixed-mount production query. */
export interface PvgisQuery {
  lat: number;
  lon: number;
  /** Installed system size (kWp), must be > 0. */
  peakPowerKwp: number;
  lossPercent?: number;
  tiltDeg?: number;
  /** Azimuth in PVGIS convention (0 = south). */
  aspectDeg?: number;
}

/**
 * Estimates the yearly energy yield of a fixed-mount PV system.
 *
 * The request goes to the app's own Express proxy at `/api/pvgis`, not to
 * PVGIS directly: PVGIS forbids browser/AJAX access, so the upstream call is
 * made server-side (see server/index.js). In development the Angular
 * dev-server forwards `/api` to the proxy via proxy.config.json.
 */
@Injectable({ providedIn: 'root' })
export class PvgisService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/api/pvgis';

  /** Estimated annual production in kWh, via the local proxy. */
  annualProductionKwh(query: PvgisQuery): Observable<number> {
    const params = new HttpParams()
      .set('lat', query.lat.toFixed(6))
      .set('lon', query.lon.toFixed(6))
      .set('peakpower', String(query.peakPowerKwp))
      .set('loss', String(query.lossPercent ?? SOLAR_CONSTANTS.systemLossPercent))
      .set('angle', String(query.tiltDeg ?? SOLAR_CONSTANTS.defaultTiltDeg))
      .set('aspect', String(query.aspectDeg ?? SOLAR_CONSTANTS.defaultAspectDeg));

    return this.http
      .get<PvgisProxyResult>(this.endpoint, { params })
      .pipe(map((res) => res.annualProductionKwh));
  }
}
