import './style.css'
import Chart from 'chart.js/auto';
import * as L from "leaflet";
import { BaseMapItem, baseMaps } from "./basemap"
import { mousePosition } from './mouse';

interface State {
  datasetInfo: { [key: string]: RasterGroup };
  markerTs: L.Marker;
  markerRef: L.Marker;
  // Current variable name to display
  name: string;
  // Current time index for the variable
  tileIdx: number;
  tile: L.TileLayer | null;
  // The shifts from the reference point for all time indices
  refValues: { [key: string]: number[] };
  // Background tiles
  basemap: BaseMapItem;
  // Data mode (md or cog) for endpoint routing
  dataMode: string;
}

interface RasterGroup {
  name: string;
  file_list: string[];
  mask_file_list: string[];
  mask_min_value: number;
  nodata: number | null;
  uses_spatial_ref: boolean;
  algorithm: string | null;
  latlon_bounds: [number, number, number, number];
  x_values: Array<number | string>;
}

export interface BowserAppOptions {
  // Root container element for the app
  container: HTMLElement;
  // Base URL for the Bowser API server
  baseUrl?: string;
  // Initial dataset to load
  initialDataset?: string;
  // Whether to show the sidebar controls
  showSidebar?: boolean;
  // Custom event handlers
  onTimeseriesClick?: (data: any) => void;
  onDatasetChange?: (dataset: string) => void;
  onTimeIndexChange?: (index: number) => void;
}

export class BowserApp {
  private container: HTMLElement;
  private baseUrl: string;
  private options: BowserAppOptions;
  private map!: L.Map;
  private state!: State;
  private chart!: Chart;

  constructor(options: BowserAppOptions) {
    this.container = options.container;
    this.baseUrl = options.baseUrl || '';
    this.options = options;

    this.setupDOM();
    this.initializeMap();
    this.initializeChart();
    this.initializeDatasets();
  }

  private setupDOM() {
    // Create the main layout structure
    this.container.innerHTML = `
      <div class="bowser-app" style="height: 100%; width: 100%; position: relative;">
        <div id="map" style="height: 100%; width: 100%;"></div>
        ${this.options.showSidebar !== false ? this.createSidebarHTML() : ''}
        <div id="chart-container" style="position: absolute; bottom: 20px; left: 20px; background: white; border-radius: 5px; padding: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: none; width: 400px; height: 250px;">
          <canvas id="chart"></canvas>
          <button id="hide-chart" style="position: absolute; top: 5px; right: 5px;">Hide</button>
        </div>
      </div>
    `;
  }

  private createSidebarHTML(): string {
    return `
      <div class="sidebar" style="position: absolute; top: 10px; left: 10px; background: white; padding: 15px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); z-index: 1000; min-width: 250px;">
        <div class="control-group">
          <label>Dataset:</label>
          <select id="dataset-selector"></select>
        </div>

        <div class="control-group">
          <label>Time:</label>
          <input type="range" id="layer-slider" min="0" max="0" value="0" />
          <span id="layer-slider-value">0</span>
        </div>

        <div class="control-group">
          <label>Colormap:</label>
          <select id="colormap-selector">
            <option value="viridis">viridis</option>
            <option value="plasma">plasma</option>
            <option value="inferno">inferno</option>
            <option value="magma">magma</option>
            <option value="cividis">cividis</option>
            <option value="RdBu_r">RdBu_r</option>
            <option value="RdYlBu_r">RdYlBu_r</option>
          </select>
          <img id="colormap-img" src="/colorbar/viridis" style="width: 100%; height: 20px; margin-top: 5px;" />
        </div>

        <div class="control-group">
          <label>Scale:</label>
          <input type="number" id="vmin" placeholder="Min" value="-0.1" step="0.01" />
          <input type="number" id="vmax" placeholder="Max" value="0.1" step="0.01" />
        </div>

        <div class="control-group">
          <label>Opacity:</label>
          <input type="range" id="opacity-slider" min="0" max="1" step="0.1" value="1" />
          <span id="opacity-slider-value">1</span>
        </div>

        <div class="control-group">
          <label>Basemap:</label>
          <select id="basemap-selector"></select>
        </div>

        <div class="control-group">
          <button id="hide-chart" type="button">Show time series</button>
        </div>
      </div>
    `;
  }

