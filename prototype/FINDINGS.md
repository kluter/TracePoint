# MapLibre prototype — findings (2026-11-11)

Standalone test page for issue #11. Open `prototype/maplibre.html` via a local server.
The app itself is untouched. MapLibre GL JS 5.24.1 from unpkg (vendoring comes with the real port, #17).

## Results

| # | Question | Result |
|---|----------|--------|
| 1 | Do the 6 built-in tile sets work? | **Yes.** Each Leaflet `TileLayer` becomes a raster source + raster layer. `maxNativeZoom` → source `maxzoom`, MapLibre overzooms past it on its own (z19 tiles upscale cleanly at z20). `{s}` subdomains → one URL per subdomain. `opacity` → `raster-opacity`. |
| 2 | Custom layers with missing tiles | **Fallback is needed, and it works.** MapLibre keeps parent tiles that are *already loaded* on screen when children 404, so zooming in gradually shows no holes. But a cold load (page refresh, restored session view, flyTo far away) at a zoom the source doesn't cover renders **black**. The lower-zoom fallback via `addProtocol` + canvas crop (same idea as `FallbackTileLayer`) fixes that: 42/42 tiles came from the parent level on a cold load, image intact. |
| 3 | Points, rays, intersection, ellipse | **Yes.** Rays/ellipse are one GeoJSON source updated with `setData`. Points are DOM markers; `draggable: true` gives #12 (map half) for free: dragging moves the point, updates the ray and intersection, and doesn't pan the map. |
| 4 | Rotation | **Yes.** Rays, ellipse and markers stay put while rotating. Plain right-click opens the menu; right-drag rotate does not (checked with a real mouse). **Feel:** MapLibre 5's default mouse rotation (`aroundCenter: true`) is a hybrid of angle-around-centre and horizontal-drag with a sign flip above centre, which wobbles when dragging slowly near the centre line. `aroundCenter: false` (documented map option, "linear" mode) gives plain horizontal-drag → bearing. Ctrl+drag and right-drag stay the MapLibre defaults; Shift+drag stays box zoom. |
| 5 | 3D terrain | **Yes, keyless.** AWS Terrarium DEM tiles (CORS ok). Click picking is terrain-aware: same pixel at 60° pitch gives a point 1.8 km away from the flat-map answer, at 3528 m elevation, so clicks land on the slope. |
| 6 | Zoom offset | **Confirmed: MapLibre zoom = Leaflet zoom − 1.** MapLibre z15 fetches exactly the z16 tiles Leaflet shows at z16. Saved `mapView.zoom` in session JSONs, hardcoded zooms (13/14/16) and `maxZoom: 21` all need −1 in the port. |

## Rotation tuning
- `aroundCenter: false` (see 4).
- `rotateDegreesPerPixelMoved`: default 0.8°/px felt too sensitive. Tried 0.64, 0.51, now 0.40 (half the default). The panel shows the loaded value.

## Console noise with custom layers
Esri Wayback answers missing tiles with a 404 **without** CORS headers, so the browser logs a CORS error for each one (Leaflet's `<img>` tiles never showed this). The fallback protocol treats it as a miss and goes up a level, so it's cosmetic, but a real port should expect a noisy console on sources like this.

## Checked beforehand
All current tile hosts send CORS headers (Esri, EOX, OSM, Google, Esri Wayback, AWS terrain). MapLibre needs them; Leaflet doesn't.

## Things to carry into the real port
- `[lng, lat]` everywhere (Leaflet is `[lat, lng]`).
- Zoom −1 on import of old session files.
- `hash: true` gives `#zoom/lat/lng/bearing/pitch` for free; #14 wants `#lat,lon,zoom`, so that one would be hand-rolled.
- Bearing and pitch belong in the saved view (sessions, auto-save #13, URL hash #14).
- Popups keep their HTML; CSS class names change from `leaflet-popup-*` to `maplibregl-popup-*`.
- Library size: ~800 KB vs ~150 KB. WebGL required.

## Not yet tested
- Right-drag rotate vs right-click menu with a real mouse (see 4).
- Mobile / touch rotation (two-finger).
- Performance with many sessions / layer groups.
