import type * as maplibregl from 'maplibre-gl';

// Use export type for interfaces with isolatedModules
export type MousePositionOptions = {
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    separator?: string;
    emptyString?: string;
    lngFirst?: boolean;
    numDigits?: number;
    lngFormatter?: (lng: number) => string;
    latFormatter?: (lat: number) => string;
    prefix?: string;
};

class MousePositionControl implements maplibregl.IControl {
    private _container: HTMLElement | null = null;
    private _map: maplibregl.Map | null = null;
    public options: MousePositionOptions;

    constructor(options?: MousePositionOptions) {
        this.options = {
            position: 'bottom-left',
            separator: ' : ',
            emptyString: 'Unavailable',
            lngFirst: false,
            numDigits: 5,
            lngFormatter: undefined,
            latFormatter: undefined,
            prefix: "",
            ...options
        };
    }

    onAdd(map: maplibregl.Map): HTMLElement {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group mouseposition-control';
        this._container.style.cssText = `
            background: rgba(255, 255, 255, 0.9);
            color: #333;
            padding: 5px 10px;
            font-family: 'Open Sans', sans-serif;
            font-size: 11px;
            line-height: 18px;
            border-radius: 3px;
            pointer-events: none;
        `;

        map.on('mousemove', this._onMouseMove.bind(this));
        this._container.innerHTML = this.options.emptyString || '';
        return this._container;
    }

    onRemove(): void {
        if (this._map) {
            this._map.off('mousemove', this._onMouseMove.bind(this));
        }
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = null;
    }

    getDefaultPosition(): maplibregl.ControlPosition {
        return (this.options.position || 'bottom-left') as maplibregl.ControlPosition;
    }

    private _onMouseMove(e: maplibregl.MapMouseEvent): void {
        if (!this._container) return;

        const lng = this.options.lngFormatter
            ? this.options.lngFormatter(e.lngLat.lng)
            : e.lngLat.lng.toFixed(this.options.numDigits || 5);

        const lat = this.options.latFormatter
            ? this.options.latFormatter(e.lngLat.lat)
            : e.lngLat.lat.toFixed(this.options.numDigits || 5);

        // Format with labels "lon" and "lat"
        const formattedText = `lon ${lng}    lat ${lat}`;

        // Add prefix if it exists
        const prefixAndValue = this.options.prefix
            ? this.options.prefix + ' ' + formattedText
            : formattedText;

        this._container.innerHTML = prefixAndValue;
    }
}

// Use export type for type-only exports with isolatedModules
export { MousePositionControl };
