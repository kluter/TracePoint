<h1><img src="assets/logo.svg" alt="TracePoint Logo" width="26" height="26" style="vertical-align:middle; margin-right:8px;"> TracePoint</h1>

**Locate the origin point of a photograph using geometric ray intersection.**

`TracePoint` is a browser-based geolocation tool built for OSINT investigators, journalists, and researchers who already know how to geolocate images, and want a dedicated instrument to do it faster and more precisely. No uploads. No server. Everything runs locally in your browser.

**[Try it live → kluter.github.io/TracePoint](https://kluter.github.io/TracePoint/)**

![TracePoint Demo](assets/TracePoint_Demo.gif)

---

## The Method

Draw a vertical line across a photograph and it passes through objects at different depths: foreground, midground, horizon. Each of those objects can be found on a map, and together they define a geographic bearing: a **ray**.

Repeat for a second line and you get a second ray. **Where the rays cross is where the photographer was standing.**

The more lines you add, the more rays are generated and the more robustly the intersection is averaged. This is a photographic application of the surveying technique known as **[Resection by Intersection](https://en.wikipedia.org/wiki/Position_resection_and_intersection)**, the same principle used to triangulate a position from known landmarks.

---

## Features

- **Camera position with a confidence measure:** rays from up to 5 lines per photo intersect on the map, and a [confidence ellipse](#reading-the-confidence-ellipse) shows how far to trust the result
- **Several photos of one scene:** each photo gets its own rays and intersection, all shown on the map together
- **Check against reality:** 3D terrain and buildings with the camera's field of view matched to the photo's lens, street-level imagery from Panoramax or Mapillary, and the GPS position from the photo's metadata
- **Paste any coordinates:** decimal, degrees-minutes-seconds, or a link from Google Maps, Apple Maps, Bing, OpenStreetMap and [more](docs/controls.md#accepted-formats) drops a pin
- **Any basemap:** satellite, Sentinel-2, topographic and street maps built in, plus [custom XYZ layers](docs/map-layers.md) such as dated historical imagery from Esri Wayback
- **Local only:** no server, no uploads, no tracking. Work is autosaved in your browser and can be exported to a file, photos included, or as [KML and GeoJSON](docs/export.md) for Google Earth and GIS

---

## How to Use

> New here? Open the **☰** menu on the photo side and pick **Potsdam, Germany** under Demo for a guided walkthrough.

1. **Load a photo:** drop it onto the left panel, paste it with `Ctrl+V`, or click **Browse**. If it is tilted, straighten it first with the level tool (`W`).
2. **Add a line** (`E`) and drag it over something you can also find on the map: a building corner, tower, road junction.
3. **Mark two points** on the line by clicking it twice, then click where each of them is on the map.
4. **Repeat with a second line.** The rays appear and the pulsing yellow marker shows the estimated camera position. A third line adds the confidence ellipse.
5. **Save your work** from the **☰** menu, or with `Ctrl+S`.

> **Tip:** use objects at different depths for a more accurate bearing, and lines spread across the photo for a better intersection.

![TracePoint Result](assets/Potsdam_Result.jpg)

---

## Controls

Two key layouts, switched with **Photo | Map** in the help card. **Photo** (default) keeps the left hand on the photo tools; **Map** moves the map with `W` `A` `S` `D` and turns it with `Q` / `E` while held. The table shows Photo; Map is in [docs/controls.md](docs/controls.md#keyboard-shortcuts).

| Key | Action |
|---|---|
| `E` / `R` | New line / delete active line |
| `F` | Place the next unmapped point on the map |
| `W` | Level tool / reset rotation |
| `1` – `5` | Jump to line 1–5 |
| `Del` | Delete the selected point, or the active line |
| `Esc` | Cancel / deselect |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Export all images |
| `Ctrl+V` | Paste a photo or coordinates |
| `M` | Measure a distance on the map |
| `N` | Reset the map to north |
| `X` | Toggle the help card |
| Drag (empty photo) | Pan the photo |
| Ctrl + drag | Rotate and tilt the map |

Every mouse and menu control, street-level imagery, and the accepted coordinate formats are listed in **[docs/controls.md](docs/controls.md)**.

---

## Reading the Confidence Ellipse

When three or more lines are used, a dashed ellipse appears around the estimated camera position. Its size and shape tell you how much to trust the result.

| Ellipse shape | Meaning | Confidence |
|-------|---------|------------|
| Small and round | Rays converge tightly from all directions | High |
| Small and elongated | Good estimate, but uncertain along one axis. Two lines may be nearly parallel | Moderate |
| Large and round | General spread in all directions, recheck geo points or add more lines | Low |
| Large and elongated | One bearing is likely off, or two lines run too close to parallel | Low |

![Ellipse comparison](assets/ellipse_comparison.png)
The ideal result is a small, round ellipse. If you see a large or elongated one, adding a line at a different angle usually improves it significantly.

How it is computed: every pair of rays produces a crossing point, and those crossings form a small cloud around the estimated origin. The ellipse is fitted to that cloud using [Eigendecomposition](https://en.wikipedia.org/wiki/Eigendecomposition_of_a_matrix). It stretches in the direction the crossings are most scattered and stays narrow where they agree.

---

## Limitations

Intersection uses flat-plane geometry on lat/lon coordinates, with each ray extending 50 km. For most photography this is accurate to within a few metres, as long as the furthest reference landmark is within roughly 10 km of the camera. Accuracy degrades with:

- **Steep mountainous terrain:** landmarks far above or below the camera shift the apparent bearing.
- **Aerial photography:** shooting downward from a plane or drone has the same effect.
- **Very long rays:** reference points more than 20 to 30 km apart, where the curvature of the Earth starts to matter.
- **Heavily distorted lenses:** fisheye or extreme wide-angle lenses bend straight lines.

---

## Security & Privacy

- **Your photos never leave your machine.** They are processed in the browser; no request carries image data. Check it yourself in DevTools → Network.
- **The only requests are for map data:** tiles, elevation and buildings from public servers, plus any custom layer you add. They contain no image and no session data, but tile coordinates do reveal which area you are looking at. Use a VPN or Tor if that matters.
- **Street-level imagery** is the one feature that sends a position on purpose, and only while its panel is open.
- **Autosave** keeps your work in this browser only. Switch it off in the ☰ menu for sensitive material. Saved work and exported files are not encrypted.
- **Imported files cannot run code**, and the code is plain, unminified JavaScript with two pinned, bundled libraries ([MapLibre GL JS](https://maplibre.org/), [exifr](https://github.com/MikeKovarik/exifr)). Nothing is loaded from a CDN.

This tool was developed with AI assistance. That is disclosed here because the [risks of opaque, AI-generated OSINT tools](https://www.dutchosintguy.com/post/vibe-coding-is-becoming-an-osint-risk) are real; the answer is readable code anyone can verify.

Every request, every stored value and all caveats are listed in **[docs/privacy.md](docs/privacy.md)**.

---

## Running Locally

```bash
npx serve .
# or
python3 -m http.server
```

---

## Changelog

Current version: **v2.11.1**. All releases are listed in [CHANGELOG.md](CHANGELOG.md).

---

## Recognition

### Curated Lists

| List | Section |
|---|---|
| [jivoi/awesome-osint](https://github.com/jivoi/awesome-osint) | Image Analysis |
| [Astrosp/Awesome-OSINT-List](https://github.com/Astrosp/Awesome-OSINT-List) | GEO |
| [The-Osint-Toolbox/Geolocation-OSINT](https://github.com/The-Osint-Toolbox/Geolocation-OSINT) | Geolocation |

### Press

| Publication | Publisher |
|---|---|
| [TracePoint: A Browser-Based Tool for Image Geolocation by Ray Intersection](https://remote-sensing.org/tracepoint-a-browser-based-tool-for-image-geolocation-by-ray-intersection/) | Earth Observation Research Cluster, University of Würzburg |

---

## Related

<img src="assets/logo_shadowfinder.svg" alt="" width="14" height="14" style="vertical-align:middle;"> **[ShadowFinder Web](https://github.com/kluter/ShadowFinder-Web)** - Geolocate a photo by the length of a shadow.

<img src="assets/logo_siliconaperture.svg" alt="" width="14" height="14" style="vertical-align:middle;"> **[SiliconAperture](https://github.com/kluter/SiliconAperture)** - Measure the real-world size of an object from a single photograph.
