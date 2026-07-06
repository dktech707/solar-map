import area from '@turf/area';
import booleanContains from '@turf/boolean-contains';
import booleanDisjoint from '@turf/boolean-disjoint';
import kinks from '@turf/kinks';
import { lineString } from '@turf/helpers';
import { Feature, Polygon } from 'geojson';

/**
 * Turf-based validation for a candidate roof obstacle. Manual planar geometry
 * is replaced by Turf predicates (booleanContains, booleanDisjoint, kinks,
 * area) so the edge cases are handled consistently:
 *
 *   - must be a well-formed, non-self-intersecting polygon with positive area
 *   - must be fully inside the roof
 *   - must not touch/lie on the roof boundary (ambiguous geometry)
 *   - must be disjoint from every existing obstacle (no overlap, containment
 *     or touching)
 */

export type ObstacleRejection =
  | 'MALFORMED'
  | 'OUTSIDE_ROOF'
  | 'ON_BOUNDARY'
  | 'OVERLAPS_OBSTACLE';

export interface ObstacleValidation {
  ok: boolean;
  reason?: ObstacleRejection;
  message?: string;
}

const MESSAGES: Record<ObstacleRejection, string> = {
  MALFORMED: 'That shape is not a valid polygon. Please redraw it.',
  OUTSIDE_ROOF: 'Obstacle must be drawn fully inside the roof outline.',
  ON_BOUNDARY: 'Obstacle must sit inside the roof, not on its edge.',
  OVERLAPS_OBSTACLE: 'Obstacles cannot overlap or touch each other.',
};

function reject(reason: ObstacleRejection): ObstacleValidation {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** A closed ring of at least 4 positions, positive area, no self-intersection. */
function isWellFormed(poly: Feature<Polygon>): boolean {
  const ring = poly.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return false;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    return false;
  }
  if (!(area(poly) > 0)) {
    return false;
  }
  return kinks(poly).features.length === 0;
}

/**
 * Validate `candidate` against the `roof` and the already-accepted `existing`
 * obstacles. Returns `{ ok: true }` or a rejection with a user-facing message.
 */
export function validateObstacle(
  candidate: Feature<Polygon>,
  roof: Feature<Polygon>,
  existing: Feature<Polygon>[],
): ObstacleValidation {
  if (!isWellFormed(candidate)) {
    return reject('MALFORMED');
  }
  if (!booleanContains(roof, candidate)) {
    return reject('OUTSIDE_ROOF');
  }
  const roofBoundary = lineString(roof.geometry.coordinates[0]);
  if (!booleanDisjoint(candidate, roofBoundary)) {
    return reject('ON_BOUNDARY');
  }
  for (const other of existing) {
    if (!booleanDisjoint(candidate, other)) {
      return reject('OVERLAPS_OBSTACLE');
    }
  }
  return { ok: true };
}
