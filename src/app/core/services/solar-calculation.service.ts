import { Injectable } from '@angular/core';
import area from '@turf/area';
import { Feature, Polygon } from 'geojson';
import { SOLAR_CONSTANTS, SolarBreakdown } from '../models/solar.model';

/**
 * Turns roof + obstacle geometry into a PV system breakdown using Turf.js for
 * geodesic area and the fixed constants in {@link SOLAR_CONSTANTS}.
 *
 * Pipeline:
 *   available = max(0, roofArea - obstacleArea)
 *   usable    = available * usableRoofFactor
 *   panels    = floor(usable / panelArea)
 *   kWp       = panels * panelPowerWp / 1000
 *   price     = kWp * pricePerKwp
 */
@Injectable({ providedIn: 'root' })
export class SolarCalculationService {
  readonly constants = SOLAR_CONSTANTS;

  /**
   * Geodesic area of a polygon in square metres. Turf computes the true area
   * on the WGS84 ellipsoid, so it is accurate at any latitude.
   */
  areaM2(polygon: Feature<Polygon>): number {
    return area(polygon);
  }

  /**
   * Derive the area breakdown, panel count, system size and price from a roof
   * area and the total obstacle area to subtract. Obstacle area can never push
   * the available area below zero.
   */
  estimate(roofAreaM2: number, obstacleAreaM2: number): SolarBreakdown {
    const c = this.constants;
    const safeRoof = Math.max(0, roofAreaM2);
    const safeObstacles = Math.max(0, obstacleAreaM2);
    const availableAreaM2 = Math.max(0, safeRoof - safeObstacles);
    const usableAreaM2 = availableAreaM2 * c.usableRoofFactor;
    const panelCount = Math.floor(usableAreaM2 / c.panelAreaM2);
    const systemPowerKwp = (panelCount * c.panelPowerWp) / 1000;
    const estimatedPriceEur = systemPowerKwp * c.estimatedPricePerKwpEur;

    return {
      roofAreaM2: safeRoof,
      obstacleAreaM2: safeObstacles,
      availableAreaM2,
      usableAreaM2,
      panelCount,
      systemPowerKwp,
      estimatedPriceEur,
    };
  }
}