  private initializeMap() {
    const mapElement = this.container.querySelector('#map') as HTMLElement;
    this.map = L.map(mapElement, {
      doubleClickZoom: false,
    });

    mousePosition().addTo(this.map);

    // Add scale bar
    L.control.scale({
      metric: true,
      imperial: false,
      position: 'bottomright'
    }).addTo(this.map);

    const fontAwesomeIcon = L.divIcon({
      html: '<i class="fa-solid fa-location-dot fa-3x"></i>',
      iconSize: [20, 20],
      className: 'myDivIcon'
    });

    this.state = {
      datasetInfo: {},
      markerTs: L.marker([0, -0.], { draggable: true, title: 'Time Series Point' }),
      markerRef: L.marker([0, -0.], { icon: fontAwesomeIcon, draggable: true, title: 'Reference Location' }),
      name: 'displacement',
      tile: null,
      tileIdx: 0,
      refValues: {},
      basemap: baseMaps.esriSatellite,
      dataMode: 'md',
    };

    // Add base map
    let baseMapTile = L.tileLayer(this.state.basemap.url, {
      maxZoom: 19,
      attribution: this.state.basemap.attribution
    });
    baseMapTile.addTo(this.map);

    this.setupMapEventHandlers();
    this.setupUIEventHandlers();
  }

