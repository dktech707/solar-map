import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { LocationResult } from '../../core/models/geocode.model';
import {
  ObstacleGeometry,
  RoofGeometry,
  SOLAR_CONSTANTS,
  SolarBreakdown,
  SolarCalculationResult,
  SolarReport,
} from '../../core/models/solar.model';
import { VisualStep, WizardStep } from '../../core/models/wizard.model';
import { GeocodingService, MIN_QUERY_LENGTH } from '../../core/services/geocoding.service';
import { PvgisService } from '../../core/services/pvgis.service';
import { SolarCalculationService } from '../../core/services/solar-calculation.service';
import { WizardPersistenceService } from '../../core/services/wizard-persistence.service';
import { describeApiError } from '../../core/utils/api-error.util';
import { clamp, coerceNumber } from '../../core/utils/number.util';
import { MapDrawingComponent } from '../map-drawing/map-drawing.component';
import { ResultDashboardComponent } from '../result-dashboard/result-dashboard.component';

/**
 * Orchestrates the flow: search (Nominatim proxy) -> draw roof + obstacles ->
 * PVGIS production -> dashboard. State lives in signals; the area breakdown and
 * final result are derived. Session persistence lives in
 * {@link WizardPersistenceService}; error-code mapping in `describeApiError`.
 */
