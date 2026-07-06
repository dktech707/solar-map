import { Component } from '@angular/core';
import { SolarWizardComponent } from './features/solar-wizard/solar-wizard.component';

@Component({
  selector: 'app-root',
  imports: [SolarWizardComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
