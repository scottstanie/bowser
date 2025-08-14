import { createBowserApp, BowserApp } from './bowser-app';

// anywidget module interface
interface AnyWidgetModule {
  model: any;
  el: HTMLElement;
}

let bowserApp: BowserApp | null = null;

export function render({ model, el }: AnyWidgetModule) {
  // Clear any existing content
  el.innerHTML = '';

  // Set up widget container styling
  el.style.width = model.get('width') || '100%';
  el.style.height = model.get('height') || '600px';
  el.style.border = '1px solid #ccc';
  el.style.borderRadius = '4px';
  el.style.overflow = 'hidden';

  // Get server URL from Python side
  const serverUrl = model.get('server_url') || '';

  // Create the Bowser app instance
  bowserApp = createBowserApp(el, {
    baseUrl: serverUrl,
    showSidebar: true, // Show full interface in widget
    onTimeseriesClick: (data) => {
      // Send timeseries data back to Python
      model.send({
        event: 'timeseries_click',
        data: data
      });

      // Update the last_timeseries trait
      model.set('last_timeseries', data);
      model.save_changes();
    },
    onDatasetChange: (dataset) => {
      // Update dataset trait
      model.set('dataset', dataset);
      model.save_changes();

      // Notify Python side
      model.send({
        event: 'dataset_selected',
        dataset: dataset
      });
    },
    onTimeIndexChange: (index) => {
      // Update time index trait
      model.set('time_index', index);
      model.save_changes();

      // Notify Python side
      model.send({
        event: 'time_index_updated',
        time_index: index
      });
    }
  });

  // Listen for trait changes from Python side
  model.on('change:dataset', () => {
    const newDataset = model.get('dataset');
    if (bowserApp && newDataset) {
      bowserApp.setDataset(newDataset);
    }
  });

  model.on('change:time_index', () => {
    const newIndex = model.get('time_index');
    if (bowserApp && typeof newIndex === 'number') {
      bowserApp.setTimeIndex(newIndex);
    }
  });

  // Listen for custom messages from Python
  model.on('msg:custom', (msg: any) => {
    if (msg.cmd === 'init') {
      console.log('Widget initialized with server URL:', msg.server_url);
    } else if (msg.cmd === 'dataset_changed') {
      if (bowserApp) {
        bowserApp.setDataset(msg.dataset);
      }
    } else if (msg.cmd === 'time_index_changed') {
      if (bowserApp) {
        bowserApp.setTimeIndex(msg.time_index);
      }
    }
  });

  // Handle widget resizing
  const resizeObserver = new ResizeObserver(() => {
    if (bowserApp) {
      // Trigger a map resize event if needed
      const mapContainer = el.querySelector('#map') as HTMLElement;
      if (mapContainer) {
        // Leaflet map resize
        setTimeout(() => {
          const mapInstance = (bowserApp as any).map;
          if (mapInstance && mapInstance.invalidateSize) {
            mapInstance.invalidateSize();
          }
        }, 100);
      }
    }
  });

  resizeObserver.observe(el);

  // Cleanup function
  return () => {
    resizeObserver.disconnect();
    bowserApp = null;
  };
}