@Component({
  selector: 'app-solar-wizard',
  imports: [FormsModule, DecimalPipe, MapDrawingComponent, ResultDashboardComponent],
  templateUrl: './solar-wizard.component.html',
  styleUrl: './solar-wizard.component.scss',
})
export class SolarWizardComponent {
  private readonly geocoding = inject(GeocodingService);
  private readonly calc = inject(SolarCalculationService);
  private readonly pvgis = inject(PvgisService);
  private readonly persistence = inject(WizardPersistenceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly minQueryLength = MIN_QUERY_LENGTH;

  protected readonly step = signal<WizardStep>('search');

  // --- Address search -----------------------------------------------------
  protected query = '';
  protected readonly searching = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly searchResults = signal<LocationResult[]>([]);
  protected readonly hasSearched = signal(false);

  // --- Selection + geometry ----------------------------------------------
  protected readonly location = signal<LocationResult | null>(null);
  protected readonly roof = signal<RoofGeometry | null>(null);
  protected readonly obstacles = signal<ObstacleGeometry[]>([]);
  /** Rejection message from the map (obstacle outside roof / overlapping). */
  protected readonly mapNotice = signal<string | null>(null);

  /** Obstacle features handed to the map for restore. */
  protected readonly obstacleFeatures = computed(() =>
    this.obstacles().map((o) => o.feature),
  );

  // --- User-adjustable PVGIS settings (defaults unchanged: 30 / 0) --------
  protected readonly tiltDeg = signal<number>(SOLAR_CONSTANTS.defaultTiltDeg);
  protected readonly aspectDeg = signal<number>(SOLAR_CONSTANTS.defaultAspectDeg);

  /** Area + system breakdown from roof minus obstacles. */
  protected readonly breakdown = computed<SolarBreakdown | null>(() => {
    const roof = this.roof();
    if (!roof) {
      return null;
    }
    const obstacleArea = this.obstacles().reduce((sum, o) => sum + o.areaM2, 0);
    return this.calc.estimate(roof.areaM2, obstacleArea);
  });

  /** Calculation is only allowed once at least one full panel fits. */
  protected readonly canCalculate = computed(() => {
    const b = this.breakdown();
    return !!b && b.panelCount >= 1;
  });

  // --- PVGIS production ---------------------------------------------------
  protected readonly annualProduction = signal<number | null>(null);
  protected readonly pvgisLoading = signal(false);
  protected readonly pvgisError = signal<string | null>(null);

  /** Full result (breakdown + tilt/aspect + production) for the dashboard. */
  protected readonly result = computed<SolarCalculationResult | null>(() => {
    const b = this.breakdown();
    if (!b) {
      return null;
    }
    const annual = this.annualProduction();
    const specificYieldKwhPerKwp =
      annual !== null && b.systemPowerKwp > 0 ? annual / b.systemPowerKwp : null;
    return {
      ...b,
      tiltDeg: this.tiltDeg(),
      aspectDeg: this.aspectDeg(),
      annualProductionKwh: annual,
      specificYieldKwhPerKwp,
    };
  });

  /** Result plus address, or null. */
  protected readonly report = computed<SolarReport | null>(() => {
    const location = this.location();
    const result = this.result();
    return location && result ? { location, result } : null;
  });

  // --- Stepper (derived from the internal state) --------------------------
  private readonly stepOrder: readonly VisualStep[] = [
    'address',
    'roof',
    'obstacles',
    'production',
    'result',
  ];

  protected readonly activeStep = computed<VisualStep>(() => {
    const step = this.step();
    if (step === 'search') {
      return 'address';
    }
    if (step === 'draw') {
      return this.roof() ? 'obstacles' : 'roof';
    }
    return this.pvgisLoading() ? 'production' : 'result';
  });

  protected isActive(step: VisualStep): boolean {
    return this.activeStep() === step;
  }

  protected isDone(step: VisualStep): boolean {
    return this.stepOrder.indexOf(step) < this.stepOrder.indexOf(this.activeStep());
  }

  constructor() {
    this.restoreState();
    effect(() => this.saveState());
  }

  // --- Actions ------------------------------------------------------------

  search(): void {
    const query = this.query.trim();
    if (query.length < this.minQueryLength || this.searching()) {
      return;
    }
    this.searching.set(true);
    this.searchError.set(null);
    this.hasSearched.set(true);

    this.geocoding
      .search(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          this.searchResults.set(results);
          this.searching.set(false);
        },
        error: (err) => {
          this.searchResults.set([]);
          this.searching.set(false);
          this.searchError.set(describeApiError(err, 'geocode'));
        },
      });
  }

  selectLocation(result: LocationResult): void {
    this.location.set(result);
    this.roof.set(null);
    this.obstacles.set([]);
    this.mapNotice.set(null);
    this.annualProduction.set(null);
    this.pvgisError.set(null);
    this.searchResults.set([]);
    this.step.set('draw');
  }

  onRoofChange(roof: RoofGeometry | null): void {
    this.roof.set(roof);
    // Roof changed: any prior production no longer matches. (The map clears
    // obstacles itself when the roof is removed, via a separate emit.)
    this.annualProduction.set(null);
    this.pvgisError.set(null);
  }

  onObstaclesChange(obstacles: ObstacleGeometry[]): void {
    this.obstacles.set(obstacles);
    this.annualProduction.set(null);
    this.pvgisError.set(null);
    this.mapNotice.set(null);
  }

  onNotice(message: string): void {
    this.mapNotice.set(message);
  }

  onTiltInput(value: number | null): void {
    this.tiltDeg.set(coerceNumber(value, this.tiltDeg()));
    this.invalidateResultOnSettingChange();
  }

  onAspectInput(value: number | null): void {
    this.aspectDeg.set(coerceNumber(value, this.aspectDeg()));
    this.invalidateResultOnSettingChange();
  }

  backToSearch(): void {
    this.step.set('search');
  }

  calculateSolarPotential(): void {
    const location = this.location();
    const b = this.breakdown();
    if (!location || !b || b.panelCount < 1) {
      return;
    }

    // Clamp to valid PVGIS ranges and reflect the clamped values back.
    const tilt = clamp(coerceNumber(this.tiltDeg(), SOLAR_CONSTANTS.defaultTiltDeg), 0, 90);
    const aspect = clamp(
      coerceNumber(this.aspectDeg(), SOLAR_CONSTANTS.defaultAspectDeg),
      -180,
      180,
    );
    this.tiltDeg.set(tilt);
    this.aspectDeg.set(aspect);

    this.annualProduction.set(null);
    this.pvgisError.set(null);
    this.step.set('result');
    this.pvgisLoading.set(true);

    this.pvgis
      .annualProductionKwh({
        lat: location.lat,
        lon: location.lon,
        peakPowerKwp: b.systemPowerKwp,
        tiltDeg: tilt,
        aspectDeg: aspect,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (kwh) => {
          this.annualProduction.set(kwh);
          this.pvgisLoading.set(false);
        },
        error: (err) => {
          this.pvgisLoading.set(false);
          this.pvgisError.set(describeApiError(err, 'pvgis'));
        },
      });
  }

  restart(): void {
    this.persistence.clear();
    this.step.set('search');
    this.query = '';
    this.searchResults.set([]);
    this.searchError.set(null);
    this.hasSearched.set(false);
    this.location.set(null);
    this.roof.set(null);
    this.obstacles.set([]);
    this.mapNotice.set(null);
    this.annualProduction.set(null);
    this.pvgisError.set(null);
    this.pvgisLoading.set(false);
    this.tiltDeg.set(SOLAR_CONSTANTS.defaultTiltDeg);
    this.aspectDeg.set(SOLAR_CONSTANTS.defaultAspectDeg);
  }

  private invalidateResultOnSettingChange(): void {
    if (this.annualProduction() !== null) {
      this.annualProduction.set(null);
      this.pvgisError.set(null);
    }
  }

  // --- Persistence (I/O delegated to WizardPersistenceService) ------------

  private saveState(): void {
    this.persistence.save({
      step: this.step(),
      location: this.location(),
      roof: this.roof(),
      obstacles: this.obstacles(),
      annualProductionKwh: this.annualProduction(),
      tiltDeg: this.tiltDeg(),
      aspectDeg: this.aspectDeg(),
    });
  }

  private restoreState(): void {
    const snapshot = this.persistence.load();
    if (!snapshot) {
      return;
    }

    if (typeof snapshot.tiltDeg === 'number') {
      this.tiltDeg.set(clamp(snapshot.tiltDeg, 0, 90));
    }
    if (typeof snapshot.aspectDeg === 'number') {
      this.aspectDeg.set(clamp(snapshot.aspectDeg, -180, 180));
    }

    if (!snapshot.location) {
      return;
    }

    this.location.set(snapshot.location);
    if (snapshot.roof) {
      this.roof.set(snapshot.roof);
    }
    if (Array.isArray(snapshot.obstacles)) {
      this.obstacles.set(snapshot.obstacles);
    }
    if (typeof snapshot.annualProductionKwh === 'number') {
      this.annualProduction.set(snapshot.annualProductionKwh);
    }

    if (snapshot.roof && typeof snapshot.annualProductionKwh === 'number') {
      this.step.set('result');
    } else {
      this.step.set('draw');
    }
  }
}
