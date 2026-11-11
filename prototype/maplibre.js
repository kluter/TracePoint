/* TracePoint — MapLibre prototype.
   Standalone test page for the Leaflet → MapLibre question (#11).
   Tile set config is copied from js/script.js in its Leaflet shape on purpose,
   so the conversion below shows what the real port would have to do. */

/* ============================================================
   TILE SETS (copied from the app)
   ============================================================ */
const TILE_SETS = [
    {
        id: 'esri-sat', label: '🛰 Esri Satellite',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', opacity: 0.7, maxZoom: 21, maxNativeZoom: 19 } }
        ]
    },
    {
        id: 's2-2024', label: '🌍 Sentinel-2 2024',
        layers: [
            { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
              opts: { attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH',
                      maxZoom: 21, maxNativeZoom: 14 } }
        ]
    },
    {
        id: 'osm', label: '🗺 OpenStreetMap',
        layers: [
            { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              opts: { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 } }
        ]
    },
    {
        id: 'esri-dark', label: '🌑 Esri Dark Gray',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 16 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', maxZoom: 21, maxNativeZoom: 16 } }
        ]
    },
    {
        id: 'esri-topo', label: '🏔 Esri Topo',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } }
        ]
    },
    {
        id: 'esri-streets', label: '🏙 Esri Streets',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } }
        ]
    }
];

const WAYBACK_2014 = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10/{z}/{y}/{x}';
const TERRARIUM    = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/* Leaflet zoom N ≈ MapLibre zoom N-1 (MapLibre's zoom 0 is one 512px tile, Leaflet's is one 256px tile). */
const LEAFLET_ZOOM_OFFSET = 1;

/* Mouse rotation sensitivity. MapLibre default 0.8°/px; half of that felt right. */
const ROTATE_DEG_PER_PX = 0.40;

/* ============================================================
   MAP
   ============================================================ */
const map = new maplibregl.Map({
    container: 'map',
    style: { version: 8, sources: {}, layers: [] },   // empty style; we add raster sources ourselves
    center: [0, 20], zoom: 2 - LEAFLET_ZOOM_OFFSET,
    minZoom: 0, maxZoom: 21 - LEAFLET_ZOOM_OFFSET,
    hash: true,                                        // built-in #zoom/lat/lng/bearing/pitch
    attributionControl: { compact: false },
    maxPitch: 70,
    /* Mouse rotation. MapLibre 5 defaults to aroundCenter: true, a hybrid: beyond 100 px
       above/below the screen centre it rotates by the cursor's angle around the centre, inside
       that band by horizontal movement with the sign flipped above centre. Dragging along the
       band makes it alternate and wobble. false = plain horizontal drag → bearing, like Google.
       Add ?aroundCenter to the URL to compare the two. */
    aroundCenter: new URLSearchParams(location.search).has('aroundCenter'),
    rotateDegreesPerPixelMoved: ROTATE_DEG_PER_PX
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');

const $ = id => document.getElementById(id);

/* ============================================================
   1 · BASE LAYERS
   Leaflet TileLayer → raster source + raster layer.
   maxNativeZoom → source.maxzoom (MapLibre overzooms past it automatically).
   {s} → one tiles entry per subdomain. opacity → raster-opacity paint.
   ============================================================ */
let baseLayerIds = [];
let activeSet = null;

function expandSubdomains(url) {
    return url.includes('{s}') ? ['a', 'b', 'c'].map(s => url.replace('{s}', s)) : [url];
}

function removeBase() {
    baseLayerIds.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); });
    baseLayerIds = [];
}

function setTileSet(set) {
    removeBase();
    activeSet = set;
    set.layers.forEach((l, i) => {
        const id = `base-${i}`;
        const native = l.opts.maxNativeZoom ?? l.opts.maxZoom ?? 19;
        map.addSource(id, {
            type: 'raster', tileSize: 256,
            tiles: set.custom && set.fallback ? [fallbackUrl(l.url)] : expandSubdomains(l.url),
            maxzoom: native,
            attribution: l.opts.attribution || ''
        });
        // Insert below the first work layer so rays stay on top
        map.addLayer({
            id, type: 'raster', source: id,
            paint: { 'raster-opacity': l.opts.opacity ?? 1, 'raster-fade-duration': 0 }
        }, 'rays');
        baseLayerIds.push(id);
    });
    updateTileOut();
}

