# TracePoint

**Locate the origin point of a photograph using geometric ray intersection.**

TracePoint is a browser-based tool that lets you geolocate where a photo was taken — without uploading anything. All processing happens locally in your browser.

---

## The Method

If you draw a vertical line across a photograph, that line passes through objects at different depths: something in the foreground, something in the midground, something on the horizon. Each of those objects can be found on a map and represents a point on a geographic bearing line — a *ray*.

When you repeat this for a second vertical line in the same photo, you get a second ray. **The point where the two rays cross is the location the photographer was standing.**

The more lines you add, the more rays are generated, and the more precisely the intersection can be averaged. The method is essentially a photographic application of the surveying technique known as *resection by intersection* — the same principle used when triangulating a position from known landmarks.

---

## Features

- **Split-panel interface** — photo on the left, satellite map on the right
- **Drop any image** directly onto the photo panel to load it
- **Vertical alignment lines** — add as many as you need, drag to position them
- **Point markers** — lock specific objects on each line to use as geo references
- **Zoom & pan the photo** — scroll to zoom, space+drag or middle-click to pan
- **Map geo-linking** — click the map to place the geographic location of each marked object
- **Automatic ray casting** — once two geo points are placed on a line, a ray is drawn extending 50 km in both directions
- **Intersection marker** — when two or more rays exist, their crossing point is calculated and shown on the map with a pulsing marker and lat/lng readout
- **Multiple ray averaging** — with three or more lines, all pairwise intersections are averaged for a more robust estimate
- **Map layer switcher** — choose from Esri Satellite, OpenStreetMap, OSM Humanitarian, Esri Topo, or Esri Streets via the ☰ menu
- **Fully client-side** — no server, no uploads, no tracking

---

## How to Use

### 1. Load a photo
Drop an image onto the left panel. It will fit to the panel automatically. Use scroll to zoom in, and space+drag or middle-click to pan around.

### 2. Add a line
Click **+ New Line**. A vertical line appears at the centre of the image. Drag it left or right until it passes through a recognisable object — a building edge, a tower, a road junction — that you can also find on a map.

### 3. Mark points on the line
Click **Mode: Drag Line** to toggle into **Add Point** mode. Click on the line at the height of each object you want to use as a reference. Each click places a point marker. You need at least two points per line.

### 4. Place the points on the map
Each point gets a 🗺 button in the toolbar. Click it, then click the corresponding location on the map. The tool advances through unplaced points automatically. Once a point is placed it shows a 📍 icon and can be repositioned at any time.

### 5. Read the result
As soon as two lines each have two geo points, rays appear on the map and the intersection is calculated. The yellow pulsing marker shows the estimated origin position. The popup displays the exact coordinates.

### Tips
- Use objects that are clearly identifiable on satellite imagery — building corners, road markings, distinct trees
- Objects spread across different distances along the line give a more accurate bearing than objects close together
- Three or more lines will significantly improve accuracy, especially if the first two rays are nearly parallel
- You can switch map layers at any time using the ☰ button in the top-right of the map panel; your choice is remembered between sessions
- Press **Escape** at any time to deselect the active line or cancel map-point placement

---

## Controls

| Action | How |
|---|---|
| Zoom image | Scroll wheel |
| Pan image | Space + drag, or middle-click drag |
| Add a line | + New Line button |
| Drag a line | Click and drag the line |
| Deselect / cancel | Click blank canvas, or Escape |
| Add a point | Switch to Add Point mode, click on the line |
| Place point on map | Click 🗺 next to the point, then click the map |
| Delete a line or point | × button next to it in the toolbar |
| Switch map layer | ☰ button, top-right of map |

---

## Technical Notes

**Coordinate maths.** Rays are computed using the bearing between two geo-referenced points on a line. Intersection is solved by treating latitude and longitude as a flat 2D plane. This is accurate to within a few metres for scenes spanning less than roughly 10 km, which covers virtually all real-world photography scenarios.

**Ray length.** Each ray is drawn 50 km in both directions from the first geo point. This is long enough to always contain the intersection for any realistic scene, while keeping the map readable.

**Privacy.** No data leaves your machine. The tool uses only your local browser and public tile servers (Esri, OpenStreetMap) for map imagery.

**Dependencies.** [Leaflet](https://leafletjs.com/) for the map. Everything else is vanilla HTML, CSS, and JavaScript.

---

## Running Locally

No build step required. Clone or download the repository and open `index.html` in any modern browser — or serve it with any static file server:

```bash
npx serve .
# or
python3 -m http.server
```

---

## License

See `LICENSE`.
