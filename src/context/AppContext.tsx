import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, AppAction } from '../types';

const initialState: AppState = {
  datasetInfo: {},
  tsMarkerPosition: [0, 0],
  refMarkerPosition: [0, 0],
  currentDataset: '',
  currentTimeIndex: 0,
  refValues: {},
  selectedBasemap: 'esriSatellite',
  dataMode: 'md',
  colormap: 'rdbu_r',
  vmin: 0,
  vmax: 1,
  opacity: 1,
  showChart: false,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_DATASETS':
      return { ...state, datasetInfo: action.payload };
    case 'SET_TS_MARKER_POSITION':
      return { ...state, tsMarkerPosition: action.payload };
    case 'SET_REF_MARKER_POSITION':
      return { ...state, refMarkerPosition: action.payload };
    case 'SET_CURRENT_DATASET':
      return { ...state, currentDataset: action.payload };
    case 'SET_TIME_INDEX':
      return { ...state, currentTimeIndex: action.payload };
    case 'SET_REF_VALUES':
      return {
        ...state,
        refValues: {
          ...state.refValues,
          [action.payload.dataset]: action.payload.values,
        },
      };
    case 'SET_BASEMAP':
      return { ...state, selectedBasemap: action.payload };
    case 'SET_DATA_MODE':
      return { ...state, dataMode: action.payload };
    case 'SET_COLORMAP':
      return { ...state, colormap: action.payload };
    case 'SET_VMIN':
      return { ...state, vmin: action.payload };
    case 'SET_VMAX':
      return { ...state, vmax: action.payload };
    case 'SET_OPACITY':
      return { ...state, opacity: action.payload };
    case 'TOGGLE_CHART':
      return { ...state, showChart: !state.showChart };
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
