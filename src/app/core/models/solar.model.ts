import { Feature, Polygon } from 'geojson';
import { LocationResult } from './geocode.model';

/**
 * Fixed engineering assumptions used to turn a roof outline into a
 * photovoltaic (PV) system estimate. These are intentionally simple,
 * documented defaults; see the README for the reasoning and limits.
 */
export const SOLAR_CONSTANTS = {
  /** Nameplate power of a single panel, in watts-peak (0.44 kWp). */
  panelPowerWp: 440,
  /** Physical footprint of a single panel, in square metres (1.7 m x 1.1 m). */
  panelAreaM2: 1.87,
  /** Share of the available roof that is realistically usable for panels. */
  usableRoofFactor: 0.8,
  /** System losses (wiring, inverter, soiling, temperature) as a %. */
  systemLossPercent: 14,
  /** Default panel tilt from horizontal, in degrees. */
  defaultTiltDeg: 30,
  /** Default azimuth (PVGIS convention: 0 = south), in degrees. */
  defaultAspectDeg: 0,
  /** Rough installed price per kWp, in euros. */
  estimatedPricePerKwpEur: 1200,
} as const;

export type SolarConstants = typeof SOLAR_CONSTANTS;

/** A drawn roof outline plus its geodesic area (m²). */
export interface RoofGeometry {
  feature: Feature<Polygon>;
  areaM2: number;
}

/** A drawn obstacle inside the roof (chimney, skylight, unusable section). */
export interface ObstacleGeometry {
  id: string;
  feature: Feature<Polygon>;
  areaM2: number;
}

/** User-adjustable PVGIS array orientation. */
export interface SolarSettings {
  /** Tilt from horizontal, degrees (0-90). */
  tiltDeg: number;
  /** Azimuth, PVGIS aspect convention (0 = south), degrees (-180..180). */
  aspectDeg: number;
}

/** Optional, display-only contact details (never transmitted). */
export interface PersonalInfo {
  name: string;
  email: string;
  phone: string;
}

/**
 * Local area + system breakdown derived purely from geometry and the
 * constants above, with no network call involved.
 */
export interface SolarBreakdown {
  /** Full drawn roof area (m²). */
  roofAreaM2: number;
  /** Sum of obstacle areas subtracted from the roof (m²). */
  obstacleAreaM2: number;
  /** Roof minus obstacles, floored at 0 (m²). */
  availableAreaM2: number;
  /** Available area after the usable-roof factor (m²). */
  usableAreaM2: number;
  /** Whole panels that fit into the usable area. */
  panelCount: number;
  /** Installed system size (kWp). */
  systemPowerKwp: number;
  /** Rough installed price (EUR). */
  estimatedPriceEur: number;
}

/**
 * Everything the dashboard needs: the local breakdown, the tilt/aspect used,
 * and the annual production from PVGIS. `annualProductionKwh` is null until a
 * calculation runs or when PVGIS could not be reached.
 */
export interface SolarCalculationResult extends SolarBreakdown {
  /** Tilt used for the PVGIS estimate (degrees). */
  tiltDeg: number;
  /** Aspect used for the PVGIS estimate (degrees). */
  aspectDeg: number;
  /** Annual production from PVGIS (kWh/year), or null. */
  annualProductionKwh: number | null;
  /** Production per installed kWp (kWh/kWp/year), or null. */
  specificYieldKwhPerKwp: number | null;
}

/** Result plus the resolved address, handed to the dashboard. */
export interface SolarReport {
  location: LocationResult;
  result: SolarCalculationResult;
}
