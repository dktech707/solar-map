import { LocationResult } from './geocode.model';
import { ObstacleGeometry, RoofGeometry } from './solar.model';

/** Internal flow states of the wizard. */
export type WizardStep = 'search' | 'draw' | 'result';

/** The five labels shown in the progress stepper. */
export type VisualStep = 'address' | 'roof' | 'obstacles' | 'production' | 'result';

/** Snapshot persisted to localStorage so a session can be resumed. */
export interface PersistedState {
  step: WizardStep;
  location: LocationResult | null;
  roof: RoofGeometry | null;
  obstacles: ObstacleGeometry[];
  annualProductionKwh: number | null;
  tiltDeg: number;
  aspectDeg: number;
}
