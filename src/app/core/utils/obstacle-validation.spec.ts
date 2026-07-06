import { Feature, Polygon } from 'geojson';
import { validateObstacle } from './obstacle-validation';

/** Build a closed-ring polygon feature from open [lng, lat] corners. */
function poly(corners: number[][]): Feature<Polygon> {
  const ring = [...corners, corners[0]];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** 10 x 10 roof. */
const roof = poly([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

describe('validateObstacle', () => {
  it('accepts an obstacle fully inside the roof', () => {
    const v = validateObstacle(poly([[2, 2], [4, 2], [4, 4], [2, 4]]), roof, []);
    expect(v.ok).toBeTrue();
  });

  it('rejects an obstacle entirely outside the roof', () => {
    const v = validateObstacle(
      poly([[12, 12], [14, 12], [14, 14], [12, 14]]),
      roof,
      [],
    );
    expect(v.ok).toBeFalse();
    expect(v.reason).toBe('OUTSIDE_ROOF');
  });

  it('rejects an obstacle partially outside the roof', () => {
    const v = validateObstacle(poly([[8, 8], [12, 8], [12, 12], [8, 12]]), roof, []);
    expect(v.ok).toBeFalse();
    expect(v.reason).toBe('OUTSIDE_ROOF');
  });

  it('rejects an obstacle overlapping an existing obstacle', () => {
    const existing = poly([[1, 1], [3, 1], [3, 3], [1, 3]]);
    const v = validateObstacle(poly([[2, 2], [4, 2], [4, 4], [2, 4]]), roof, [existing]);
    expect(v.ok).toBeFalse();
    expect(v.reason).toBe('OVERLAPS_OBSTACLE');
  });

  it('rejects an obstacle that contains an existing obstacle', () => {
    const existing = poly([[3, 3], [4, 3], [4, 4], [3, 4]]);
    const v = validateObstacle(poly([[2, 2], [6, 2], [6, 6], [2, 6]]), roof, [existing]);
    expect(v.ok).toBeFalse();
    expect(v.reason).toBe('OVERLAPS_OBSTACLE');
  });

  it('rejects an obstacle lying on the roof boundary', () => {
    const v = validateObstacle(poly([[0, 0], [3, 0], [3, 3], [0, 3]]), roof, []);
    expect(v.ok).toBeFalse();
    expect(v.reason).toBe('ON_BOUNDARY');
  });

  it('rejects a self-intersecting (malformed) polygon', () => {
    const v = validateObstacle(poly([[2, 2], [4, 4], [4, 2], [2, 4]]), roof, []);
    expect(v.ok).toBeFalse();
    expect(v.reason).toBe('MALFORMED');
  });
});