function updateTileOut() {
    if (!activeSet) return;
    const native = Math.max(...activeSet.layers.map(l => l.opts.maxNativeZoom ?? l.opts.maxZoom ?? 19));
    const z = map.getZoom();
    const fetchZ = Math.min(native, Math.floor(z) + 1);   // 256px tiles are fetched one level deeper than the map zoom
    $('tileOut').textContent =
        `source max zoom: ${native}\n` +
        `tiles fetched at: z${fetchZ}${Math.floor(z) + 1 > native ? '  (overzoomed ×' + (1 << (Math.floor(z) + 1 - native)) + ')' : ''}`;
}

TILE_SETS.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.label;
    $('tileset').appendChild(o);
});
$('tileset').addEventListener('change', e => setTileSet(TILE_SETS.find(s => s.id === e.target.value)));

/* ============================================================
   2 · CUSTOM LAYER + LOWER-ZOOM FALLBACK
   MapLibre has no createTile hook, so the fallback is a custom protocol:
   fetch the tile; on failure fetch the parent tile and crop the matching
   quarter onto a canvas. Same idea as FallbackTileLayer in the app.
   ============================================================ */
const MAX_FALLBACK_LEVELS = 5;
const fbStats = { direct: 0, fallback: 0, failed: 0 };

function fallbackUrl(template) {
    return `fallback://t/{z}/{x}/{y}?u=${encodeURIComponent(template)}`;
}

async function fetchBitmap(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    try { return { blob, bmp: await createImageBitmap(blob) }; }
    catch { return null; }   // 200 but not an image
}

maplibregl.addProtocol('fallback', async (params, abort) => {
    const m = params.url.match(/^fallback:\/\/t\/(\d+)\/(\d+)\/(\d+)\?u=(.*)$/);
    if (!m) throw new Error('bad fallback url');
    const z = +m[1], x = +m[2], y = +m[3], tpl = decodeURIComponent(m[4]);
    const size = 256;

    for (let level = 0; level <= MAX_FALLBACK_LEVELS && z - level >= 0; level++) {
        const f = 1 << level;
        const cx = Math.floor(x / f), cy = Math.floor(y / f), cz = z - level;
        const url = tpl.replace('{z}', cz).replace('{x}', cx).replace('{y}', cy).replace('{s}', 'a');

        let got;
        try { got = await fetchBitmap(url, abort.signal); }
        catch (e) { if (abort.signal.aborted) throw e; got = null; }
        if (!got) continue;

        if (level === 0) {
            fbStats.direct++; updateFbOut();
            return { data: await got.blob.arrayBuffer() };
        }
        // Crop the part of the parent tile that covers this tile
        const part = size / f;
        const sx = (x - cx * f) * part, sy = (y - cy * f) * part;
        const canvas = new OffscreenCanvas(size, size);
        canvas.getContext('2d').drawImage(got.bmp, sx, sy, part, part, 0, 0, size, size);
        fbStats.fallback++; updateFbOut();
        return { data: await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer() };
    }
    fbStats.failed++; updateFbOut();
    throw new Error('tile missing at all fallback levels');
});

function updateFbOut() {
    $('fbOut').textContent = `direct: ${fbStats.direct}  fallback: ${fbStats.fallback}  failed: ${fbStats.failed}`;
}

$('customUrl').value = WAYBACK_2014;
$('applyCustom').addEventListener('click', () => {
    const url = $('customUrl').value.trim();
    if (!/^https:\/\/.*\{z\}.*/.test(url)) return alert('Need an https XYZ template with {z} {x} {y}.');
    fbStats.direct = fbStats.fallback = fbStats.failed = 0; updateFbOut();
    setTileSet({
        id: 'custom', label: 'Custom', custom: true, fallback: $('fallback').checked,
        layers: [{ url, opts: { attribution: 'Custom layer', maxZoom: 21 } }]
    });
});
$('backBuiltin').addEventListener('click', () => {
    $('fbOut').textContent = 'fallback: not active';
    setTileSet(TILE_SETS.find(s => s.id === $('tileset').value));
});

