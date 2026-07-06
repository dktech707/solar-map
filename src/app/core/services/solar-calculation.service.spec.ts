import { Feature, Polygon } from 'geojson';
import { SolarCalculationService } from './solar-calculation.service';

/** A simple square polygon (in degrees) anchored near Zagreb. */
function squarePolygon(sizeDeg: number): Feature<Polygon> {
  const lon = 15.98;
  const lat = 45.81;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon, lat],
          [lon + sizeDeg, lat],
          [lon + sizeDeg, lat + sizeDeg],
          [lon, lat + sizeDeg],
          [lon, lat],
        ],
      ],
    },
  };
}

describe('SolarCalculationService', () => {
  const service = new SolarCalculationService();

  it('computes a positive geodesic area for a valid polygon', () => {
    expect(service.areaM2(squarePolygon(0.0002))).toBeGreaterThan(0);
  });

  it('derives available/usable area, panels, kWp and price consistently', () => {
    const roof = service.areaM2(squarePolygon(0.0002));
    const b = service.estimate(roof, 0);
    expect(b.roofAreaM2).toBeCloseTo(roof, 6);
    expect(b.obstacleAreaM2).toBe(0);
    expect(b.availableAreaM2).toBeCloseTo(roof, 6);
    expect(b.usableAreaM2).toBeCloseTo(b.availableAreaM2 * 0.8, 6);
    expect(b.panelCount).toBe(Math.floor(b.usableAreaM2 / 1.87));
    expect(b.systemPowerKwp).toBeCloseTo((b.panelCount * 440) / 1000, 6);
    expect(b.estimatedPriceEur).toBeCloseTo(b.systemPowerKwp * 1200, 6);
  });

  it('subtracts obstacle area from the roof to get available area', () => {
    const b = service.estimate(100, 30);
    expect(b.availableAreaM2).toBe(70);
    expect(b.usableAreaM2).toBeCloseTo(70 * 0.8, 6);
  });

  it('never produces negative area when obstacles exceed the roof', () => {
    const b = service.estimate(50, 80);
    expect(b.availableAreaM2).toBe(0);
    expect(b.usableAreaM2).toBe(0);
    expect(b.panelCount).toBe(0);
    expect(b.systemPowerKwp).toBe(0);
    expect(b.estimatedPriceEur).toBe(0);
  });

  it('yields zero panels for a negligible roof', () => {
    const b = service.estimate(service.areaM2(squarePolygon(0.000001)), 0);
    expect(b.panelCount).toBe(0);
    expect(b.systemPowerKwp).toBe(0);
    expect(b.estimatedPriceEur).toBe(0);
  });
});
