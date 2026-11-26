# Map Layers

## Built-in layers

The basemap list is grouped: **Imagery** (Esri Satellite, Sentinel-2 2024), **Historical** (Esri Wayback), **Maps** (OpenStreetMap, Esri Streets, Esri Topo, Esri Dark Gray) and, once you add some, **Custom**. Optional 3D terrain with adjustable height and hillshade, and OpenStreetMap buildings as 3D blocks, are switched on in the sliders panel right of the map bar; there you also pick the elevation tiles, AWS Terrarium (even detail everywhere) or Mapterhorn (newer data, finer in parts of Europe). Click the basemap name in the map header to switch layers. **Distant detail** at the bottom of that list keeps the imagery sharp toward the horizon of a tilted map; it loads more tiles, so it is off by default.

### Esri Wayback

Esri has kept every version of its World Imagery basemap since 2014, about 200 of them. Pick **Esri Wayback** as the basemap and a timeline appears at the top of the map, showing the imagery that existed for the place in the middle of the map:

- **One mark per capture.** Only versions whose imagery differs at the map centre are listed, at the detail of the current zoom. Releases that repeat the same picture are skipped, so every step shows something new.
- **Dated by capture.** Marks sit on a time axis by the date the imagery was taken, from Esri's metadata, not by when Esri published it. Hover the date for the provider and resolution. Coarse mosaics seen when zoomed out often have no date and show as "Undated imagery".
- **Drag or click** along the timeline, or use ‹ › and the arrow keys, to step to the next older or newer capture.
- **Zoom in** to about town level for the timeline. Further out the imagery is a mosaic of many dates.
- **Updates on move.** After each pan or zoom the list is looked up again for the new spot. That takes a few seconds; the marks fill in as they arrive.

Where an old capture does not reach the current zoom, its last tile is enlarged instead of leaving a gap. Wayback always opens on the newest imagery, after a reload and every time you pick it; the date you looked at is not remembered, neither in the browser nor in sessions.

## Custom map layers

Besides the built-in layers you can add any tile server that uses the standard XYZ URL format, the same format QGIS uses for its "XYZ Tiles" connections. Click the basemap name in the map header, then **+ Add custom layer…**, give it a name and paste the URL template. The template must start with `https://` and contain `{x}`, `{y}` and `{z}`:

```
https://example.com/tiles/{z}/{x}/{y}.png
```

You can add as many layers as you like and switch between them like the built-in ones. They are saved in your browser's `localStorage` only. They are not shared between browsers or devices, and they are not included in exported session files.

Providers whose tiles use a different numbering scheme, such as Bing (quadkeys), cannot be added this way.

A custom layer's tiles are requested from the server in its URL. See [Security & Privacy](privacy.md#security-caveats) for what that means.

## Useful tile URLs

Copy a URL into the **Tile URL** field as-is. Every server has its own terms of use. Which servers you add, and whether you are allowed to use them, is up to you.

### Google (at your own risk)

Google does not permit direct tile access outside its official APIs. These URLs are widely used in [QGIS tutorials](https://mapscaping.com/google-satellite-imagery-and-google-maps-in-qgis/), but using them may break Google's terms and can stop working at any time:

| Layer | URL |
|---|---|
| Google Satellite | `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` |
| Google Hybrid | `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}` |
| Google Roadmap | `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}` |
| Google Terrain | `https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}` |

### Imagery

| Layer | URL | Notes |
|---|---|---|
| Esri Clarity | `https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Esri's sharper imagery set. Sometimes shows a different capture than the built-in Esri Satellite |
| Esri Wayback | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/RELEASE/{z}/{y}/{x}` | One fixed release of Esri's historical imagery. Replace `RELEASE` with a release number (see below) |

### Esri Wayback releases

Esri Wayback is also a built-in basemap with a timeline (see [Built-in layers](#esri-wayback)), which is usually easier. A custom layer is only needed to keep one release fixed next to the built-in one. Each release has a number that goes into the URL in place of `RELEASE`; all ~200 are listed in Esri's [Wayback config](https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json), where the number after `tile/` in an entry's `itemURL` is the release.
