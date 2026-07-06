import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SOLAR_CONSTANTS, SolarReport } from '../../core/models/solar.model';

/**
 * Presentational dashboard: given a {@link SolarReport} (address + result), it
 * renders the headline annual production and the supporting area/system
 * breakdown. It owns no business logic; the wizard passes the report in.
 *
 * It also collects optional personal details (name / email / phone) that are
 * echoed into the on-screen summary only and are never transmitted.
 */
@Component({
  selector: 'app-result-dashboard',
  imports: [DecimalPipe, FormsModule],
  templateUrl: './result-dashboard.component.html',
  styleUrl: './result-dashboard.component.scss',
})
export class ResultDashboardComponent {
  readonly report = input.required<SolarReport>();
  readonly pvgisLoading = input<boolean>(false);
  readonly pvgisError = input<string | null>(null);
  readonly restart = output<void>();

  protected readonly constants = SOLAR_CONSTANTS;

  /** True when PVGIS returned a usable annual production figure. */
  protected readonly hasProduction = computed(
    () => this.report().result.annualProductionKwh !== null,
  );

  // --- Optional personal details (display-only, never sent) ---------------
  protected readonly contactName = signal('');
  protected readonly contactEmail = signal('');
  protected readonly contactPhone = signal('');

  protected readonly hasContact = computed(
    () =>
      !!(
        this.contactName().trim() ||
        this.contactEmail().trim() ||
        this.contactPhone().trim()
      ),
  );
}
