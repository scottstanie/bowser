import { createBowserApp } from './bowser-app';

// Initialize the standalone application
const container = document.body;
createBowserApp(container, {
  showSidebar: true,
  onTimeseriesClick: (data) => {
    console.log('Timeseries clicked:', data);
  },
  onDatasetChange: (dataset) => {
    console.log('Dataset changed:', dataset);
  },
  onTimeIndexChange: (index) => {
    console.log('Time index changed:', index);
  }
});

console.log('Bowser standalone app initialized');
