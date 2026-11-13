# Changelog

| Version | Changes |
|---------|---------|
| v2.4.0 | Autosave: sessions and their images are kept in the browser (IndexedDB) and come back after a refresh, also after a hard reload. Autosave switch and Clear button in the ☰ image menu; off deletes the saved copy. Map bar shows bearing, tilt and zoom of the map. Tilt goes up to 90° (was 70°). Active states, slider knobs and focus borders use the yellow of the step guide instead of blue. README shortened; the changelog moved to this file. |
| v2.3.0 | Map bar under the map header, mirroring the line bar on the image side: the coordinate search box and the ☰ layer menu moved there, off the map. Contrast, brightness and saturation sliders plus an invert switch for the photo (☀ in the line bar), display only, never written to the session file. |
| v2.2.0 | Points can be moved after placing: drag the marker on the map (ray follows live, intersection updates on release) or slide the point along its line on the image. `Esc` while dragging snaps it back. Step guide on the image: the next step glows, a hint in the header says what to do, including "click the map to place L1 P2". Smaller geo markers, as before v2. |
| v2.1.0 | 3D terrain toggle in the map menu (Mapzen Terrarium elevation tiles via AWS, off by default); clicks land on the slope. Right-click menu on the map: copy coordinates or open the spot in Google Maps, Street View, Google Earth, Apple, Bing or Yandex Maps. Map view in the URL hash (`#lat,lon,zoom`), restored on load. |
| v2.0.0 | Map engine switched from Leaflet to [MapLibre GL JS](https://maplibre.org/): rotate and tilt the map (Ctrl + drag or right-drag, compass or `N` resets north), middle-drag pans, smoother zooming. Compass button bottom-right. Both libraries are now bundled in the repo, no CDN. Session files are json_version 2: map zoom is stored in MapLibre terms (one less than before) and the saved view includes bearing and pitch. Files from v1.x are not converted. |
| v1.8.0 | Coordinate search: paste decimal, DMS or Google Maps links to drop numbered pins, listed under the search box. `Ctrl+V` anywhere on the page. Map zoom buttons moved to bottom-left. |
| v1.7.1 | Custom layers fall back to lower-zoom tiles when a server has no tiles at the current zoom (no more black tiles on older Wayback releases). |
| v1.7.0 | Custom XYZ map layers (add, edit, remove, saved in browser). Sentinel-2 2024 layer. Esri Dark Gray replaces CARTO Dark Matter. |
| v1.6.2 | Fixed map panning to intersection on every geo point placement. |
| v1.6.1 | EXIF GPS popup restyled. Copy button added to GPS. EXIF ray fixed after session import. |
| v1.6.0 | EXIF direction ray: ray from GPS position and camera bearing. Copy coordinates button. |
| v1.5.0 | Keyboard shortcuts, confidence ellipse for 3+ lines, 5-line maximum per image. |
| v1.4.3 | Line bar redesign: lines and points move to a dedicated bar below the toolbar. |
| v1.4.2 | UX bug fixes: orphaned map rays, map-point mode not clearing, auto-zoom false trigger. |
| v1.4.1 | Security hardening, JSON import validation, toast notification system. |
| v1.4.0 | EXIF metadata viewer with GPS map marker. |
| v1.3.0 | Session export / import, browse button, bearing display. |
| v1.2.1 | Session naming, colour and map view fixes. |
| v1.2.0 | Multi-image session manager. |
| v1.1.0 | Horizon correction tool. |
| v1.0.0 | Initial release. |
