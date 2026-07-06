import { Injectable } from '@angular/core';
import { PersistedState } from '../models/wizard.model';

/** Versioned localStorage key (so the persisted shape can evolve safely). */
const STORAGE_KEY = 'solar-map:v1';

/**
 * Thin wrapper around localStorage for the wizard session snapshot. All access
 * is guarded so a disabled or full localStorage never breaks the app. The wizard
 * keeps the orchestration; only the raw I/O lives here.
 */
@Injectable({ providedIn: 'root' })
export class WizardPersistenceService {
  load(): PersistedState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PersistedState) : null;
    } catch {
      return null;
    }
  }

  save(state: PersistedState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage may be unavailable (private mode / quota); ignore.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
