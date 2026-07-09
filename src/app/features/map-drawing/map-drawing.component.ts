import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import * as L from 'leaflet';
import 'leaflet-draw';
import { Feature, Polygon } from 'geojson';
import { LocationResult } from '../../core/models/geocode.model';
import { ObstacleGeometry, RoofGeometry } from '../../core/models/solar.model';
import { SolarCalculationService } from '../../core/services/solar-calculation.service';
import { validateObstacle } from '../../core/utils/obstacle-validation';

const ESRI_WORLD_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const ROOF_STYLE: L.PolylineOptions = {
  color: '#ffb020',
  weight: 3,
  fillColor: '#ffb020',
  fillOpacity: 0.2,
};

const OBSTACLE_STYLE: L.PolylineOptions = {
  color: '#f87171',
  weight: 2,
  fillColor: '#f87171',
  fillOpacity: 0.35,
};

interface ObstacleLayer {
  id: string;
  layer: L.Polygon;
}

/**
 * Owns all Leaflet drawing. The first polygon drawn becomes the roof; any
 * further polygons are treated as obstacles and validated (must be fully
 * inside the roof and not overlap another obstacle) before being accepted.
 * Rejected obstacles are discarded and reported via `notice`.
 */
@Component({
  selector: 'app-map-drawing',
  templateUrl: './map-drawing.component.html',
  styleUrl: './map-drawing.component.scss',
})
export class MapDrawingComponent implements AfterViewInit, OnDestroy {
  private readonly calc = inject(SolarCalculationService);

  readonly center = input.required<LocationResult>();
  /** Roof to pre-draw on load (state restore). */
  readonly initialRoof = input<Feature<Polygon> | null>(null);
  /** Obstacles to pre-draw on load (state restore). */
  readonly initialObstacles = input<Feature<Polygon>[]>([]);

  readonly roofChange = output<RoofGeometry | null>();
  readonly obstaclesChange = output<ObstacleGeometry[]>();
  /** Human-readable message when an obstacle is rejected. */
  readonly notice = output<string>();

  @ViewChild('mapContainer', { static: true })
  private mapContainer!: ElementRef<HTMLDivElement>;

  private map?: L.Map;
  private locationMarker?: L.CircleMarker;
  private drawnItems?: L.FeatureGroup;
  private roofLayer?: L.Polygon;
  private obstacles: ObstacleLayer[] = [];
  private obstacleSeq = 0;
  private restored = false;