// Mirrors Leaflet's 'tileerror' toast in the app: shown once per custom layer
let tileErrorShown = false;
map.on('error', e => {
    if (!activeSet?.custom || tileErrorShown) return;
    if (e.sourceId && baseLayerIds.includes(e.sourceId)) {
        tileErrorShown = true;
        showStatus('Custom layer: some tiles failed to load (check the URL or zoom out).', 3000);
    }
});

/* ============================================================
   3 · POINTS, RAYS, INTERSECTION
   Points: draggable DOM markers (tests #12).
   Rays + intersection: GeoJSON source updated with setData.
   ============================================================ */
const COLOURS = ['#ff5a5a', '#5ab4ff', '#7dff5a', '#ffb45a', '#d05aff', '#5affe6'];
const lines = [];          // { points: [{lng,lat,marker}], colour }
let placing = null;        // { lineIndex, pointIndex } while in place mode
let intersectionMarker = null;

map.on('load', () => {
    map.addSource('work', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'rays', type: 'line', source: 'work', filter: ['==', ['get', 'kind'], 'ray'],
        paint: { 'line-color': ['get', 'colour'], 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [3, 2] }
    });
    map.addLayer({
        id: 'ellipse', type: 'fill', source: 'work', filter: ['==', ['get', 'kind'], 'ellipse'],
        paint: { 'fill-color': '#ffdc32', 'fill-opacity': 0.08 }
    });
    map.addLayer({
        id: 'ellipse-line', type: 'line', source: 'work', filter: ['==', ['get', 'kind'], 'ellipse'],
        paint: { 'line-color': '#ffdc32', 'line-width': 1.5, 'line-dasharray': [2, 2] }
    });
    setTileSet(TILE_SETS[0]);
    updateZoomOut(); updateRotOut();
});

function newLine() {
    lines.push({ points: [], colour: COLOURS[lines.length % COLOURS.length] });
    placing = { lineIndex: lines.length - 1, pointIndex: 0 };
    updatePlacingUI();
}

function cancelPlacing() {
    if (!placing) return;
    const line = lines[placing.lineIndex];
    if (line.points.length === 0) lines.pop();
    placing = null;
    updatePlacingUI();
}

function updatePlacingUI() {
    map.getCanvas().style.cursor = placing ? 'crosshair' : '';
    if (placing) showStatus(`Click the map to place L${placing.lineIndex + 1} P${placing.pointIndex + 1} · Esc to cancel`);
    else hideStatus();
    $('workOut').textContent = `${lines.length} line${lines.length === 1 ? '' : 's'}` +
        (placing ? `  (placing L${placing.lineIndex + 1} P${placing.pointIndex + 1})` : '');
}

function pointMarker(line, pt) {
    const el = document.createElement('div');
    el.className = 'pt';
    el.style.background = line.colour;
    const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([pt.lng, pt.lat]).addTo(map);
    marker.on('drag', () => {
        const ll = marker.getLngLat();
        pt.lng = ll.lng; pt.lat = ll.lat;
        rebuildWork();
    });
    return marker;
}

