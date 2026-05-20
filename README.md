<h1><img src="assets/logo.png" alt="TracePoint Logo" width="26" height="26" style="vertical-align:middle; margin-right:8px;"> TracePoint</h1>

**Locate the origin point of a photograph using geometric ray intersection.**

`TracePoint` is a browser-based geolocation tool built for OSINT investigators, journalists, and researchers who already know how to geolocate images, and want a dedicated instrument to do it faster and more precisely. No uploads. No server. Everything runs locally in your browser.

**[Try it live → kluter.github.io/TracePoint](https://kluter.github.io/TracePoint/)**

![TracePoint Demo](assets/TracePoint_Demo.gif)

---

## The Method

Draw a vertical line across a photograph and it passes through objects at different depths: foreground, midground, horizon. Each of those objects can be found on a map, and together they define a geographic bearing: a **ray**.

Repeat for a second line and you get a second ray. **Where the rays cross is where the photographer was standing.**

The more lines you add, the more rays are generated and the more robustly the intersection is averaged. This is a photographic application of the surveying technique known as **[Resection by Intersection](https://en.wikipedia.org/wiki/Position_resection_and_intersection)**, the same principle used to triangulate a position from known landmarks. `TracePoint` turns that manual, tab-switching workflow into a single focused tool.

---

## Features

- Split-panel interface: photo left, satellite map right
- Drop any image to load it, or click **Browse**
- **Multi-image session manager:** all sessions visible on the map simultaneously, each with its own intersection result
- **Bearing display:** each line shows its outward bearing once an intersection is found
- **Confidence ellipse:** with 3 or more lines (up to 5 per image), a dashed ellipse around the intersection visualises the spread of ray crossings. A tighter ellipse means higher confidence. Computed via [covariance matrix eigendecomposition](https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors)
- **Session export and import:** save and restore lines, geo points, bearings, and map view as JSON
- **EXIF metadata viewer:** camera, lens, capture settings, GPS, altitude, and camera direction read from the image. GPS can be placed on the map as a reference marker
- Built-in Potsdam demo with step-by-step guide
- Horizon correction for tilted images
- Map layer switcher: Esri Satellite, OpenStreetMap, OSM Humanitarian, Esri Topo, Esri Streets
- Full keyboard shortcut support
- Fully client-side: no server, no uploads, no tracking

---

## How to Use

> Start with the **☰** menu on the image panel and select **Demo — Potsdam** for a guided walkthrough. If the photo is tilted, use the **Level** button first to compensate before adding lines.

1. **Load a photo:** Drop an image onto the left panel, or click **Browse**. To work on multiple images at once, open the **☰** image menu and click **+ Add image**.
2. **Add a line:** Click **+ New Line** (or press `E`) and drag it over a recognisable object you can also find on the map: a building corner, tower, road junction.
3. **Mark points:** Switch to **Add Point** mode (or press `Tab`) and click on the line twice to place exactly two reference points.
4. **Place points on the map:** Click the **🌐 P1** pill next to each point (or press `F` to jump straight to the next unmapped point), then click its real-world location on the map.
5. **Read the result:** Once two lines each have two geo points, rays appear and the intersection is calculated. The pulsing yellow marker shows the estimated camera origin. With 3 or more lines, a confidence ellipse appears around the intersection: the tighter the ellipse, the more consistent your bearings.
6. **Add more images:** Use the **☰** image menu to add further sessions. Each session shows its own rays and intersection on the map simultaneously.
7. **Save your work:** Click the **↓** button on any session row to export it as JSON, or use **↓ Export all sessions** to save everything at once. To restore, click **↑ Import session** and reload the image when prompted.

> **Tips:** Use objects spread across different depths for a more accurate bearing. Press `Esc` to deselect or cancel at any time. Press `X` to toggle the help card from anywhere on the page.

![TracePoint Result](assets/Potsdam_Result.jpg)

---

## Reading the Confidence Ellipse

When three or more lines are used, a dashed ellipse appears around the estimated camera position. Its size and shape tell you how much to trust the result.

| Ellipse shape | Meaning | Confidence |
|-------|---------|------------|
| Small and round | Rays converge tightly from all directions | High |
| Small and elongated | Good estimate, but uncertain along one axis. Two lines may be nearly parallel | Moderate |
| Large and round | General spread in all directions, recheck geo points or add more lines | Low |
| Large and elongated | One bearing is likely off, or two lines run too close to parallel | Low |

The ideal result is a small, round ellipse. If you see a large or elongated one, adding a line at a different angle usually improves it significantly.

---

## Controls

### Mouse & UI

| Action | How |
|---|---|
| Zoom image | Scroll wheel |
| Pan image | Space + drag, or middle-click drag |
| Level image | Level button, then click two points on a horizontal reference |
| Reset level | Click Level button again when correction is active |
| Add a line | + New Line button |
| Drag a line | Click and drag the line |
| Deselect / cancel | Click blank canvas, or `Esc` |
| Add a point | Add Point mode, click on the line |
| Place point on map | Click the map pill, then click the map |
| Delete a line or point | × button in the line bar |
| Switch map layer | ☰ button, top-right of map panel |
| Manage image sessions | ☰ button, right of line bar |
| Browse for image | Click the drop zone |
| Export session | ↓ button on session row in ☰ menu |
| Export all sessions | ↓ Export all sessions in ☰ menu |
| Import session | ↑ Import session in ☰ menu |
| Open help guide | ? button, top-right of map panel |
| View image metadata | `</>` button, left of line bar |
| Place EXIF GPS on map | Show on map inside the metadata card |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `E` | New line |
| `R` | Delete active line |
| `F` | Map next unmapped point of active line |
| `W` | Toggle level tool / reset rotation |
| `X` | Toggle help card |
| `Tab` | Toggle Drag Line / Add Point mode |
| `1` – `5` | Jump to line 1–5 |
| `Esc` | Cancel / deselect |

---

## Technical Notes

Rays are computed from the bearing between two geo-referenced points. Intersection uses flat-plane geometry on lat/lon coordinates. Accurate to within a few metres for scenes under ~10 km, which covers virtually all real-world photography. Each ray extends 50 km in both directions, long enough to contain any realistic intersection while keeping the map readable.

When three or more lines are used, every pair of rays produces a crossing point. Those crossings form a small cloud around the estimated origin. The confidence ellipse is fitted to that cloud using [eigenvalue decomposition](https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors). The ellipse stretches in the direction the crossings are most scattered and stays narrow where they agree. A tight ellipse means the lines converge cleanly; a wide one means at least one bearing is off.

No data leaves your machine. Map imagery is served by public tile servers (Esri, OpenStreetMap). Dependencies are [Leaflet](https://leafletjs.com/) for maps and [exifr](https://github.com/MikeKovarik/exifr) by MikeKovarik for metadata parsing. Everything else is vanilla HTML, CSS, and JavaScript.

---

## Running Locally

```bash
npx serve .
# or
python3 -m http.server
```

---

## Changelog

| Version | Changes |
|---------|---------|
| v1.6.1 | EXIF GPS popup restyled. Copy button added to GPS. EXIF ray fixed after session import. |
| v1.6.0 | EXIF direction ray: ray from GPS position and camera bearing. Copy coordinates button. |
| v1.5.0 | Keyboard shortcuts, confidence ellipse for 3+ lines, 5-line maximum per image. |

<details>
<summary>Older releases</summary>

| Version | Changes |
|---------|---------|
| v1.4.3 | Line bar redesign: lines and points move to a dedicated bar below the toolbar. |
| v1.4.2 | UX bug fixes: orphaned map rays, map-point mode not clearing, auto-zoom false trigger. |
| v1.4.1 | Security hardening, JSON import validation, toast notification system. |
| v1.4.0 | EXIF metadata viewer with GPS map marker. |
| v1.3.0 | Session export / import, browse button, bearing display. |
| v1.2.1 | Session naming, colour and map view fixes. |
| v1.2.0 | Multi-image session manager. |
| v1.1.0 | Horizon correction tool. |
| v1.0.0 | Initial release. |

</details>

---

## License

See `LICENSE`.
