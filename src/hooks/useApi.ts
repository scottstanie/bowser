import { useCallback } from 'react';

export function useApi() {
  const fetchDatasets = useCallback(async () => {
    const response = await fetch('/datasets');
    return await response.json();
  }, []);

  const fetchDataMode = useCallback(async () => {
    const response = await fetch('/mode');
    const data = await response.json();
    return data.mode;
  }, []);

  const fetchPointTimeSeries = useCallback(async (lon: number, lat: number, datasetName: string) => {
    const params = new URLSearchParams({
      dataset_name: datasetName,
      lon: lon.toString(),
      lat: lat.toString(),
    });

    try {
      const response = await fetch(`/point?${params}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching point time series:', error);
      return undefined;
    }
  }, []);

  const fetchChartTimeSeries = useCallback(async (
    lon: number,
    lat: number,
    datasetName: string,
    refLon?: number,
    refLat?: number
  ) => {
    const params: Record<string, string> = {
      lon: lon.toString(),
      lat: lat.toString(),
      dataset_name: datasetName,
    };

    if (refLon !== undefined && refLat !== undefined) {
      params.ref_lat = refLat.toString();
      params.ref_lon = refLon.toString();
    }

    const urlParams = new URLSearchParams(params);

    try {
      const response = await fetch(`/chart_point?${urlParams}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching chart time series:', error);
      return undefined;
    }
  }, []);

  return {
    fetchDatasets,
    fetchDataMode,
    fetchPointTimeSeries,
    fetchChartTimeSeries,
  };
}