map.on('click', e => {
    if (!placing) return;
    const line = lines[placing.lineIndex];
    const pt = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    pt.marker = pointMarker(line, pt);
    line.points.push(pt);

    if (line.points.length < 2) placing.pointIndex++;
    else placing = null;
    rebuildWork();
    updatePlacingUI();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') { cancelPlacing(); hideCtx(); } });
$('newLine').addEventListener('click', newLine);
$('clear').addEventListener('click', () => {
    cancelPlacing();
    lines.forEach(l => l.points.forEach(p => p.marker.remove()));
    lines.length = 0;
    rebuildWork(); updatePlacingUI();
});

function rebuildWork() {
    const features = [];
    const RAY_KM = 50;
    const rays = [];

    lines.forEach(line => {
        if (line.points.length < 2) return;
        const [p1, p2] = line.points;
        const bearing = bearingDeg(p1, p2);
        const fwd = destinationPoint(p1, bearing, RAY_KM);
        const bwd = destinationPoint(p1, bearing + 180, RAY_KM);
        features.push({
            type: 'Feature', properties: { kind: 'ray', colour: line.colour },
            geometry: { type: 'LineString', coordinates: [[bwd.lng, bwd.lat], [p1.lng, p1.lat], [p2.lng, p2.lat], [fwd.lng, fwd.lat]] }
        });
        rays.push({ p1, p2 });
    });

    // Intersection (same maths as the app)
    if (intersectionMarker) { intersectionMarker.remove(); intersectionMarker = null; }
    const hits = [];
    for (let i = 0; i < rays.length; i++)
        for (let j = i + 1; j < rays.length; j++) {
            const pt = intersectLines(rays[i].p1, rays[i].p2, rays[j].p1, rays[j].p2);
            if (pt) hits.push(pt);
        }
    if (hits.length) {
        const lat = hits.reduce((a, p) => a + p.lat, 0) / hits.length;
        const lng = hits.reduce((a, p) => a + p.lng, 0) / hits.length;
        const el = document.createElement('div');
        el.className = 'intersection';
        intersectionMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat])
            .setPopup(new maplibregl.Popup({ offset: 16, closeButton: true })
                .setHTML(`<b>Estimated Position</b><br>${lat.toFixed(6)}, ${lng.toFixed(6)}`))
            .addTo(map);
        if (hits.length >= 3) features.push(ellipseFeature(hits, { lat, lng }));
    }

    map.getSource('work').setData({ type: 'FeatureCollection', features });
}

