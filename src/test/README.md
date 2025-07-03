# Frontend Testing Setup

This directory contains the modern frontend testing infrastructure for the Bowser React application, with a focus on testing the critical color rescaling functionality and multi-point time series features.

## Testing Framework

- **Vitest**: Fast, modern test runner with Jest-compatible API
- **React Testing Library**: Component testing with focus on user interactions
- **JSDOM**: Browser environment simulation
- **User Event**: Realistic user interaction simulation

## Test Structure

### Core Component Tests

#### `ControlPanel.test.tsx` / `ControlPanel.simple.test.tsx`
Tests the color rescaling functionality that was identified as brittle:
- **Color Scale Input Validation**: Tests vmin/vmax number inputs
- **Colormap Selection**: Tests colormap dropdown and image updates
- **Opacity Control**: Tests opacity slider functionality
- **localStorage Integration**: Tests preference persistence
- **Edge Cases**: Invalid input handling, rapid changes

Key test cases:
```typescript
// Color rescaling - the main issue mentioned
it('updates vmin value when user changes input')
it('updates vmax value when user changes input')
it('saves preferences to localStorage when values change')
it('maintains color scale state when switching between datasets')
```

#### `MapContainer.test.tsx`
Tests the map component and tile layer integration:
- **Tile Layer Updates**: Ensures color parameters propagate to tiles
- **Raster Layer Integration**: Tests URL parameter construction
- **Point Marker Management**: Multi-point functionality
- **Error Handling**: Network failures, invalid data

#### `PointManagerPanel.test.tsx`
Tests the multi-point management interface:
- **Point Creation/Deletion**: Add, remove, edit points
- **Visibility Toggles**: Show/hide points
- **Trend Analysis**: Trend data display
- **User Interactions**: Click, drag, rename functionality

#### `TimeSeriesChart.test.tsx`
Tests the chart component:
- **Data Visualization**: Chart rendering with multi-point data
- **Trend Analysis**: Slope calculation and display
- **User Interactions**: Chart click → time sync
- **Loading States**: Data fetching states

#### `integration.test.tsx`
End-to-end workflow tests:
- **Complete Color Rescaling Workflow**: Full user journey for the brittle color scaling
- **Multi-Point Time Series**: Adding points, enabling trends, chart interaction
- **Error Recovery**: API failures, edge cases

### Context Tests

#### `AppContext.test.tsx`
Tests the React Context state management:
- **State Mutations**: All reducer actions
- **Point Management**: Add, remove, update time series points
- **Color Settings**: vmin, vmax, colormap state
- **Legacy Compatibility**: Backward compatibility with single-point mode

## Test Utilities

#### `src/test/utils.tsx`
Helper functions for consistent test setup:
- `renderWithProvider()`: Renders components with AppContext
- `createMockPoint()`: Creates test time series points
- `createMockDataset()`: Creates test dataset info
- `createMockAppState()`: Creates complete app state for testing

#### `src/test/setup.ts`
Global test configuration:
- Canvas mocking for Chart.js
- ResizeObserver/IntersectionObserver mocks
- Fetch mocking
- Jest-DOM matchers

## Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests once
npm run test:run

# Run specific test file
npm run test:run src/components/__tests__/ControlPanel.simple.test.tsx

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage
```

## Key Focus Areas

### 1. Color Rescaling Brittleness
The main issue identified was that color rescaling "sometimes doesn't fully scale the color correctly until clicking the button." Our tests specifically address:

- **Input Validation**: Ensures vmin/vmax accept decimal values correctly
- **State Persistence**: Tests localStorage save/load of color parameters
- **Tile Layer Updates**: Verifies that parameter changes trigger tile reloads
- **Cross-Dataset Consistency**: Tests color scale state when switching datasets
- **Rapid Changes**: Tests that rapid parameter changes don't cause state corruption

### 2. Multi-Point Functionality
Tests the newer multi-point time series features:

- **Point Management**: Add, remove, edit, toggle visibility
- **Color Assignment**: Unique colors for each point
- **Trend Analysis**: Slope calculation and display
- **Chart Interactions**: Sync between chart clicks and map time

### 3. Error Handling
Ensures the app degrades gracefully:

- **Network Failures**: API timeouts, 404s, malformed responses
- **Invalid Data**: Empty datasets, corrupt localStorage
- **Edge Cases**: Boundary conditions, rapid user interactions

## Mocking Strategy

### External Dependencies
- **Leaflet**: Mocked with simple div elements
- **Chart.js**: Mocked to capture data and options
- **APIs**: Mocked with configurable responses
- **localStorage**: Complete mock implementation

### Component Isolation
Each component is tested in isolation with:
- Mocked dependencies
- Controlled initial state
- Predictable data inputs

## Best Practices Followed

1. **User-Centric Testing**: Tests focus on user interactions, not implementation details
2. **Accessibility**: Tests include proper ARIA labels and semantic HTML
3. **Error Boundaries**: Tests include error handling and edge cases
4. **Performance**: Tests verify that unnecessary re-renders don't occur
5. **Modern Patterns**: Uses latest React Testing Library patterns

## Coverage Goals

The test suite aims to cover:
- ✅ **Color rescaling functionality** - Core issue identified
- ✅ **Multi-point time series** - Key feature
- ✅ **State management** - Context and reducers
- ✅ **User interactions** - Click, drag, type, select
- ✅ **Error scenarios** - Network, validation, edge cases
- ✅ **Integration workflows** - End-to-end user journeys

## Future Improvements

1. **Visual Regression Testing**: Add Chromatic or similar for UI changes
2. **E2E Testing**: Add Playwright for full browser testing
3. **Performance Testing**: Add benchmarks for large datasets
4. **Accessibility Testing**: Add axe-core for a11y validation
