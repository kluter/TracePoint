# Changelog

## Unreleased

- Show on map in the image metadata card turns into Remove from map once the GPS marker is on the map, and takes it away again
- The tools of the line bar (new line, metadata, fit, adjust, level) are always visible; without a photo they are greyed out and do nothing, and `E` and `W` do nothing either
- Show original sits in the row next to Adjust and is greyed out until the photo is adjusted
- Opening the street-level panel no longer moves the map: pick a spot on the coverage overlay (now thicker and easier to see), with Map centre, or with right-click
- The 3D terrain switch enables the Height slider right away, not only after another map setting changed

## v2.8.0

- Export with photos: an "Include photos" switch in the ☰ menu of the photo side, off by default and remembered. With it on, exported files carry each photo, and import restores it without asking for the image. The photo goes in unchanged, with its GPS and camera data, and the file gets about a third bigger than the photo
- `Ctrl+S` exports all sessions, with or without photos as the switch says
- Street-level imagery: a button in the map bar opens a panel above the map with the photo nearest to the map centre, or to a spot picked with right-click → "Street-level imagery here". Drag the divider to resize the panel
- Walk from photo to photo: click in the photo towards where you want to go, or use the arrow keys (up and down along the view, left and right sideways). The map follows to where each photo was taken
- 360° photos can be looked around in (drag, wheel zooms); a marker on the map shows where the photo was taken and which way the view points
- Coverage overlay for Panoramax: lines and dots on the map show where photos exist (solid lines for 360°, dashed for ordinary photos); click one to load the photo there. The Coverage button in the panel switches it off
- Sources: Panoramax (no key) and Mapillary (your own free token, kept in this browser only). HD loads the full resolution. The servers are only contacted while the panel is open
- Images are tabs in the photo header: click to switch, double-click the name or `F2` to rename, × to remove, + to add
- New line is a + button in the line bar, and Level sits there too, left of the ☰ menu; the "+ New Line" and "Level" buttons in the header are gone
- The ☰ menu of the photo side has sections like the map panel: File (Import…, Export this image, Export all, Include photos), This browser (Autosave, Clear) and Demo
- Basemap dropdown in the map header, in place of the "Map View" title: it shows the active basemap and lists the built-in and custom layers. The map panel keeps terrain, buildings and camera and opens from a sliders button
- Opening the map panel, the basemap list or the help card closes the other two
- Help card is much shorter: six one-line steps and a compact key list, with a link to the full controls in the README
- Map bar readout (bearing, tilt, zoom) is slimmer, with more room around it

## v2.7.0

- One map panel behind the ☰ button with three sections: Basemap, Terrain and Camera. It stays open while you use it
- Terrain: height exaggeration (1–3×) and hillshade, with or without 3D terrain
- Camera: field of view (shown with its full-frame focal length), max tilt, min and max zoom, North up and Top down
- Reset puts all sliders of the panel back to their defaults
- Compass moved to the bottom-left of the map; the zoom buttons are gone (mouse wheel, double-click or `+` / `−` zoom)
- 3D buildings: OpenStreetMap buildings as blocks on top of any basemap, with an opacity slider. Off by default; the shapes come from OpenFreeMap (no key) and that server is only contacted while the switch is on
- Distance measurement: ruler button next to the compass, `M`, or right-click → "Measure distance from here". Two clicks give the straight-line ground distance, with a live preview after the first; `Esc` clears
- Right-click menu: OpenStreetMap joins Google Maps, Street View and Google Earth; an "Open in…" submenu adds Apple Maps, Lookmap, Bing Maps, Mapillary, Yandex Maps and Baidu Maps
- Coordinate paste reads links from Apple Maps, Bing, Yandex, OpenStreetMap, Lookmap, Baidu and Google Earth, any link with `lat=`/`lon=`, and Web Mercator values; short links get their own message
- Fixed: with 3D terrain, dragging or wheel-zooming near the horizon or over tiles that had not loaded yet could throw the map kilometres away or change the zoom by many levels
- Top down keeps the bearing, North up keeps the tilt
- Map settings are remembered in this browser

## v2.6.0

- Draggable divider between photo and map: drag to resize, double-click for 50/50, arrow keys when focused (Shift for bigger steps); the split is remembered
- A chevron on the divider hides the photo side and brings it back
- `Ctrl+V` with an image in the clipboard opens it as a photo, named `pasted_image_01`, `pasted_image_02`, …; clipboard images carry no EXIF data
- Empty photo view reads "Drop / Paste image here" and has a "Try the Demo" button
- Fit photo button in the line bar
- Show original: a switch next to ☀ and in the adjust card, yellow while the unadjusted photo is on screen
- Stronger adjustments: contrast and brightness 25–300% (was 50–150%), saturation 0–300%; sliders stay centred on 100%, double-click resets one
- Rename an image with the pencil in the ☰ image list or with `F2`; the name is used in exports and autosave
- Removing or exporting an image from the list no longer switches to it first

## v2.5.0

- Undo and redo for lines and points, on the photo and on the map: `Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y`, up to 100 steps per image
- Photo points are open rings instead of filled dots, so the spot under a point stays visible; a point placed on the map gets two side arms
- `E` puts the new line under the mouse
- No more Drag / Add Point modes: a click on the active line places a point, a drag moves the line; the Mode button and `Tab` are gone
- After the second point the map placement starts by itself; a tag next to the mouse says which point the next map click places, and that point pulses on the photo
- A point picked on the photo is highlighted on the map and the other way round
- `Delete` or `Backspace` removes the selected point, or the active line if no point is selected
- Shorter hint texts

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
