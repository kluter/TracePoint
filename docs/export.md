# Exporting for Google Earth and GIS

The download button in the map bar exports the map work of **all images** for use outside TracePoint. It is greyed out until a line has both its points on the map. Everything is built in the browser; nothing is uploaded.

This is an export only. To continue the work in TracePoint later, use **Export** in the ☰ menu of the photo side: that session file is the one TracePoint imports.

## What goes in

Per image that has something on the map:

| Item | Geometry | Notes |
|---|---|---|
| Estimated position | point | where the rays cross; two or more lines |
| Error ellipse | polygon | three or more lines |
| Ray of each line | line | 50 km behind P1 to 50 km ahead, with a vertex every 5 km so it follows the great circle as on the map |
| Map points | points | L1 P1, L1 P2, … |

The EXIF direction ray is included and marked as such; like on the map, it is not part of the position. Images without anything on the map are left out.

All coordinates are **WGS 84 (EPSG:4326)**, longitude −180 to 180, seven decimals. A ray or ellipse that crosses the antimeridian runs on past ±180 in one piece rather than being cut in two.

## Google Earth (`.kml`)

A folder per image, open on load. Inside: the estimated position (its coordinates in the description), the error ellipse, and a folder per line named like the line pill (`L1 · 153°`, the bearing from the estimated position; `L1 · EXIF direction` for the EXIF ray) with the ray and the map points. Lines and points keep their TracePoint colours; the position and the ellipse are yellow.

## GIS (`.geojson`)

One `FeatureCollection` (RFC 7946) with a feature per item, in the same order as the KML. GeoJSON has no folders, so every feature carries where it belongs:

| Property | Value |
|---|---|
| `image` | name of the image |
| `kind` | `position`, `ellipse`, `ray` or `point` |
| `label` | `Estimated position`, `Error ellipse`, `L1 ray`, `L1 P1`, … |
| `line`, `point` | `L1`, `P1` (rays and points) |
| `bearing` | degrees from the estimated position, as on the line pill, or `null` (rays) |
| `colour` | the line's colour, `#rrggbb` (rays and points) |
| `source` | `exif` for the EXIF direction ray, else `null` |

Style or filter by `image` and `kind` in QGIS (Categorized by `image`, for example). The collection also has `name`, `exported` and `tracepoint_geojson_version` (1).
