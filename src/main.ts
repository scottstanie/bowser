import './style.css'
import Chart from 'chart.js/auto';
import * as L from "leaflet";
import { BaseMapItem, baseMaps } from "./basemap"

// TODO
/*
- for single products (file_list.length === 1), hide the slider
  - also the python breaks now
- Reference
  - have a "usesReference" field in `set-data`
    - cor: false
    - unw: true
*/

interface State {
  datasetInfo: { [key: string]: RasterGroup };
  markerTs: L.Marker;
  markerRef: L.Marker;
  // Url of the raster to use into the map comes from:
  // 1. name of current dataset to show
  name: string;
  // 2. current index of the file list of the current dataset
  // For sliding through files of a dataset
  tileIdx: number;
  tile: L.TileLayer | null;
  // The shifts from the reference point for all `tileIdx`s
  // Maps from dataset name (like `datasetInfo`) to array of values
  refValues: { [key: string]: number[] };
  // Background tiles
  basemap: BaseMapItem
}


interface RasterGroup {
  name: string;
  file_list: string[];
  nodata: number | null;
  uses_spatial_ref: boolean;
  algorithm: string | null;
  latlon_bounds: [number, number, number, number];
  x_values: Array<number | string>;
}


var map = L.map('map', {
  // https://leafletjs.com/reference.html#map-factory
  doubleClickZoom: false,
})



const fontAwesomeIcon = L.divIcon({
  // html: '<i class="fa-solid fa-asterisk fa-4x""></i>',
  html: '<i class="fa-solid fa-location-dot fa-3x"></i>',
  iconSize: [20, 20],
  className: 'myDivIcon'
});

var state: State = {
  datasetInfo: {},
  markerTs: L.marker([0, -0.], { draggable: true, title: 'Time Series Point' }),
  markerRef: L.marker([0, -0.], { icon: fontAwesomeIcon, draggable: true, title: 'Reference Location' }),
  // Name of dataset to show
  name: 'unwrapped',
  tile: null,
  tileIdx: 0,
  refValues: {},
  basemap: baseMaps.esriSatellite,
};

const curUsesRef = () => state.datasetInfo[state.name].uses_spatial_ref

// Add the satellite layer
let baseMapTile = L.tileLayer(state.basemap.url, {
  maxZoom: 19,
  attribution: state.basemap.attribution
})
baseMapTile.addTo(map);

// Get the url for the current choice
const basemapSelector = document.getElementById('basemap-selector') as HTMLInputElement
// Change the base map upon selection
basemapSelector.addEventListener('change', (event) => {
  const target = (event.target as HTMLSelectElement)
  const newUrl = target.value

  const newBasemapName: string = target.options[target.selectedIndex].innerText
  const newBasemap = baseMaps[newBasemapName]

  // Drop the old attribution
  map.attributionControl.removeAttribution(state.basemap.attribution)

  // Switch to new one
  state.basemap = newBasemap
  baseMapTile.setUrl(newUrl)
  map.attributionControl.addAttribution(state.basemap.attribution)
})

// Add the basemap choices to #
// Update the dropdown
for (const [name, basemap] of Object.entries(baseMaps)) {
  const option = document.createElement('option');
  option.textContent = name;
  option.value = basemap.url;
  basemapSelector.appendChild(option);
  console.log(name, basemap)
}

map.on('click', function (e) {
  // Set the markers
  console.log('click', e.latlng)
  let lat = e.latlng.lat
  let lon = e.latlng.lng
  state.markerTs.setLatLng([lat, lon])
  chartContainer.style.display !== 'none' && updateChart()
});

const setRefValues = (datasetName: string) => {
  const { lat, lng } = state.markerRef.getLatLng()
  console.log('shifting', lat, lng)
  getPointTimeSeries(lng, lat, datasetName)
    .then((values) => {
      console.log('getPointTimeSeries', values)
      if (values !== undefined) {
        state.refValues[datasetName] = values
        // If the current dataset uses this, then re-render
        curUsesRef() && updateRasterTile()
      }
    }, (error) => {
      console.log('setRefValues error:', error)
    })
}
// drag for the markers
state.markerTs.on('moveend', function () {
  console.log('moveend', state.markerTs.getLatLng())
  chartContainer.style.display !== 'none' && updateChart()
});
state.markerRef.on('moveend', function () {
  chartContainer.style.display !== 'none' && updateChart()
  // Save these new values to the state
  setRefValues(state.name)
});