function ellipseFeature(hits, center) {
    const n = hits.length;
    const diffs = hits.map(p => ({ dx: p.lng - center.lng, dy: p.lat - center.lat }));
    const Cxx = diffs.reduce((a, d) => a + d.dx * d.dx, 0) / n;
    const Cyy = diffs.reduce((a, d) => a + d.dy * d.dy, 0) / n;
    const Cxy = diffs.reduce((a, d) => a + d.dx * d.dy, 0) / n;
    const trace = Cxx + Cyy;
    const disc = Math.sqrt(Math.max(0, (trace / 2) ** 2 - (Cxx * Cyy - Cxy * Cxy)));
    const l1 = trace / 2 + disc, l2 = trace / 2 - disc;
    const angle = Math.abs(Cxy) < 1e-12 ? 0 : Math.atan2(l1 - Cxx, Cxy);
    const a = Math.sqrt(Math.max(0, l1)) * 2, b = Math.sqrt(Math.max(0, l2)) * 2;
    const ring = [];
    for (let i = 0; i <= 64; i++) {
        const t = (2 * Math.PI * i) / 64;
        const rx = a * Math.cos(t) * Math.cos(angle) - b * Math.sin(t) * Math.sin(angle);
        const ry = a * Math.cos(t) * Math.sin(angle) + b * Math.sin(t) * Math.cos(angle);
        ring.push([center.lng + rx, center.lat + ry]);
    }
    return { type: 'Feature', properties: { kind: 'ellipse' }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/* ============================================================
   4 · ROTATION + RIGHT-CLICK MENU
   ============================================================ */
function updateRotOut() {
    $('rotOut').textContent = `bearing: ${map.getBearing().toFixed(1)}°   pitch: ${map.getPitch().toFixed(1)}°\nsensitivity: ${ROTATE_DEG_PER_PX}°/px (loaded)`;
}
$('north').addEventListener('click', () => map.easeTo({ bearing: 0, pitch: 0 }));

// Tell a plain right-click from a right-drag rotate: remember where the button went down
let rightDown = null;
map.getCanvas().addEventListener('mousedown', e => { if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY }; });

map.on('contextmenu', e => {
    const moved = rightDown ? Math.hypot(e.originalEvent.clientX - rightDown.x, e.originalEvent.clientY - rightDown.y) : 0;
    rightDown = null;
    if (moved > 3) {
        $('ctxOut').textContent = `last right-click: moved ${moved.toFixed(0)}px → menu suppressed`;
        return;
    }
    $('ctxOut').textContent = `last right-click: moved ${moved.toFixed(0)}px → menu shown`;
    showCtx(e.point, e.lngLat);
});

function showCtx(point, lngLat) {
    const c = `${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`;
    const ctx = $('ctx');
    ctx.innerHTML =
        `<div class="coords">${c}</div>` +
        `<div data-act="copy">Copy coordinates</div>` +
        `<div data-act="gmaps">Open in Google Maps</div>`;
    ctx.style.left = point.x + 'px';
    ctx.style.top = point.y + 'px';
    ctx.hidden = false;
    ctx.onclick = ev => {
        const act = ev.target.dataset.act;
        if (act === 'copy') navigator.clipboard.writeText(c).then(() => showStatus('Copied.', 1200));
        if (act === 'gmaps') window.open(`https://www.google.com/maps?q=${lngLat.lat},${lngLat.lng}`, '_blank', 'noopener');
        hideCtx();
    };
}
function hideCtx() { $('ctx').hidden = true; }
map.on('movestart', hideCtx);
map.on('click', hideCtx);

/* ============================================================
   5 · TERRAIN
   ============================================================ */
let terrainOn = false;
map.on('load', () => {
    map.addSource('dem', {
        type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrarium</a> via AWS'
    });
});
$('terrain').addEventListener('click', () => {
    terrainOn = !terrainOn;
    map.setTerrain(terrainOn ? { source: 'dem', exaggeration: 1 } : null);
    $('terrain').textContent = `Terrain: ${terrainOn ? 'on' : 'off'}`;
    $('terrain').classList.toggle('on', terrainOn);
});

/* ============================================================
   6 · ZOOM OFFSET
   ============================================================ */
// The app's demo: map.setView([52.3899735750511, 13.060147762298586], 16)
$('potsdam').addEventListener('click', () => {
    map.flyTo({ center: [13.060147762298586, 52.3899735750511], zoom: 16 - LEAFLET_ZOOM_OFFSET, bearing: 0, pitch: 0, duration: 1200 });
});
function updateZoomOut() {
    const z = map.getZoom();
    $('zoomOut').textContent = `MapLibre zoom: ${z.toFixed(2)}\n≈ Leaflet zoom: ${(z + LEAFLET_ZOOM_OFFSET).toFixed(2)}`;
}

/* ============================================================
   READOUTS + HELPERS
   ============================================================ */
map.on('move', () => { updateZoomOut(); updateRotOut(); updateTileOut(); });
map.on('mousemove', e => {
    $('cursorOut').textContent = `cursor: ${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
});

let statusTimer = null;
function showStatus(text, ms) {
    const s = $('status');
    s.textContent = text; s.hidden = false;
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => { if (placing) updatePlacingUI(); else hideStatus(); }, ms);
}
function hideStatus() { $('status').hidden = true; }

/* Geo maths — copied from the app unchanged */
const DEG = Math.PI / 180, RAD = 180 / Math.PI, R = 6371;

function bearingDeg(p1, p2) {
    const dLng = (p2.lng - p1.lng) * DEG;
    const lat1 = p1.lat * DEG, lat2 = p2.lat * DEG;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * RAD + 360) % 360;
}

function destinationPoint(origin, bearingDegrees, distKm) {
    const d = distKm / R, br = bearingDegrees * DEG;
    const lat1 = origin.lat * DEG, lng1 = origin.lng * DEG;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * RAD, lng: lng2 * RAD };
}

function intersectLines(p1, p2, p3, p4) {
    const x1 = p1.lng, y1 = p1.lat, x2 = p2.lng, y2 = p2.lat;
    const x3 = p3.lng, y3 = p3.lat, x4 = p4.lng, y4 = p4.lat;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return { lat: y1 + t * (y2 - y1), lng: x1 + t * (x2 - x1) };
}
