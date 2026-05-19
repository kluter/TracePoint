<h1><img src="assets/logo.png" alt="TracePoint Logo" width="26" height="26" style="vertical-align:middle; margin-right:8px;"> TracePoint</h1>

**Locate the origin point of a photograph using geometric ray intersection.**

`TracePoint` is a browser-based geolocation tool built for OSINT investigators, journalists, and researchers who already know how to geolocate images, and want a dedicated instrument to do it faster and more precisely. No uploads. No server. Everything runs locally in your browser.

**[Try it live → kluter.github.io/TracePoint](https://kluter.github.io/TracePoint/)**

![TracePoint Demo](assets/TracePoint_Demo.gif)

---

## The Method

Draw a vertical line across a photograph and it passes through objects at different depths - foreground, midground, horizon. Each of those objects can be found on a map, and together they define a geographic bearing: a **ray**.

Repeat for a second line and you get a second ray. **Where the rays cross is where the photographer was standing.**

The more lines you add, the more rays are generated and the more robustly the intersection is averaged. This is a photographic application of the surveying technique known as **[Resection by Intersection](https://en.wikipedia.org/wiki/Position_resection_and_intersection)** — the same principle used to triangulate a position from known landmarks. `TracePoint` turns that manual, tab-switching workflow into a single focused tool.

---

## Features

- Split-panel interface: photo left, satellite map right
- Drop any image to load it, or click **Browse**
- **Multi-image session manager:** all sessions visible on the map simultaneously, each with its own intersection result
- **Bearing display:** each line shows its outward bearing once an intersection is found
- **Session export and import:** save and restore lines, geo points, bearing and map view as JSON
- **EXIF metadata viewer:** camera, lens, capture settings, GPS, altitude and camera direction read from the image. GPS can be placed on the map as a reference marker
- Built-in Potsdam demo with step-by-step guide
- Horizon correction for tilted images
- Map layer switcher: Esri Satellite, OpenStreetMap, OSM Humanitarian, Esri Topo, Esri Streets
- Fully client-side: no server, no uploads, no tracking

---

## How to Use

> Start with the **☰** menu on the image panel and select **Demo — Potsdam** for a guided walkthrough. If the photo is tilted, use the **Level** button first to compensate before adding lines.

1. **Load a photo:** Drop an image onto the left panel, or click **Browse**. To work on multiple images at once, open the **☰** image menu and click **+ Add image**.
2. **Add a line:** Click **+ New Line** and drag it over a recognisable object you can also find on the map: a building corner, tower, road junction.
3. **Mark points:** Switch to **Add Point** mode and click on the line twice to place exactly two reference points.
4. **Place points on the map:** Click the **🌐 P1** pill next to each point, then click its location on the map. The tool advances automatically.
5. **Read the result:** Once two lines each have two geo points, rays appear and the intersection is calculated. The pulsing yellow marker shows the estimated origin.
6. **Add more images:** Use the **☰** image menu to add further sessions. Each session shows its own rays and intersection on the map simultaneously.
7. **Save your work:** Click the **↓** button on any session row to export it as JSON, or use **↓ Export all sessions** to save everything at once. To restore, click **↑ Import session** and reload the image when prompted.

> **Tips:** Use objects spread across different depths for a more accurate bearing. Three or more lines significantly improve accuracy when the first two rays are nearly parallel. Press **ESC** to deselect or cancel at any time.

![TracePoint Result](assets/Potsdam_Result.jpg)

---

## Controls

<details>
<summary>Click to expand the full controls reference</summary>

| Action | How |
|---|---|
| Zoom image | Scroll wheel |
| Pan image | Space + drag, or middle-click drag |
| Level image | Level button, then click two points on a horizontal reference |
| Reset level | Click Level button again when correction is active |
| Add a line | + New Line button |
| Drag a line | Click and drag the line |
| Deselect / cancel | Click blank canvas, or ESC |
| Add a point | Add Point mode, click on the line |
| Place point on map | Click the map pill, then click the map |
| Delete a line or point | × button in the toolbar |
| Switch map layer | ☰ button, top-right of map |
| Manage image sessions | ☰ button, top-right of image panel |
| Browse for image | Click the drop zone |
| Export session | ↓ button on session row in ☰ menu |
| Export all sessions | ↓ Export all sessions in ☰ menu |
| Import session | ↑ Import session in ☰ menu |
| Open help guide | ? button, top-right of map panel |
| View image metadata | `</>` button, top-left of image panel |
| Place EXIF GPS on map | Show on map button inside the metadata card |

</details>

---

## Technical Notes

Rays are computed from the bearing between two geo-referenced points. Intersection uses flat-plane geometry on lat/lon coordinates — accurate to within a few metres for scenes under ~10 km, which covers virtually all real-world photography. Each ray extends 50 km in both directions, long enough to contain any realistic intersection while keeping the map readable.

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

- **v1.4.1:** Security hardening, import validation, toast notifications.
- **v1.4.0:** EXIF metadata viewer with GPS map marker.
- **v1.3.0:** Session export / import, browse button, bearing display.
- **v1.2.1:** Session naming, colour and map view fixes.
- **v1.2.0:** Multi-image session manager.
- **v1.1.0:** Horizon correction tool.
- **v1.0.0:** Initial release.

---

## License

See `LICENSE`.