// Add a location pop up when you click on either marker
const showLatLngPopup = (event: L.LeafletMouseEvent) => {
  const { lat, lng } = event.latlng
  L.popup()
    .setLatLng(event.latlng)
    .setContent(`Marker (lon, lat):\n(${lng.toFixed(6)}, ${lat.toFixed(6)})`)
    .addTo(map)
}
state.markerRef.addEventListener('click', showLatLngPopup)
state.markerTs.addEventListener('click', showLatLngPopup)

const cmapNameSelect = document.getElementById('colormap-selector') as HTMLInputElement
const colormapImg = document.getElementById('colormap-img') as HTMLImageElement
const vminSelect = document.getElementById('vmin') as HTMLInputElement
const vmaxSelect = document.getElementById('vmax') as HTMLInputElement


const loadPreferences = (name: string) => {
  const colormap_name = localStorage.getItem(`${name}-colormap_name`)
  const vmin = localStorage.getItem(`${name}-vmin`)
  const vmax = localStorage.getItem(`${name}-vmax`)
  if (vmin === null || vmax === null || colormap_name === null) {
    return { colormap_name: null, vmin: null, vmax: null };
  }

  cmapNameSelect.value = colormap_name;
  colormapImg.src = `/colorbar/${colormap_name}`
  vminSelect.value = vmin
  vmaxSelect.value = vmax
  return { colormap_name: colormap_name, vmin: parseFloat(vmin), vmax: parseFloat(vmax) }
}
// document.addEventListener('DOMContentLoaded', () => {
//   loadPreferences(state.datasetInfo[state.name]);
// });

const savePreferences = (name: string) => {
  const vmin = parseFloat(vminSelect.value);
  const vmax = parseFloat(vmaxSelect.value);
  const colormap_name = cmapNameSelect.value;
  localStorage.setItem(`${name}-colormap_name`, colormap_name)
  localStorage.setItem(`${name}-vmin`, vmin.toString())
  localStorage.setItem(`${name}-vmax`, vmax.toString())
}

// Setting up the raster tiles
const updateRasterTile = () => {
  const { name, tileIdx } = state
  const curDataset = state.datasetInfo[name];

  let { colormap_name, vmin, vmax } = loadPreferences(name)
  // Fetch UI values for color map name/limits if not set
  if (colormap_name === null) colormap_name = cmapNameSelect.value;
  if (vmin === null) vmin = parseFloat(vminSelect.value);
  if (vmax === null) vmax = parseFloat(vmaxSelect.value);
  setChartYLimits(vmin, vmax)

  // Save colormap preferences to localStorage
  colormapImg.src = `/colorbar/${colormap_name}`
  // make sure we aren't passed the edge
  // TODO: should probably record the last tileIdx per dataset?
  // Otherwise, we should have one per "same length" lists
  const curTileIdx = Math.max(0, Math.min(tileIdx, curDataset.file_list.length))
  state.tileIdx = curTileIdx
  const url = curDataset.file_list[curTileIdx];

  let params: { [key: string]: string } = {
    url: encodeURIComponent(url),
    rescale: `${vmin},${vmax}`,
    colormap_name: colormap_name,
    // algorithm_params:
  }
  if (curDataset.algorithm !== null) params.algorithm = curDataset.algorithm
  if (curDataset.nodata !== null) params.nodata = curDataset.nodata.toString()

  if (state.refValues[name] !== undefined) {

    const shift = state.refValues[name][tileIdx]
    console.log(`updateRasterTile: shift=${shift} for ${name}`)
    if (params.algorithm === 'shift') {
      if (shift !== undefined) {
        params.algorithm_params = `{"shift": ${shift}}`
      } else {
        console.log(`Error in updateRasterTile: shift=${shift} for ${name}`)
        delete params['algorithm']
      }
    }
  }

  const url_params = Object.keys(params).map(i => `${i}=${params[i]}`).join('&')
  console.log('url_params', url_params)

  // TODO: do i like the loader?
  // document.getElementById('loader').classList.add('off')
  fetch(`/tilejson.json?${url_params}`
  ).then(response => response.json())
    .then((tileInfo) => {

      // Create a new tile layer and remove old
      let newTile = L.tileLayer(tileInfo.tiles[0], {
        maxZoom: 19,
      })
      if (state.tile !== null) {
        map.removeLayer(state.tile)
      }
      newTile.addTo(map)
      state.tile = newTile

    }, error => {
      console.error('Error in getting tile info:', error)
    });
}

