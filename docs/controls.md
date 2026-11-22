# Controls

The full reference for TracePoint's mouse, menu and keyboard controls. For a quick start, see the [README](../README.md#how-to-use).

## Mouse & UI

| Action | How |
|---|---|
| Pan image | Drag an empty part of the photo (away from the lines), Space + drag, or middle-click drag. A click without moving still deselects |
| Level image | Level button in the line bar, in the button group left of the ☰ menu, then click two points on a horizontal reference. Click it again to reset |
| Deselect / cancel | Click blank canvas, or `Esc` |
| Place point on map | Click the map pill, then click the map |
| Move a point | Drag its marker on the map, or slide it along its line on the image. `Esc` while dragging snaps it back |
| Adjust the photo on screen | ☀ button in the line bar: contrast and brightness 25–300%, saturation 0–300%, invert. Double-click a slider to reset it. The button next to ☀ switches between the original and the adjusted photo. Display only: the photo, lines and exports are untouched |
| Fit the photo | Corner-brackets button in the line bar: the whole photo, centred in the panel |
| Images | Tabs in the photo header: click to switch, double-click the name or `F2` to rename, × to remove, **+** to add |
| Layout | Drag the divider between photo and map, double-click it for 50/50, or fold the photo side away with the chevron on it |
| New line | **+** button at the left of the line bar, or `E` |
| Export, import, demo | ☰ button, right of the line bar |
| Export with photos | **Include photos** switch in the ☰ menu of the photo side, off by default. On: every export stores each photo inside the JSON, unchanged, with its GPS and camera data; the file gets about a third bigger than the photo. Import then restores the photo by itself |
| Export for Google Earth or GIS | Download button in the map bar, greyed out until a line is on the map: **Google Earth** (`.kml`) or **GIS** (`.geojson`). All images with their rays, map points, estimated position and error ellipse. Export only; see [export](export.md) |
| Autosave on / off, clear saved work | **This browser** section of the ☰ menu of the photo side. Off or **Clear** deletes the copy kept in the browser |
| Image metadata | `</>` button in the line bar. **Show on map** places the EXIF GPS position; the same button, now **Remove from map**, takes it away again |
| Rotate / tilt map | Ctrl + drag, or right-click drag, tilt up to 90°. Click the compass (bottom-left of the map) or press `N` to reset. The map bar shows bearing, tilt and zoom |
| Basemap | The name in the map header: click it for the list. The active one is highlighted. Custom layers: **+ Add custom layer…**, then ✎ / × to edit or remove. See [map layers](map-layers.md) |
| Terrain, buildings and camera | Sliders button, right of the map bar. One panel: **Terrain** (3D terrain, height 1–3×, hillshade), **Buildings** (OpenStreetMap buildings as 3D blocks from zoom 13, with opacity) and **Camera** (field of view with its full-frame focal length, max tilt, min and max zoom, **North up**, **Top down**). **Reset** puts all sliders back to their defaults; double-click a slider to reset just that one |
| Jump to coordinates | Paste into the search box in the map bar (or `Ctrl+V` anywhere). See [coordinate search](#coordinate-search) |
| Measure a distance | Ruler button next to the compass, `M`, or right-click → **Measure distance from here**. Click two points for the straight-line ground distance; a third click starts over, `Esc` clears. Not saved or exported |
| Pins | Click a row in the pin list at the top-left of the map to go back to it; × or **Clear all** removes |
| Copy a spot / open it elsewhere | Right-click the map: copy coordinates, measure from there, or open the spot in Google Maps, Street View, Google Earth or OpenStreetMap. **Open in…** adds Apple Maps, Lookmap, Bing Maps, Mapillary, Yandex Maps and Baidu Maps. Nothing is requested from any of them until you click |
| Share or bookmark a view | Copy the URL. See [map view in the URL](#map-view-in-the-url) |

### Street-level imagery

Open it with the panorama button in the map bar, or right-click the map → **Street-level imagery here**. A panel opens above the map without moving it.

- **Source:** **Panoramax** (no key needed) or **Mapillary** (paste your own free client token).
- **Pick a spot:** on the coverage overlay, with **Map centre** (looks up the middle of the map), or with right-click. The nearest photo is shown and the map moves to where it was taken. The yellow marker on the map is the photo's position and view direction.
- **Move around:** click in the photo to walk towards that side, or use the arrow keys (up and down walk along the view, left and right step sideways).
- **360° photos:** drag to look around, the mouse wheel zooms. **HD** loads the full resolution.
- **Coverage** (Panoramax): draws on the map where photos exist, lines along the sequences (solid for 360°, dashed for ordinary photos) and, zoomed in close, a dot per photo. Click a line or dot to load the photo there.
- Drag the divider under the panel to resize it.

## Keyboard shortcuts

There are two key layouts, switched with **Photo | Map** in the help card (`?` button, or the help key). The choice is kept in this browser.

- **Photo** (default): the left hand works the photo, the mouse the map.
- **Map**: `W` `A` `S` `D` move the map and `Q` / `E` turn it while held, like in a game; the photo tools move to other keys.

Keys are physical positions, so on a French (AZERTY) or German (QWERTZ) keyboard they sit in the same place as on a US one; in Chrome and Edge the help card shows your keyboard's letters.

| Action | Photo | Map |
|---|---|---|
| New line | `E` | `R` |
| Delete active line | `R` | — (use `Del`) |
| Map the next unmapped point | `F` | `G` |
| Toggle level tool / reset rotation | `W` | `L` |
| Toggle help card | `X` | `H` |
| Move the map (held) | — | `W` `A` `S` `D` |
| Turn the map (held) | — | `Q` / `E` |
| Look straight down | — | `T` |
| Reset map to north and flat | `N` | `N` |
| Measure a distance on the map (again or `Esc` to clear) | `M` | `M` |

The same in both layouts:

| Key | Action |
|---|---|
| `Del` / `Backspace` | Delete the selected point, or the active line if no point is selected |
| `1` – `5` | Jump to line 1–5 (number row or keypad) |
| `Esc` | Cancel / deselect |
| `F2` | Rename the active image |
| `Ctrl+Z` | Undo a line or point edit; `Ctrl+Shift+Z` or `Ctrl+Y` redoes |
| `Ctrl+S` | Export all sessions (with photos if **Include photos** is on) |
| `Ctrl+V` | Paste a photo → new image; paste coordinates → pin on map |
| Drag empty photo, or Space + drag | Pan the photo |

## Loading photos

Drop an image onto the left panel, paste one with `Ctrl+V`, or click **Browse**. To work on several images at once, open the **☰** image menu and click **+ Add image**, or click **+** after the image tabs.

A pasted photo opens as `pasted_image_01`, `pasted_image_02`, … and has no EXIF data, because the clipboard hands over pixels only. Drop the file instead if you need its GPS or camera data.

## Coordinate search

Paste coordinates into the search box in the bar under the map header, or press `Ctrl+V` anywhere outside a text field. Each location gets a numbered pin and a row in the pin list at the top-left of the map, which brightens on hover. The map keeps your zoom if you are already at town level or closer, otherwise it flies to zoom 14.

### Accepted formats

| Format | Example |
|---|---|
| Decimal, comma | `52.401234, 13.064567` |
| Decimal, space | `52.401234 13.064567` |
| Negative values (S / W) | `-33.8568, 151.2153` |
| Decimal with hemisphere | `52.4012° N, 13.0645° E` |
| Hemisphere letter first | `N 52.4012 E 13.0645` |
| Degrees, minutes, seconds | `52°24'04.4"N 13°03'52.4"E` |
| Degrees, decimal minutes | `52°24.073'N 13°03.874'E` |
| Longitude first | `13.0645° E, 52.4012° N`, or `151.2153, -33.8568` |
| Labelled | `lat 52.4012 lon 13.0645` |
| Google Maps link (map view) | `https://www.google.com/maps/@52.4012,13.0645,15z` |
| Google Maps link (query) | `https://maps.google.com/?q=52.4012,13.0645` |
| Google Earth link | `https://earth.google.com/web/@52.4012,13.0645,35a,1000d,35y,0h,0t,0r` |
| Apple Maps link | `https://maps.apple.com/?ll=52.4012,13.0645` |
| Bing Maps link | `https://www.bing.com/maps?cp=52.4012~13.0645&lvl=15` |
| Yandex Maps link (longitude first) | `https://yandex.com/maps/?ll=13.0645,52.4012&z=15` |
| OpenStreetMap link | `https://www.openstreetmap.org/#map=15/52.4012/13.0645` |
| Lookmap link | `https://lookmap.skzk.dev/#c=15/52.4012/13.0645` |
| Baidu Maps link (approximate) | `https://map.baidu.com/@12959219,4825334,15z` |
| Any link with `lat=` and `lon=` or `lng=` | `https://example.com/?lat=52.4012&lon=13.0645` |
| Web Mercator metres (x, y) | `1454336, 6872995` |

The first number is read as latitude, unless N/S/E/W letters or a value above 90 say otherwise.

A link's zoom level is ignored: a pasted link drops a pin like any other paste. Short links such as `maps.app.goo.gl/…` contain no coordinates and cannot be read without asking their server, so TracePoint asks you to open them and copy the full address. Baidu uses its own shifted coordinate system; its links are converted in the browser and land within some metres.

## Map view in the URL

The address bar follows the map: `#lat,lon,zoom`, plus `,bearing,pitch` when the map is rotated or tilted, e.g. `#45.94060,7.71737,15.00`. Copy the URL to come back to the same view or to send it to someone; it holds the view only, never your lines, points or image.
