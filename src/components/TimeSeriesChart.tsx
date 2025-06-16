import { useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useAppContext } from '../context/AppContext';
import { useApi } from '../hooks/useApi';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function TimeSeriesChart() {
  const { state } = useAppContext();
  const { fetchChartTimeSeries } = useApi();
  const [chartData, setChartData] = useState<any>(null);

  useEffect(() => {
    if (!state.showChart || !state.currentDataset) {
      return;
    }

    const updateChart = async () => {
      const [lat, lng] = state.tsMarkerPosition;
      const currentDatasetInfo = state.datasetInfo[state.currentDataset];

      let tsData;
      if (currentDatasetInfo?.uses_spatial_ref) {
        const [refLat, refLng] = state.refMarkerPosition;
        tsData = await fetchChartTimeSeries(lng, lat, state.currentDataset, refLng, refLat);
      } else {
        tsData = await fetchChartTimeSeries(lng, lat, state.currentDataset);
      }

      if (tsData) {
        setChartData(tsData);
      }
    };

    updateChart();
  }, [
    state.showChart,
    state.currentDataset,
    state.tsMarkerPosition,
    state.refMarkerPosition,
    state.datasetInfo,
    fetchChartTimeSeries
  ]);

  const chartOptions = {
    responsive: true,
    animation: {
      duration: 0,
    },
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        suggestedMin: state.vmin,
        suggestedMax: state.vmax,
      },
    },
  };

  if (!state.showChart || !chartData) {
    return null;
  }

  return (
    <div id="chart-container">
      <Line data={chartData} options={chartOptions} />
    </div>
  );
}