// Add handler for changing the dataset
const datasetSelector = document.getElementById('dataset-selector') as HTMLSelectElement;
datasetSelector.addEventListener('change', (event: Event) => {
  // Save the current preferences
  savePreferences(state.name)

  // Get the new dataset name
  const datasetName = (event.target as HTMLSelectElement).value;
  console.log('Changing! datasetName', datasetName)
  // Update the raster tiles/sliders
  setupDataset(datasetName)

  loadPreferences(datasetName);  // Load preferences for the new dataset
});

// Whenever it's dragged, update the text so the user knows where it is
const layerSlider = document.getElementById('layer-slider') as HTMLInputElement;
const layerSliderText = document.getElementById('layer-slider-value') as HTMLSpanElement;
layerSlider.addEventListener('input', (event: Event) => {
  const { name } = state
  const target = event.target as HTMLInputElement;
  let newIdx: number = parseInt(target.value);

  // Change the name listed in the layerSliderText layer-slider-value
  const url = state.datasetInfo[name].file_list[newIdx];
  const lastSegment = url.split('/').pop() as string | null;
  layerSliderText.textContent = lastSegment;
})

// Then if it actually changes, set the new raster image
layerSlider.addEventListener('change', (event: Event) => {
  console.log(event)
  const { name } = state
  const target = event.target as HTMLInputElement;
  let newIdx: number = parseInt(target.value);
  state.tileIdx = newIdx;
  state.name = name;
  // Trigger the update
  updateRasterTile()

})

// Add a colormap change watcher
cmapNameSelect.addEventListener('change', () => { savePreferences(state.name); updateRasterTile() })

// Add a vmin/vmax change watcher
vminSelect.addEventListener('change', () => { savePreferences(state.name); updateRasterTile() })
vmaxSelect.addEventListener('change', () => { savePreferences(state.name); updateRasterTile() })

// Attach the opacity slider layer
const opacitySlider = document.getElementById('opacity-slider') as HTMLInputElement
const opacitySliderText = document.getElementById('opacity-slider-value') as HTMLSpanElement
opacitySlider.addEventListener('input', (event: Event) => {
  // Get the new opacity value
  const opacity = (event.target as HTMLInputElement).value
  opacitySliderText.textContent = opacity
  // Update the raster tile
  if (state.tile !== null) {
    state.tile.setOpacity(parseFloat(opacity))
  }
});

const setupDataset = (name: string) => {
  const curDataset = state.datasetInfo[name]

  // Set up the slider for the dataset
  layerSlider.max = (curDataset.file_list.length - 1).toString()
  const lastSegment = curDataset.file_list[0].split('/').pop() as string | null;
  layerSliderText.textContent = lastSegment;
  // Save to the state
  state.name = name;

  if ((state.datasetInfo[name].uses_spatial_ref) && (state.refValues[name] === undefined)) {
    setRefValues(name)
  }

  updateRasterTile();
}

const computeCenter = (name: string) => {
  const curDataset = state.datasetInfo[name]
  // Use the bounds for setting up the map/pointers
  let bounds = curDataset.latlon_bounds;
  // Compute initial center
  const centerLat = (bounds[1] + bounds[3]) / 2;
  const centerLng = (bounds[0] + bounds[2]) / 2;
  return { centerLat: centerLat, centerLng: centerLng }
}

// Fetch the dataset info from /datasets
// Should be something like
// {"unwrapped":{"name":"unwrapped","file_list":["./data2/20.tif", ...],"vmin":-10.0,"vmax":10.0,
//     ??? "algorithm":null}}
const initializeDatasets = () => {
  fetch('/datasets')
    .then(response => response.json())
    .then((data) => {
      state.datasetInfo = data;
      console.log('datasetInfo', state.datasetInfo);

      // Set the initial tile to be the first one
      const name0: string = Object.keys(state.datasetInfo)[0];

      // Set the view
      const { centerLat, centerLng } = computeCenter(name0)
      map.setView([centerLat, centerLng], 9);
      for (let marker of [state.markerTs, state.markerRef]) {
        marker.setLatLng([centerLat, centerLng])
      }

      setupDataset(name0);

      // Update the dropdown
      datasetSelector.innerHTML = '';
      Object.keys(state.datasetInfo).forEach((dsName) => {
        const option = document.createElement('option');
        option.value = dsName;
        option.textContent = dsName;
        datasetSelector.appendChild(option);
      });
    })
}