  constructor() {
    // Keep the pin and view in sync if the address changes.
    effect(() => {
      const c = this.center();
      if (this.map) {
        this.map.setView([c.lat, c.lon], 17);
        this.updateLocationMarker(c);
      }
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  private initMap(): void {
    const c = this.center();

    const map = L.map(this.mapContainer.nativeElement, {
      center: [c.lat, c.lon],
      zoom: 17,
    });

    L.tileLayer(ESRI_WORLD_IMAGERY, {
      maxZoom: 19,
      maxNativeZoom: 18,
      attribution:
        'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      position: 'topleft', // matches the SolarShop reference layout
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: false,
          shapeOptions: ROOF_STYLE,
        },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItems,
        edit: false, // no vertex reshaping; keeps obstacle validation simple
        remove: true,
      },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e: L.LeafletEvent) =>
      this.onCreated((e as L.DrawEvents.Created).layer as L.Polygon),
    );
    map.on(L.Draw.Event.DELETED, (e: L.LeafletEvent) =>
      this.onDeleted((e as L.DrawEvents.Deleted).layers),
    );

    this.map = map;
    this.drawnItems = drawnItems;
    this.updateLocationMarker(c);

    // Deferred so it runs after the first CD tick: size the map and restore.
    setTimeout(() => {
      map.invalidateSize();
      this.restoreInitial();
    }, 0);
  }

  private onCreated(layer: L.Polygon): void {
    if (!this.roofLayer) {
      layer.setStyle(ROOF_STYLE);
      this.roofLayer = layer;
      this.drawnItems!.addLayer(layer);
      this.emitRoof();
      return;
    }

    const roofFeature = this.roofLayer.toGeoJSON() as Feature<Polygon>;
    const candidate = layer.toGeoJSON() as Feature<Polygon>;
    const existing = this.obstacles.map(
      (o) => o.layer.toGeoJSON() as Feature<Polygon>,
    );
    const verdict = validateObstacle(candidate, roofFeature, existing);
    if (!verdict.ok) {
      this.notice.emit(verdict.message ?? 'Obstacle rejected.');
      return; // discard rejected obstacle (never added to the map)
    }

    layer.setStyle(OBSTACLE_STYLE);
    this.obstacles.push({ id: `obs-${++this.obstacleSeq}`, layer });
    this.drawnItems!.addLayer(layer);
    this.emitObstacles();
  }

  private onDeleted(removed: L.LayerGroup): void {
    let roofRemoved = false;
    removed.eachLayer((l) => {
      if (l === this.roofLayer) {
        roofRemoved = true;
      }
      const idx = this.obstacles.findIndex((o) => o.layer === l);
      if (idx >= 0) {
        this.obstacles.splice(idx, 1);
      }
    });

    if (roofRemoved) {
      // The roof is gone, so remaining obstacles are meaningless: drop them.
      this.roofLayer = undefined;
      for (const o of this.obstacles) {
        this.drawnItems!.removeLayer(o.layer);
      }
      this.obstacles = [];
      this.emitRoof();
      this.emitObstacles();
    } else {
      this.emitObstacles();
    }
  }

  private emitRoof(): void {
    if (!this.roofLayer) {
      this.roofChange.emit(null);
      return;
    }
    const feature = this.roofLayer.toGeoJSON() as Feature<Polygon>;
    this.roofChange.emit({ feature, areaM2: this.calc.areaM2(feature) });
  }

  private emitObstacles(): void {
    const out: ObstacleGeometry[] = this.obstacles.map((o) => {
      const feature = o.layer.toGeoJSON() as Feature<Polygon>;
      return { id: o.id, feature, areaM2: this.calc.areaM2(feature) };
    });
    this.obstaclesChange.emit(out);
  }

  private restoreInitial(): void {
    if (this.restored || !this.map || !this.drawnItems) {
      return;
    }
    this.restored = true;

    const roof = this.initialRoof();
    if (roof) {
      const layer = this.buildPolygon(roof, ROOF_STYLE);
      if (layer) {
        this.roofLayer = layer;
        this.drawnItems.addLayer(layer);
        this.map.fitBounds(layer.getBounds(), { maxZoom: 18, padding: [20, 20] });
        this.emitRoof();
      }
    }

    const obstacles = this.initialObstacles();
    if (this.roofLayer && obstacles.length) {
      for (const feature of obstacles) {
        const layer = this.buildPolygon(feature, OBSTACLE_STYLE);
        if (layer) {
          this.obstacles.push({ id: `obs-${++this.obstacleSeq}`, layer });
          this.drawnItems.addLayer(layer);
        }
      }
      this.emitObstacles();
    }
  }

  private buildPolygon(
    feature: Feature<Polygon>,
    style: L.PolylineOptions,
  ): L.Polygon | null {
    const ring = feature.geometry.coordinates[0] ?? [];
    if (ring.length < 4) {
      return null;
    }
    const latLngs = ring.map(([lng, lat]) => L.latLng(lat, lng));
    return L.polygon(latLngs, style);
  }

  private updateLocationMarker(c: LocationResult): void {
    if (!this.map) {
      return;
    }
    if (this.locationMarker) {
      this.locationMarker.setLatLng([c.lat, c.lon]);
    } else {
      this.locationMarker = L.circleMarker([c.lat, c.lon], {
        radius: 7,
        color: '#38bdf8',
        weight: 3,
        fillColor: '#0e1117',
        fillOpacity: 1,
      }).addTo(this.map);
    }
  }
}
