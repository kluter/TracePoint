# Security & Privacy

A polished interface is not the same as a safe one. This page explains exactly what TracePoint does and does not do with your data, so investigators can make an informed decision before using it on sensitive material.

## Images never leave your machine

Photos are loaded directly into an HTML5 `<canvas>` element and processed in the browser. No upload, no base64 POST, no fetch call carries image data anywhere. To verify, open **DevTools → Network** (`F12`) and load an image: no request involving it appears.

The only outbound requests are map tile fetches from public servers (Esri, OpenStreetMap, EOX), elevation tiles from AWS while 3D terrain or hillshade is switched on, building shapes from OpenFreeMap while 3D buildings is switched on, plus the servers of any [custom map layer](map-layers.md#custom-map-layers) you add yourself. They contain no session data, no coordinates from your work, and no image content.

Street-level imagery is the one feature that sends a position on purpose: while its panel is open, Panoramax or Mapillary (whichever you picked) receives a small box around the spot you look up, and serves the photo. The panel is closed on every start, and nothing is sent until you open it. Your own photo is never part of it.

```javascript
// The full extent of network activity in TracePoint:
// GET https://server.arcgisonline.com/ArcGIS/rest/services/.../tile/z/y/x
// GET https://tile.openstreetmap.org/z/x/y.png
// GET https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/z/y/x.jpg
// GET <your custom layer URL>   ← only if you add one and select it
// GET https://s3.amazonaws.com/elevation-tiles-prod/terrarium/z/x/y.png   ← only while 3D terrain or hillshade is on
// GET https://tiles.openfreemap.org/planet/...                          ← only while 3D buildings is on
// GET https://api.panoramax.xyz/api/search?bbox=... + the photo it names ← only while the street-level panel is open (Panoramax)
// GET https://api.panoramax.xyz/api/map/z/x/y.mvt                         ← coverage overlay, only while the panel is open with Coverage on
// GET https://graph.mapillary.com/images?bbox=... + the photo it names   ← only while the street-level panel is open (Mapillary, your token)
// No other requests.
```

## What stays in the browser

- **Pasted coordinates and photos.** TracePoint never reads your clipboard on its own. Text or an image arrives only when you paste. Text is parsed in the browser, and no geocoder or lookup service is contacted. Pins live in memory and disappear with the tab. A pasted photo is handled like a dropped one: it stays in the browser and is covered by autosave.
- **The URL hash.** Browsers never send the part after `#` to the server, so whoever hosts your copy does not see which places you look at. It holds the map view only.
- **The right-click menu.** It only builds ordinary links. Nothing is contacted until you click one, and a link carries the clicked coordinate and zoom, never your image or session.

## Autosave keeps your work in this browser

So that a refresh does not lose work, TracePoint saves the open sessions and their images in this browser's `IndexedDB`. Nothing is uploaded and nothing is synced: the saved copy exists only in this browser profile on this machine. Anyone who can use that profile can open TracePoint and see it.

- **It survives** closing the tab, restarting the browser and a hard reload (`Ctrl+F5`, `Ctrl+Shift+R`). A hard reload only skips the cache.
- **Clear** in the ☰ menu of the photo side deletes the saved copy and empties the workspace.
- **Autosave off** in the same menu deletes the saved copy at once and stores nothing from then on. Use this for sensitive material; closing the tab then leaves no trace of the investigation.
- A private window works as usual; the browser deletes the saved copy when that window closes.
- With TracePoint open in two tabs, only the first one saves. The second restores the saved work, but its own changes are not saved until the first tab is closed, and **Clear** works only in the first. Switching autosave off in either tab deletes the saved copy and stops both from saving.

Photo adjustments and coordinate pins are not saved. Besides that, `localStorage` holds a few settings. `sessionStorage` and cookies are unused.

```javascript
// Verify in DevTools → Application → Storage
// localStorage:   { "tp-tileset": "esri-sat" }  ← your map layer choice
//                 { "tp-terrain": "0" }         ← 3D terrain on/off
//                 { "tp-map-settings": {...} }  ← terrain height, hillshade, 3D buildings, field of view, camera limits
//                 { "tp-custom-layers": [...] } ← name + URL of custom layers, if you added any
//                 { "tp-autosave": "1" }        ← autosave on/off
//                 { "tp-split": "50.00" }       ← width of the photo side in percent
//                 { "tp-keys": "photo" }        ← key layout, Photo or Map
//                 { "tp-export-photos": "1" }   ← "Include photos" on/off
//                 { "tp-street-source": "…" }   ← Panoramax or Mapillary
//                 { "tp-street-token": "…" }    ← your Mapillary token, if you entered one (never exported)
//                 { "tp-street-cover": "1" }    ← coverage overlay on/off
//                 { "tp-street-split": "45.00" } ← height of the street-level panel in percent
// IndexedDB:      tracepoint → autosave         ← "session" (same JSON as the export) + one "img:…" per image
//                                                 empty while autosave is off
// sessionStorage: empty
// Cookies:        none set by TracePoint
```

## Session import cannot run code

Importing a session file does not execute anything. Lines, points, map views and colours are type-checked on the way in and unknown keys are discarded. The image metadata block is kept as it is, as plain data, and like every other string it is escaped before display. An embedded photo is used only if the browser can decode it as an image. There is no `eval()` and no raw HTML injection. The worst a manipulated file can do is fail to import.

## The code is fully auditable

TracePoint is vanilla HTML, CSS, and JavaScript with no build step and no obfuscation. Its own logic lives in `js/script.js`, unminified. What you read in the repo is what runs in your browser.

The two libraries, [MapLibre GL JS](https://maplibre.org/) (map rendering) and [exifr](https://github.com/MikeKovarik/exifr) (EXIF parsing, local only), are their standard minified builds, bundled in `js/` and `css/` and pinned to a known version. Nothing is loaded from a CDN, so no third-party host can swap the code that runs in your browser. To verify a bundled copy, compare it with the official release of the same version.

This tool was developed with AI assistance. That is disclosed here precisely because the [risks of opaque, AI-generated OSINT tools](https://www.dutchosintguy.com/post/vibe-coding-is-becoming-an-osint-risk) are real. The answer is not to hide the involvement. It is to make the code readable so anyone can verify what it does.

## Security caveats

- **Map tiles reveal your target location.** Tile requests follow the format `tile/z/x/y`. The coordinates directly encode the area of the map you are viewing. A tile server operator can infer what location you are investigating. Use a VPN or TOR if that is a concern.
- **Custom layers add another party.** A custom layer's server sees the same tile coordinates. If its URL carries an API key or token, that key is also tied to every request, and it is stored in plain text in your browser.
- **Browser and OS trust.** If your browser or operating system is compromised, no web application can protect you. TracePoint is only as secure as the environment it runs in.
- **Files and saved work are unencrypted.** Exported JSON, KML and GeoJSON files and the autosaved copy in the browser are plaintext; the KML and GeoJSON hold the image names and every point placed on the map. Treat them with the same care as any other sensitive investigation material.