// /////////////////////////////////////
// Chart and time series clicking setup
// /////////////////////////////////////
const chartElem = document.querySelector<HTMLCanvasElement>('#chart')!
const chartContainer = document.querySelector<HTMLCanvasElement>('#chart-container')!
const hideChartBtn = document.querySelector<HTMLButtonElement>("#hide-chart")!;


var chart = new Chart(
  chartElem,
  {
    options: {
      animation: false,
      plugins: {
        legend: { display: false }
      },
      scales: { y: {} }
    },
    type: 'line',
    // Start empty
    data: { datasets: [] }
  }
)

function setChartYLimits(min: number, max: number) {
  // https://www.chartjs.org/docs/latest/developers/updates.html#updating-options
  // Use type assertion to inform TypeScript that we've ensured yAxis is an object
  const scales = chart.options.scales || {}
  const yAxis = scales.y || {}
  // Note: SUGGESTION means it gets overridden by real data limits, not cut off
  yAxis.suggestedMin = min
  yAxis.suggestedMax = max
  chart.update()
}

async function getPointTimeSeries(lon: number, lat: number, name: string) {
  const params: { [key: string]: any } = {
    dataset_name: name,
    lon: lon,
    lat: lat,
  }
  const url_params = Object.keys(params).map(i => `${i}=${params[i]}`).join('&')
  const endpoint = `/point?${url_params}`
  console.log(endpoint)
  // Get the data from the server using `fetch`, save it in a variable
  try {
    const response = await fetch(endpoint);
    return await response.json();
  } catch (error) {
    return console.log(error);
  }
}

async function getChartTimeSeries(lon: number, lat: number, ref_lon: number | null = null, ref_lat: number | null = null) {
  let params: { [key: string]: any } = {
    lon: lon,
    lat: lat,
    dataset_name: state.name,
  }
  if (ref_lon !== null && ref_lat !== null) {
    params.ref_lat = ref_lat
    params.ref_lon = ref_lon
  }

  const url_params = Object.keys(params).map(i => `${i}=${params[i]}`).join('&')
  const endpoint = `/chart_point?${url_params}`
  console.log(endpoint)
  // Get the data from the server using `fetch`, save it in a variable
  try {
    const response = await fetch(endpoint);
    return await response.json();
  } catch (error) {
    return console.log(error);
  }
}

function updateChart() {
  // const response = fetch(`/point?lon=${lon}&lat=${lat}`)
  // Get the current marker position
  const { lat, lng } = state.markerTs.getLatLng();
  // Get the reference marker position
  let tsPromise
  // Get the data from the server using `fetch`, save it in a variable
  if (curUsesRef()) {
    const refLatlng = state.markerRef.getLatLng();
    tsPromise = getChartTimeSeries(lng, lat, refLatlng.lng, refLatlng.lat)
  } else {
    tsPromise = getChartTimeSeries(lng, lat)
  }

  tsPromise.then((data) => {
    chart.data = data
    // Or if we want to update the data in the existing chart:
    // chart.data.datasets.pop()
    chart.update()
  })
}

state.markerRef.addTo(map);
hideChartBtn.addEventListener('click', () => {
  if (chartContainer.style.display !== 'none') {
    chartContainer.style.display = 'none';
    hideChartBtn.textContent = 'Show time series';
    state.markerTs.remove();
    // (!curUsesRef()) && state.markerRef.remove();
  } else {
    chartContainer.style.display = 'block';
    hideChartBtn.textContent = 'Hide time series';
    state.markerTs.addTo(map);
    // state.markerRef.addTo(map);
  }
});


// /////////////////////////////////////
// Page start: setup the datasets
// /////////////////////////////////////
console.log('trying setup...')
initializeDatasets();
console.log('datasets loaded?', state.datasetInfo);