  private setupMapEventHandlers() {
    this.map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      this.state.markerTs.setLatLng([lat, lng]);
      const chartContainer = this.container.querySelector('#chart-container') as HTMLElement;
      if (chartContainer && chartContainer.style.display !== 'none') {
        this.updateChart();
      }

      // Notify parent about timeseries click
      if (this.options.onTimeseriesClick) {
        this.getPointTimeSeries(lng, lat, this.state.name).then((data) => {
          this.options.onTimeseriesClick?.(data);
        });
      }
    });

    // Marker event handlers
    this.state.markerTs.on('moveend', () => {
      const chartContainer = this.container.querySelector('#chart-container') as HTMLElement;
      if (chartContainer && chartContainer.style.display !== 'none') {
        this.updateChart();
      }
    });

    this.state.markerRef.on('moveend', () => {
      const chartContainer = this.container.querySelector('#chart-container') as HTMLElement;
      if (chartContainer && chartContainer.style.display !== 'none') {
        this.updateChart();
      }
      this.setRefValues(this.state.name);
    });

    // Reference marker
    this.state.markerRef.addTo(this.map);
  }

  private setupUIEventHandlers() {
    if (this.options.showSidebar === false) return;

    // Dataset selector
    const datasetSelector = this.container.querySelector('#dataset-selector') as HTMLSelectElement;
    if (datasetSelector) {
      datasetSelector.addEventListener('change', (event: Event) => {
        this.savePreferences(this.state.name);
        const datasetName = (event.target as HTMLSelectElement).value;
        this.setupDataset(datasetName);
        this.loadPreferences(datasetName);
        this.options.onDatasetChange?.(datasetName);
      });
    }

    // Time slider
    const layerSlider = this.container.querySelector('#layer-slider') as HTMLInputElement;
    const layerSliderText = this.container.querySelector('#layer-slider-value') as HTMLSpanElement;

    if (layerSlider && layerSliderText) {
      layerSlider.addEventListener('input', (event: Event) => {
        const target = event.target as HTMLInputElement;
        const newIdx = parseInt(target.value);
        const timeValue = this.state.datasetInfo[this.state.name].x_values[newIdx];
        layerSliderText.textContent = timeValue.toString();
      });

      layerSlider.addEventListener('change', (event: Event) => {
        const target = event.target as HTMLInputElement;
        const newIdx = parseInt(target.value);
        this.state.tileIdx = newIdx;
        this.updateRasterTile();
        this.options.onTimeIndexChange?.(newIdx);
      });
    }

    // Colormap controls
    const cmapSelect = this.container.querySelector('#colormap-selector') as HTMLSelectElement;
    const vminInput = this.container.querySelector('#vmin') as HTMLInputElement;
    const vmaxInput = this.container.querySelector('#vmax') as HTMLInputElement;

    if (cmapSelect) cmapSelect.addEventListener('change', () => { this.savePreferences(this.state.name); this.updateRasterTile(); });
    if (vminInput) vminInput.addEventListener('change', () => { this.savePreferences(this.state.name); this.updateRasterTile(); });
    if (vmaxInput) vmaxInput.addEventListener('change', () => { this.savePreferences(this.state.name); this.updateRasterTile(); });

    // Opacity slider
    const opacitySlider = this.container.querySelector('#opacity-slider') as HTMLInputElement;
    const opacityText = this.container.querySelector('#opacity-slider-value') as HTMLSpanElement;

    if (opacitySlider && opacityText) {
      opacitySlider.addEventListener('input', (event: Event) => {
        const opacity = (event.target as HTMLInputElement).value;
        opacityText.textContent = opacity;
        if (this.state.tile) {
          this.state.tile.setOpacity(parseFloat(opacity));
        }
      });
    }

    // Basemap selector
    const basemapSelector = this.container.querySelector('#basemap-selector') as HTMLSelectElement;
    if (basemapSelector) {
      // Populate basemap options
      for (const [name, basemap] of Object.entries(baseMaps)) {
        const option = document.createElement('option');
        option.textContent = name;
        option.value = basemap.url;
        basemapSelector.appendChild(option);
      }

      basemapSelector.addEventListener('change', (event) => {
        const target = event.target as HTMLSelectElement;
        const newBasemapName = target.options[target.selectedIndex].innerText;
        const newBasemap = baseMaps[newBasemapName];

        this.map.attributionControl.removeAttribution(this.state.basemap.attribution);
        this.state.basemap = newBasemap;
        // Update base map tile layer (would need to track this)
        this.map.attributionControl.addAttribution(this.state.basemap.attribution);
      });
    }

    // Chart toggle button
    const hideChartBtn = this.container.querySelector('#hide-chart') as HTMLButtonElement;
    const chartContainer = this.container.querySelector('#chart-container') as HTMLElement;

    if (hideChartBtn && chartContainer) {
      hideChartBtn.addEventListener('click', () => {
        if (chartContainer.style.display !== 'none') {
          chartContainer.style.display = 'none';
          hideChartBtn.textContent = 'Show time series';
          this.state.markerTs.remove();
        } else {
          chartContainer.style.display = 'block';
          hideChartBtn.textContent = 'Hide time series';
          this.state.markerTs.addTo(this.map);
        }
      });
    }
  }

  private initializeChart() {
    const chartElement = this.container.querySelector('#chart') as HTMLCanvasElement;
    if (!chartElement) return;

    this.chart = new Chart(chartElement, {
      options: {
        animation: false,
        plugins: { legend: { display: false } },
        scales: { y: {} },
      },
      type: 'line',
      data: { datasets: [] }
    });
  }

  private async initializeDatasets() {
    try {
      // Get data mode
      const modeResponse = await fetch(`${this.baseUrl}/mode`);
      const modeData = await modeResponse.json();
      this.state.dataMode = modeData.mode;

      // Get datasets
      const datasetsResponse = await fetch(`${this.baseUrl}/datasets`);
      const data = await datasetsResponse.json();
      this.state.datasetInfo = data;

      // Use first available dataset or specified initial dataset
      const initialDataset = this.options.initialDataset || Object.keys(this.state.datasetInfo)[0];

      // Set the view
      const { centerLat, centerLng } = this.computeCenter(initialDataset);
      this.map.setView([centerLat, centerLng], 9);

      this.state.markerTs.setLatLng([centerLat, centerLng]);
      this.state.markerRef.setLatLng([centerLat, centerLng]);

      this.setupDataset(initialDataset);

      // Update dropdown with datasets
      if (this.options.showSidebar !== false) {
        const datasetSelector = this.container.querySelector('#dataset-selector') as HTMLSelectElement;
        if (datasetSelector) {
          datasetSelector.innerHTML = '';
          Object.keys(this.state.datasetInfo).forEach((varName) => {
            const option = document.createElement('option');
            option.value = varName;
            option.textContent = varName;
            datasetSelector.appendChild(option);
          });
          datasetSelector.value = initialDataset;
        }
      }

    } catch (error) {
      console.error('Error initializing datasets:', error);
    }
  }

  private computeCenter(name: string) {
    const curDataset = this.state.datasetInfo[name];
    const bounds = curDataset.latlon_bounds;
    const centerLat = (bounds[1] + bounds[3]) / 2;
    const centerLng = (bounds[0] + bounds[2]) / 2;
    return { centerLat, centerLng };
  }

  private setupDataset(name: string) {
    const curDataset = this.state.datasetInfo[name];

    // Set up time slider
    if (this.options.showSidebar !== false) {
      const layerSlider = this.container.querySelector('#layer-slider') as HTMLInputElement;
      const layerSliderText = this.container.querySelector('#layer-slider-value') as HTMLSpanElement;

      if (layerSlider && layerSliderText) {
        layerSlider.max = (curDataset.x_values.length - 1).toString();
        layerSliderText.textContent = curDataset.x_values[0].toString();
      }
    }

    this.state.name = name;

    if (curDataset.uses_spatial_ref && this.state.refValues[name] === undefined) {
      this.setRefValues(name);
    }

    this.updateRasterTile();
  }

  private async setRefValues(datasetName: string) {
    const { lat, lng } = this.state.markerRef.getLatLng();
    try {
      const values = await this.getPointTimeSeries(lng, lat, datasetName);
      if (values !== undefined) {
        this.state.refValues[datasetName] = values;
        if (this.curUsesRef()) {
          this.updateRasterTile();
        }
      }
    } catch (error) {
      console.log('setRefValues error:', error);
    }
  }

  private curUsesRef(): boolean {
    return this.state.datasetInfo[this.state.name].uses_spatial_ref;
  }

  private updateRasterTile() {
    const { name, tileIdx } = this.state;
    const curDataset = this.state.datasetInfo[name];

    let { colormap_name, vmin, vmax } = this.loadPreferences(name);

    const cmapSelect = this.container.querySelector('#colormap-selector') as HTMLSelectElement;
    const vminInput = this.container.querySelector('#vmin') as HTMLInputElement;
    const vmaxInput = this.container.querySelector('#vmax') as HTMLInputElement;

    if (colormap_name === null && cmapSelect) colormap_name = cmapSelect.value;
    if (vmin === null && vminInput) vmin = parseFloat(vminInput.value);
    if (vmax === null && vmaxInput) vmax = parseFloat(vmaxInput.value);

    this.setChartYLimits(vmin!, vmax!);

    // Update colorbar image
    const colormapImg = this.container.querySelector('#colormap-img') as HTMLImageElement;
    if (colormapImg) {
      colormapImg.src = `${this.baseUrl}/colorbar/${colormap_name}`;
    }

    // Build tile parameters
    const maxIdx = curDataset.x_values.length - 1;
    const curTileIdx = Math.max(0, Math.min(tileIdx, maxIdx));
    this.state.tileIdx = curTileIdx;

    let params: { [key: string]: string } = {
      variable: name,
      time_idx: curTileIdx.toString(),
      rescale: `${vmin},${vmax}`,
      colormap_name: colormap_name!,
    };

    if (curDataset.algorithm !== null) {
      params.algorithm = curDataset.algorithm;
    }

    if (this.state.refValues[name] !== undefined && curDataset.algorithm === 'shift') {
      const originalShift = this.state.refValues[name][curTileIdx];
      const shift = originalShift ?? 0;
      params.algorithm_params = JSON.stringify({ shift });
    }

    if (this.state.dataMode === 'cog') {
      const url = curDataset.file_list[curTileIdx];
      const maskUrl = curDataset.mask_file_list[curTileIdx];
      const maskMinValue = curDataset.mask_min_value;
      params.url = url;
      if (maskUrl !== undefined) params.mask = maskUrl;
      if (maskMinValue !== undefined) params.mask_min_value = maskMinValue.toString();
    }

    const urlParams = Object.keys(params).map(i => `${i}=${encodeURIComponent(params[i])}`).join('&');
    const endpoint = this.state.dataMode === 'md'
      ? `${this.baseUrl}/md/WebMercatorQuad/tilejson.json?${urlParams}`
      : `${this.baseUrl}/cog/WebMercatorQuad/tilejson.json?${urlParams}`;

    fetch(endpoint)
      .then(response => response.json())
      .then((tileInfo) => {
        const newTile = L.tileLayer(tileInfo.tiles[0], { maxZoom: 19 });
        if (this.state.tile !== null) {
          this.map.removeLayer(this.state.tile);
        }
        newTile.addTo(this.map);
        this.state.tile = newTile;
      })
      .catch(error => {
        console.error('Error loading tile:', error);
      });
  }

  private async getPointTimeSeries(lon: number, lat: number, name: string) {
    const params: Record<string, any> = { dataset_name: name, lon, lat };
    const urlParams = Object.keys(params).map(i => `${i}=${params[i]}`).join('&');
    const endpoint = `${this.baseUrl}/point?${urlParams}`;

    try {
      const response = await fetch(endpoint);
      return await response.json();
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  private async updateChart() {
    const { lat, lng } = this.state.markerTs.getLatLng();
    let tsPromise;

    if (this.curUsesRef()) {
      const refLatlng = this.state.markerRef.getLatLng();
      tsPromise = this.getChartTimeSeries(lng, lat, refLatlng.lng, refLatlng.lat);
    } else {
      tsPromise = this.getChartTimeSeries(lng, lat);
    }

    const data = await tsPromise;
    if (data && this.chart) {
      this.chart.data = data;
      this.chart.update();
    }
  }

  private async getChartTimeSeries(lon: number, lat: number, ref_lon?: number, ref_lat?: number) {
    let params: Record<string, any> = { lon, lat, dataset_name: this.state.name };
    if (ref_lon !== undefined && ref_lat !== undefined) {
      params.ref_lat = ref_lat;
      params.ref_lon = ref_lon;
    }

    const urlParams = Object.keys(params).map(i => `${i}=${params[i]}`).join('&');
    const endpoint = `${this.baseUrl}/chart_point?${urlParams}`;

    try {
      const response = await fetch(endpoint);
      return await response.json();
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  private setChartYLimits(min: number, max: number) {
    if (!this.chart) return;
    const scales = this.chart.options.scales || {};
    const yAxis = scales.y || {};
    yAxis.suggestedMin = min;
    yAxis.suggestedMax = max;
    this.chart.update();
  }

  private loadPreferences(name: string) {
    const colormap_name = localStorage.getItem(`${name}-colormap_name`);
    const vmin = localStorage.getItem(`${name}-vmin`);
    const vmax = localStorage.getItem(`${name}-vmax`);

    if (vmin === null || vmax === null || colormap_name === null) {
      return { colormap_name: null, vmin: null, vmax: null };
    }

    // Update UI if sidebar is visible
    if (this.options.showSidebar !== false) {
      const cmapSelect = this.container.querySelector('#colormap-selector') as HTMLSelectElement;
      const colormapImg = this.container.querySelector('#colormap-img') as HTMLImageElement;
      const vminInput = this.container.querySelector('#vmin') as HTMLInputElement;
      const vmaxInput = this.container.querySelector('#vmax') as HTMLInputElement;

      if (cmapSelect) cmapSelect.value = colormap_name;
      if (colormapImg) colormapImg.src = `${this.baseUrl}/colorbar/${colormap_name}`;
      if (vminInput) vminInput.value = vmin;
      if (vmaxInput) vmaxInput.value = vmax;
    }

    return {
      colormap_name,
      vmin: parseFloat(vmin),
      vmax: parseFloat(vmax)
    };
  }

  private savePreferences(name: string) {
    if (this.options.showSidebar === false) return;

    const vminInput = this.container.querySelector('#vmin') as HTMLInputElement;
    const vmaxInput = this.container.querySelector('#vmax') as HTMLInputElement;
    const cmapSelect = this.container.querySelector('#colormap-selector') as HTMLSelectElement;

    if (!vminInput || !vmaxInput || !cmapSelect) return;

    const vmin = parseFloat(vminInput.value);
    const vmax = parseFloat(vmaxInput.value);
    const colormap_name = cmapSelect.value;

    localStorage.setItem(`${name}-colormap_name`, colormap_name);
    localStorage.setItem(`${name}-vmin`, vmin.toString());
    localStorage.setItem(`${name}-vmax`, vmax.toString());
  }

  // Public API methods
  public setDataset(dataset: string) {
    if (this.state.datasetInfo[dataset]) {
      this.setupDataset(dataset);
      const datasetSelector = this.container.querySelector('#dataset-selector') as HTMLSelectElement;
      if (datasetSelector) {
        datasetSelector.value = dataset;
      }
    }
  }

  public setTimeIndex(index: number) {
    this.state.tileIdx = index;
    this.updateRasterTile();
    const layerSlider = this.container.querySelector('#layer-slider') as HTMLInputElement;
    const layerSliderText = this.container.querySelector('#layer-slider-value') as HTMLSpanElement;
    if (layerSlider && layerSliderText) {
      layerSlider.value = index.toString();
      const timeValue = this.state.datasetInfo[this.state.name].x_values[index];
      layerSliderText.textContent = timeValue.toString();
    }
  }

  public getState() {
    return {
      dataset: this.state.name,
      timeIndex: this.state.tileIdx,
      markerPosition: this.state.markerTs.getLatLng(),
      refMarkerPosition: this.state.markerRef.getLatLng(),
    };
  }
}

// Factory function for creating a Bowser app instance
export function createBowserApp(container: HTMLElement, options: Partial<BowserAppOptions> = {}): BowserApp {
  return new BowserApp({ container, ...options });
}
