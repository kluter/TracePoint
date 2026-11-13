# Changelog

## v2.4.1

- Fixed: restore and import overwrote images that had no lines yet
- Fixed: EXIF positions in the southern and western hemisphere were mirrored
- Fixed: removing another image switched away from the active one
- Fixed: a line could be dragged off the image
- Photos the browser cannot display (HEIC, broken files) are rejected with a message
- Dropping a second photo opens a new image
- Only one tab writes the autosave
- Lines and points keep their on-screen size when zoomed out
- EXIF card shows flash, orientation, shutter and aperture correctly
- Stricter checks on session files, Content-Security-Policy added
- Faster drawing

## v2.4.0

- Autosave: sessions and images survive a refresh (stored in the browser)
- Autosave switch and Clear button in the ☰ image menu
- Map bar shows bearing, tilt and zoom
- Tilt up to 90° (was 70°)
- Yellow instead of blue for active states
- Changelog moved to this file

## v2.3.0

- Map bar under the map header holds the coordinate search and the ☰ layer menu
- Contrast, brightness, saturation and invert for the photo (☀), display only

## v2.2.0

- Points can be moved: drag the marker on the map or slide the point along its line
- `Esc` while dragging snaps the point back
- Step guide on the image with a hint for the next step
- Smaller geo markers

## v2.1.0

- 3D terrain toggle in the map menu
- Right-click menu: copy coordinates, open the spot in Google, Apple, Bing or Yandex Maps
- Map view in the URL hash (`#lat,lon,zoom`)

## v2.0.0

- Map engine switched from Leaflet to [MapLibre GL JS](https://maplibre.org/)
- Rotate and tilt the map (Ctrl + drag or right-drag), `N` resets north
- Middle-drag pans
- Libraries bundled in the repo, no CDN
- Session files are json_version 2; files from v1.x are not converted

## v1.8.0

- Coordinate search: paste decimal, DMS or Google Maps links to drop numbered pins
- `Ctrl+V` anywhere on the page
- Zoom buttons moved to bottom-left

## v1.7.1

- Custom layers fall back to lower-zoom tiles instead of showing black tiles

## v1.7.0

- Custom XYZ map layers (add, edit, remove)
- Sentinel-2 2024 layer
- Esri Dark Gray replaces CARTO Dark Matter

## v1.6.2

- Fixed: map panned to the intersection on every point placement

## v1.6.1

- EXIF GPS popup restyled, copy button added
- Fixed: EXIF ray after session import

## v1.6.0

- EXIF direction ray from GPS position and camera bearing
- Copy coordinates button

## v1.5.0

- Keyboard shortcuts
- Confidence ellipse for 3+ lines
- Maximum of 5 lines per image

## v1.4.3

- Lines and points moved to a dedicated bar below the toolbar

## v1.4.2

- Fixed: orphaned map rays, map-point mode not clearing, false auto-zoom

## v1.4.1

- Security hardening and JSON import validation
- Toast notifications

## v1.4.0

- EXIF metadata viewer with GPS map marker

## v1.3.0

- Session export and import
- Browse button
- Bearing display

## v1.2.1

- Fixed: session naming, color and map view

## v1.2.0

- Multi-image session manager

## v1.1.0

- Horizon correction tool

## v1.0.0

- Initial release
