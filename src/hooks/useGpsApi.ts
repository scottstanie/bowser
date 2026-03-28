import { useCallback } from 'react';
import { GpsStation, GpsTimeseriesEntry } from '../types';

export function useGpsApi() {
  const fetchLosInfo = useCallback(async (): Promise<{ type: string; east?: number; north?: number; up?: number } | null> => {
    const response = await fetch('/gps/los_info');
    if (!response.ok) return null;
    return await response.json();
  }, []);

  const fetchGpsStations = useCallback(async (bbox: [number, number, number, number]): Promise<GpsStation[]> => {
    const [west, south, east, north] = bbox;
    const response = await fetch(`/gps/stations?bbox=${west},${south},${east},${north}`);
    if (!response.ok) return [];
    return await response.json();
  }, []);

  const fetchGpsTimeseries = useCallback(async (stationId: string): Promise<{
    station_id: string;
    station_name: string;
    los_vector: { east: number; north: number; up: number };
    timeseries: GpsTimeseriesEntry[];
  } | null> => {
    const response = await fetch(`/gps/stations/${stationId}/timeseries`);
    if (!response.ok) return null;
    return await response.json();
  }, []);

  return { fetchLosInfo, fetchGpsStations, fetchGpsTimeseries };
}
