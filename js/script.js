/* ============================================================
   TracePoint – script.js
   ============================================================ */

const canvas      = document.getElementById("image-canvas");
const ctx         = canvas.getContext("2d");
const lineCanvas  = document.getElementById("line-canvas");   // lines and points, at screen size (see render)
const lctx        = lineCanvas.getContext("2d");
const container   = document.getElementById("image-container");
const overlay     = document.getElementById("drop-overlay");
const btnAddLine    = document.getElementById("btn-add-line");
const btnHorizon    = document.getElementById("btn-horizon");
const LOAD_FIRST    = 'Load a photo first';   // tooltip of a line bar tool while there is no photo
const lineBar       = document.getElementById("line-bar");

let pulseFrameId = null;

/* Geo maths constants (functions: see GEO MATHS at the end) */
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const R   = 6371; // Earth radius km

const MAX_LINES = 5;   // per image; keys 1–5 jump to them

/* Key layouts, switched in the help card. Photo: the left hand works the photo, the mouse the map.
   Map: W A S D move the map and Q / E turn it while held. Keys are physical positions (KeyboardEvent.code),
   so a French or German keyboard uses the same places. Fixed keys (Esc, Del, F2, 1–5, Ctrl+…) are not in here. */
const KEY_LAYOUT_STORE = 'tp-keys';
const KEY_LAYOUTS = {
    photo: { newLine: 'KeyE', removeLine: 'KeyR', nextPoint: 'KeyF', level: 'KeyW', help: 'KeyX',
             measure: 'KeyM', north: 'KeyN' },
    map:   { newLine: 'KeyR', nextPoint: 'KeyG', level: 'KeyL', help: 'KeyH',
             measure: 'KeyM', north: 'KeyN', topDown: 'KeyT',
             panUp: 'KeyW', panLeft: 'KeyA', panDown: 'KeyS', panRight: 'KeyD', turnLeft: 'KeyQ', turnRight: 'KeyE' }
};
let keyLayout = localStorage.getItem(KEY_LAYOUT_STORE) === 'map' ? 'map' : 'photo';
let keyNames = null;   // physical key → its letter on this keyboard; only Chrome and Edge tell, others show US letters

/* The letter to show for a physical key, and for an action of the active layout ('' if it has no key) */
function keyLabel(code) {
    return (keyNames?.get(code) || code.replace(/^Key/, '')).toUpperCase();
}
function keyFor(action) {
    const code = KEY_LAYOUTS[keyLayout][action];
    return code ? keyLabel(code) : '';
}
function actionForKey(code) {
    for (const [action, c] of Object.entries(KEY_LAYOUTS[keyLayout])) if (c === code) return action;
    return null;
}

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

const toastCounts = new Map();
const TOAST_DURATION = 7000;
const TOAST_MAX_STACK = 3;

function showToast(msg, type = 'error') {
    const count = toastCounts.get(msg) || 0;
    if (count >= TOAST_MAX_STACK) return;
    toastCounts.set(msg, count + 1);

    const box = document.getElementById('toast-container');
    const item = document.createElement('div');
    item.className = 'toast-item' + (type === 'success' ? ' toast-success' : '');
    item.innerHTML = `<span>${escHtml(msg)}</span><button class="toast-close" aria-label="Dismiss">×</button>`;
    item.querySelector('.toast-close').onclick = () => dismissToast(item, msg);
    box.appendChild(item);
    requestAnimationFrame(() => item.classList.add('toast-visible'));

    setTimeout(() => dismissToast(item, msg), TOAST_DURATION);
}

function dismissToast(item, msg) {
    if (!item.isConnected || item.classList.contains('toast-hiding')) return;   // already on its way out
    item.classList.add('toast-hiding');
    item.addEventListener('transitionend', () => {
        item.remove();
        const n = toastCounts.get(msg) || 1;
        if (n <= 1) toastCounts.delete(msg);
        else toastCounts.set(msg, n - 1);
    }, { once: true });
}

lineBar.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.action === 'delete-line')  deleteLine(+btn.dataset.idx);
    if (btn.dataset.action === 'delete-point') deletePoint(+btn.dataset.lidx, +btn.dataset.pidx);
});

document.getElementById('exif-card').addEventListener('click', e => {
    if (e.target.closest('[data-action="exif-gps"]')) goToExifGps();
    if (e.target.closest('[data-action="exif-ray"]')) addExifRay();
    const copyBtn = e.target.closest('[data-action="copy-coords"]');
    if (copyBtn) {
        navigator.clipboard.writeText(copyBtn.dataset.coords)
            .then(() => showToast('Coordinates copied.', 'success'))
            .catch(() => showToast('Could not copy to clipboard.'));
    }
});

/* ============================================================
   SESSION MODEL
   Each session owns one image and all work done on it.
   ============================================================ */
const ADJUST_DEFAULTS = { contrast: 100, brightness: 100, saturation: 100, invert: false };

function createSession(name) {
    return {
        id:               Date.now().toString(36) + Math.random().toString(36).slice(2, 10),   // key of the autosaved image, not exported
        name,
        colourIndex:      nextFreeColourIndex(),
        imgElement:       null,
        currentObjectURL: null,
        lines:            [],
        horizonPoints:    [],
        view:             { scale: 1, tx: 0, ty: 0, rotation: 0 },
        mapView:          null,   // { center: {lat, lng}, zoom, bearing, pitch }
        /* Rays and the ellipse of every session live in one shared GeoJSON source (see rebuildWorkSource);
           markers are DOM elements owned here. */
        mapObjects:       { geoMarkers: [], intersectionMarker: null, intersectionLatLng: null, ellipseRing: null },
        exifGpsMarker:    null,
        adjust:           { ...ADJUST_DEFAULTS },  // display only, never exported
        history:          { past: [], future: [], now: { lines: [], key: '[]' } }   // undo / redo, see below; not saved
    };
}

/* sessions and activeSessionIndex are initialised after map is created (see below) */
let sessions;
let activeSessionIndex = 0;

/* Convenience accessor – always returns the active session */
function sess() { return sessions[activeSessionIndex]; }

/* ---- EXPORT STATE (functions: see EXPORT WITH PHOTOS below) ---- */
const EXPORT_PHOTOS_KEY = 'tp-export-photos';   // localStorage: '1' = exported files carry the photos
let exportPhotos = localStorage.getItem(EXPORT_PHOTOS_KEY) === '1';

/* ---- AUTOSAVE STATE (functions: see AUTOSAVE below) ---- */
const AUTOSAVE_KEY = 'tp-autosave';   // localStorage: '0' = switched off
let autosaveOn    = localStorage.getItem(AUTOSAVE_KEY) !== '0';
let autosaveReady = false;            // false until the restore on start has finished, so the empty start state never overwrites saved work
let autosaveTimer = null;
let autosaveOwner = !navigator.locks; // only one tab writes the store (see claimAutosave); no Web Locks API: single-tab behaviour

/* ---- INTERACTION STATE (not per-session) ---- */
const state = {
    mode: 'idle',         // 'idle' | 'drag-line' | 'map-point' | 'horizon'
    activeLineIndex: -1,
    mapPointTarget:  null,  // { lineIndex, pointIndex }: the point the next map click places
    selectedPoint:   null,  // { lineIndex, pointIndex }: picked on the photo or on the map, highlighted on both
    showOriginal:    false, // the photo is drawn without its display adjustments (see toggleOriginal)
    press:           null,  // { lineIndex, wasActive, x, y, imgY }: mouse down on a line, not yet a drag or a click
    isDragging:      false,
    pointDrag:       null,  // { line, pt, origY } while a point is slid along its line on the image
    _horizonMouse:   null
};
let markerDrag = null;   // { marker, pt, origin: {lat, lng}, cancelled } while a geo marker is dragged on the map

/* ---- UNDO / REDO for lines and points ----
   Every image has its own history: snapshots of its lines, taken when an edit is finished
   (historyCommit runs from updateUI and on mouse release, never in the middle of a drag).
   `now` is the state on screen; past and future hold the steps around it. The history lives in
   memory only: it is neither autosaved nor exported. */
const HISTORY_LIMIT = 100;

function historySnap(s) {
    const lines = s.lines.map(l => ({
        x: l.x, colour: l.colour || null, source: l.source || null, pristine: !!l.pristine,
        points: l.points.map(p => ({ y: p.y, geo: p.geo ? { lat: p.geo.lat, lng: p.geo.lng } : null }))
    }));
    // The "grab me" glow is not an edit: it is restored with a step but never makes one
    return { lines, key: JSON.stringify(lines, (k, v) => (k === 'pristine' ? undefined : v)) };
}

function historyBusy() { return state.isDragging || !!state.pointDrag || !!markerDrag; }

function historyCommit() {
    const s = sess();
    if (!s || historyBusy()) return;
    const h = s.history, snap = historySnap(s);
    if (snap.key !== h.now.key) {   // selection changes and clicks without movement are not edits
        h.past.push(h.now);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
        h.future = [];
    }
    h.now = snap;
}

/* Imported or restored work is the new starting point */
function historyReset(s) {
    s.history = { past: [], future: [], now: historySnap(s) };
}

function historyApply(s, snap) {
    s.lines.forEach((_, lIdx) => clearMapObjectsForLine(lIdx));
    s.mapObjects.geoMarkers = [];
    s.lines = snap.lines.map(l => ({ ...l, points: l.points.map(p => ({ y: p.y, geo: p.geo ? { ...p.geo } : null })) }));
    s.history.now = snap;
    // Line numbers may have shifted: a pending map point is dropped, the active line kept if it still exists
    state.mapPointTarget  = null;
    state.selectedPoint   = null;
    state.activeLineIndex = Math.min(state.activeLineIndex, s.lines.length - 1);
    if (state.mode !== 'horizon') state.mode = state.activeLineIndex === -1 ? 'idle' : 'drag-line';
    s.lines.forEach((_, lIdx) => rebuildMapForLine(lIdx));
    recomputeIntersection();
    render(); updateUI();
}

function undo() {
    const s = sess(), h = s.history;
    if (historyBusy() || h.past.length === 0) return;
    h.future.push(h.now);
    historyApply(s, h.past.pop());
}

function redo() {
    const s = sess(), h = s.history;
    if (historyBusy() || h.future.length === 0) return;
    h.past.push(h.now);
    historyApply(s, h.future.pop());
}

/* ---- ZOOM / PAN helpers ---- */
let isPanning = false, panStart = { x: 0, y: 0 }, panOrigin = { tx: 0, ty: 0 };
const MIN_SCALE = 0.1, MAX_SCALE = 20;

function applyTransform() {
    const v = sess().view;
    canvas.style.transform       = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    canvas.style.transformOrigin = '0 0';
    drawLines();   // the lines are drawn at screen size and do not move with the photo's CSS transform
    scheduleAutosave();
}

/* Convert mouse client coords → canvas-pixel coords (lines live in canvas space) */
function clientToImage(e) {
    const v    = sess().view;
    const rect = container.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left - v.tx) / v.scale,
        y: (e.clientY - rect.top  - v.ty) / v.scale
    };
}

/* ---- MAP ----
   MapLibre zoom levels are one less than Leaflet's for the same view (its zoom 0 is a
   single 512 px tile). Saved session files use MapLibre zooms since json_version 2. */
const WORLD_VIEW = { center: { lat: 20, lng: 0 }, zoom: 1, bearing: 0, pitch: 0 };

/* Mouse rotation sensitivity: MapLibre's default 0.8°/px is twitchy; half of it feels right. */
const ROTATE_DEG_PER_PX = 0.4;

const map = new maplibregl.Map({
    container: 'map-container',
    style: { version: 8, sources: {}, layers: [] },   // empty style; raster sources are added below
    center: [WORLD_VIEW.center.lng, WORLD_VIEW.center.lat],
    zoom: WORLD_VIEW.zoom,
    minZoom: 0, maxZoom: 20,
    maxPitch: 90,
    attributionControl: { compact: true },   // the ⓘ button folds the credits away; MapLibre folds them on the first drag
    /* Ctrl+drag or right-drag rotates and tilts. aroundCenter: false = plain horizontal
       drag → bearing; the default hybrid mode wobbles when dragging slowly near the centre line. */
    aroundCenter: false,
    rotateDegreesPerPixelMoved: ROTATE_DEG_PER_PX
});
// The compass (reset bearing and tilt) is the only button on the map, bottom-left; zooming is done with the wheel,
// double-click or the keyboard. Search box and map panel live in the map bar under the header.
map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: true }), 'bottom-left');

/* With 3D terrain, dragging and wheel zooming work on the ground point under the mouse. Near the horizon
   of a tilted view, or over terrain that has not loaded yet, that point is far away or wrong, and one
   step then throws the map kilometres off or changes the zoom by many levels. While the mouse drags or
   the wheel turns, a single camera update may not move the centre further than the view is large or
   change the zoom by more than 1.5 levels; a bigger step is dropped and the map stays put for that
   frame. Flights and jumps made by the app are not touched. */
let mapMouseDown = false, mapLastWheel = 0;
{
    const box = map.getCanvasContainer();
    box.addEventListener('mousedown', () => { mapMouseDown = true; }, true);
    box.addEventListener('wheel', () => { mapLastWheel = performance.now(); }, { capture: true, passive: true });
    window.addEventListener('mouseup', () => { mapMouseDown = false; }, true);
    window.addEventListener('blur',    () => { mapMouseDown = false; });
}
let mapGuardWarned = 0;
map.transformCameraUpdate = (next) => {
    const byHand = mapMouseDown || performance.now() - mapLastWheel < 500;   // the wheel zoom glides on for a moment
    if (!byHand || !map.getTerrain()) return {};
    const cur = map.getCenter(), zoom = map.getZoom();
    const metresPerPixel = 40075016.686 * Math.cos(cur.lat * Math.PI / 180) / (512 * Math.pow(2, zoom));
    const c = map.getCanvas();
    const limit = Math.hypot(c.clientWidth, c.clientHeight) * metresPerPixel;
    const moved = cur.distanceTo(next.center);
    if (moved <= limit && Math.abs(next.zoom - zoom) <= 1.5) return {};
    if (performance.now() - mapGuardWarned > 2000) {   // a trace for bug reports, at most every 2 s
        mapGuardWarned = performance.now();
        console.warn(`TracePoint: dropped a map step with 3D terrain (zoom ${zoom.toFixed(2)} → ${next.zoom.toFixed(2)}, ${(moved / 1000).toFixed(1)} km)`);
    }
    return { center: cur, zoom };
};

let mapReady = false;   // sources and layers can only be added once the style has loaded

/* Middle-button drag pans the map (MapLibre ignores button 1; without this the browser autoscrolls).
   Mirrors the image panel, which also pans with middle-drag. */
(() => {
    const mapCanvas = map.getCanvasContainer();
    let last = null;
    const stop = () => { last = null; mapCanvas.style.cursor = ''; };
    mapCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        last = { x: e.clientX, y: e.clientY };
        mapCanvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!last) return;
        if (!(e.buttons & 4)) return stop();   // button was released outside the window
        map.panBy([last.x - e.clientX, last.y - e.clientY], { duration: 0 });
        last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 1 && last) stop(); });
    window.addEventListener('blur', stop);
})();

function getMapView() {
    const c = map.getCenter();
    return { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

function applyMapView(v) {
    map.jumpTo({ center: [v.center.lng, v.center.lat], zoom: v.zoom, bearing: v.bearing ?? 0, pitch: v.pitch ?? 0 });
}

/* Centre on a point at a zoom, keeping the current bearing and pitch */
function jumpTo(p, zoom) {
    map.jumpTo({ center: [p.lng, p.lat], zoom });
}

/* ---- MAP VIEW IN THE URL HASH ----
   #lat,lon,zoom with ,bearing,pitch appended only when either is non-zero. The hash is never sent
   to the server and holds only the view: no lines, points or image data. replaceState keeps the
   back button clean. Zoom is the MapLibre zoom, the same number the session files store. */
function parseViewHash(hash) {
    const parts = hash.replace(/^#/, '').split(',').map(Number);
    if (parts.length < 3 || parts.length > 5 || parts.some(n => !Number.isFinite(n))) return null;
    const [lat, lng, zoom, bearing = 0, pitch = 0] = parts;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || zoom < 0 || zoom > 20 || Math.abs(pitch) > 90) return null;
    return { center: { lat, lng }, zoom, bearing, pitch };
}

function writeViewHash() {
    const v = getMapView();
    let hash = `#${v.center.lat.toFixed(5)},${v.center.lng.toFixed(5)},${v.zoom.toFixed(2)}`;
    const bearing = Math.round(((v.bearing % 360) + 360) % 360) % 360, pitch = Math.round(v.pitch);   // compass style, 0–359
    if (bearing || pitch) hash += `,${bearing},${pitch}`;
    if (hash !== location.hash) history.replaceState(null, '', hash);
}

{
    const initial = parseViewHash(location.hash);
    if (initial) applyMapView(initial);
}
map.on('moveend', writeViewHash);
map.on('moveend', scheduleAutosave);

/* ---- MAP BAR READOUT: bearing (compass style, 0–359), tilt and zoom of the live view ---- */
const mapReadout = document.getElementById('map-readout');
function updateMapReadout() {
    const bearing = Math.round(((map.getBearing() % 360) + 360) % 360) % 360;
    mapReadout.innerHTML =
        `<span><i>Bearing</i><b>${bearing}°</b></span>` +
        `<span><i>Tilt</i><b>${Math.round(map.getPitch())}°</b></span>` +
        `<span><i>Zoom</i><b>${map.getZoom().toFixed(1)}</b></span>`;
}
map.on('move', updateMapReadout);
updateMapReadout();
window.addEventListener('hashchange', () => {
    const v = parseViewHash(location.hash);
    if (v) applyMapView(v);
});

/* Small DOM helper for the map controls (replaces L.DomUtil.create) */
function el(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
}

/* sessions initialised after LINE_COLOURS and map are both defined (see below) */

/* ---- TILE LAYER DEFINITIONS ---- */
const TILE_SETS = [
    {
        id: 'esri-sat',
        label: 'Esri Satellite',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', opacity: 0.7, maxZoom: 21, maxNativeZoom: 19 } }
        ]
    },
    {
        id: 's2-2024',
        label: 'Sentinel-2 2024',
        layers: [
            { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
              opts: { attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
                      maxZoom: 21, maxNativeZoom: 14 } }
        ]
    },
    {
        id: 'osm',
        label: 'OpenStreetMap',
        layers: [
            { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',   // OSM retired the a/b/c subdomains
              opts: { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 } }
        ]
    },
    {
        id: 'esri-dark',
        label: 'Esri Dark Gray',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 16 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', maxZoom: 21, maxNativeZoom: 16 } }
        ]
    },
    {
        id: 'esri-topo',
        label: 'Esri Topo',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } }
        ]
    },
    {
        id: 'esri-streets',
        label: 'Esri Streets',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } }
        ]
    }
];

/* ---- CUSTOM TILE LAYERS (user-supplied XYZ URLs, stored in this browser only) ---- */
const CUSTOM_LAYERS_KEY = 'tp-custom-layers';

function loadCustomLayers() {
    try {
        const list = JSON.parse(localStorage.getItem(CUSTOM_LAYERS_KEY));
        if (!Array.isArray(list)) return [];
        return list.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string' && isValidTileUrl(c.url));
    } catch { return []; }
}

function saveCustomLayers() {
    localStorage.setItem(CUSTOM_LAYERS_KEY, JSON.stringify(customLayers));
}

function isValidTileUrl(url) {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
    if (!['{x}', '{y}', '{z}'].every(p => url.includes(p))) return false;
    try { new URL(url.replace(/\{[a-z]+\}/gi, '0')); return true; } catch { return false; }
}

let customLayers = loadCustomLayers();

function allTileSets() {
    return TILE_SETS.concat(customLayers.map(c => ({
        id: c.id,
        label: c.name,
        custom: true,
        layers: [{ url: c.url, opts: { attribution: 'Custom layer', maxZoom: 21 } }]
    })));
}

/* Custom layers fall back to an upscaled lower-zoom tile when a tile is missing.
   Custom sources often stop short of the map's max zoom (e.g. older Esri Wayback
   releases end at z16–18 depending on the area), which would otherwise render black.
   MapLibre has no per-tile hook, so this is a custom "fallback://" protocol: fetch the
   tile; on failure fetch the parent tile and crop the matching quarter onto a canvas. */
const MAX_FALLBACK_LEVELS = 5;

function fallbackUrl(template) {
    return `fallback://t/{z}/{x}/{y}?u=${encodeURIComponent(template)}`;
}

function expandSubdomains(url) {
    return url.includes('{s}') ? ['a', 'b', 'c'].map(s => url.replace('{s}', s)) : [url];
}

/* Fetch a tile. decode: also return it as a bitmap (needed for cropping, and to tell an image
   from an error page when the server does not label the response as an image). */
async function fetchTile(url, signal, decode) {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!decode && blob.type.startsWith('image/')) return { blob, bmp: null };
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
        try { got = await fetchTile(url, abort.signal, level > 0); }
        catch (e) { if (abort.signal.aborted) throw e; got = null; }
        if (!got) continue;

        if (level === 0) {
            if (got.bmp) got.bmp.close();
            return { data: await got.blob.arrayBuffer() };
        }

        // Crop the part of the parent tile that covers this tile (the parent may be 256 or 512 px)
        const part = got.bmp.width / f;
        const sx = (x - cx * f) * part, sy = (y - cy * f) * part;
        const tile = new OffscreenCanvas(size, size);
        tile.getContext('2d').drawImage(got.bmp, sx, sy, part, part, 0, 0, size, size);
        got.bmp.close();
        return { data: await (await tile.convertToBlob({ type: 'image/png' })).arrayBuffer() };
    }
    throw new Error('tile missing at all fallback levels');
});

let activeTileLayerIds = [];
let activeTileSetId    = null;
let tileErrorShown     = false;

/* Leaflet TileLayer → raster source + raster layer: maxNativeZoom → source maxzoom
   (MapLibre overzooms past it on its own), {s} → one URL per subdomain, opacity → paint. */
function setTileSet(id) {
    const set = allTileSets().find(s => s.id === id) || TILE_SETS[0];
    activeTileSetId = set.id;
    localStorage.setItem('tp-tileset', set.id);
    if (!mapReady) return;   // applied again from the map's load handler

    activeTileLayerIds.forEach(lid => {
        if (map.getLayer(lid))  map.removeLayer(lid);
        if (map.getSource(lid)) map.removeSource(lid);
    });
    activeTileLayerIds = [];
    tileErrorShown = false;

    set.layers.forEach((l, i) => {
        const lid = `base-${i}`;
        map.addSource(lid, {
            type: 'raster', tileSize: 256,
            tiles: set.custom ? [fallbackUrl(l.url)] : expandSubdomains(l.url),
            maxzoom: l.opts.maxNativeZoom ?? l.opts.maxZoom ?? 19,
            attribution: l.opts.attribution || ''
        });
        map.addLayer({
            id: lid, type: 'raster', source: lid,
            paint: { 'raster-opacity': l.opts.opacity ?? 1, 'raster-fade-duration': 0 }
        }, map.getLayer('hillshade') ? 'hillshade' : undefined);   // base imagery stays below the hillshade and the work layers
        activeTileLayerIds.push(lid);
    });
}

/* Mirrors Leaflet's 'tileerror' toast: shown once per custom layer */
map.on('error', (e) => {
    if (tileErrorShown || !e.sourceId || !activeTileLayerIds.includes(e.sourceId)) return;
    const set = allTileSets().find(s => s.id === activeTileSetId);
    if (!set || !set.custom) return;
    tileErrorShown = true;
    showToast('Custom layer failed to load — check the URL.');
});

setTileSet(localStorage.getItem('tp-tileset') || 'esri-sat');

/* ---- 3D TERRAIN ---- */
/* Mapzen Terrarium DEM tiles from AWS (keyless, CORS ok). The sources are registered at map load but
   no tile is requested until terrain or hillshade is switched on. Independent of the chosen imagery. */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
let terrainOn = localStorage.getItem('tp-terrain') === '1';

function setTerrain(on) {
    terrainOn = on;
    localStorage.setItem('tp-terrain', on ? '1' : '0');
    applyMapSettings();
    syncMapPanel();   // the Height slider depends on it
}

/* ---- MAP SETTINGS: how the terrain looks and what the camera may do ----
   Kept in this browser, for the map as a whole: not per image and not exported.
   Field of view and camera limits after briatlon's map options. */
const MAP_SETTINGS_KEY = 'tp-map-settings';
const MAP_SETTING_RANGES = {   // [min, max, default]
    exaggeration: [1, 3, 1],
    fov:          [10, 90, 37],     // vertical field of view in degrees; MapLibre's own default is 36.87
    maxPitch:     [0, 90, 90],
    minZoom:      [0, 20, 0],
    maxZoom:      [0, 20, 20],
    buildingsOpacity: [20, 100, 80]   // percent
};

function loadMapSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(MAP_SETTINGS_KEY)) || {}; } catch (err) { /* start from the defaults */ }
    const s = { hillshade: saved.hillshade === true, buildings: saved.buildings === true };
    Object.entries(MAP_SETTING_RANGES).forEach(([key, [min, max, def]]) => {
        s[key] = finite(saved[key]) ? Math.min(max, Math.max(min, saved[key])) : def;
    });
    if (s.minZoom > s.maxZoom) { s.minZoom = MAP_SETTING_RANGES.minZoom[2]; s.maxZoom = MAP_SETTING_RANGES.maxZoom[2]; }
    return s;
}

let mapSettings = loadMapSettings();

function applyMapSettings() {
    const s = mapSettings;
    map.setVerticalFieldOfView(s.fov);
    map.setMaxPitch(s.maxPitch);
    map.setMinZoom(0);            // out of the way first: a new maximum below the old minimum would be refused
    map.setMaxZoom(s.maxZoom);
    map.setMinZoom(s.minZoom);
    if (!mapReady) return;        // terrain and hillshade need the style; applied again from the map's load handler
    map.setTerrain(terrainOn ? { source: 'dem', exaggeration: s.exaggeration } : null);
    map.setLayoutProperty('hillshade', 'visibility', s.hillshade ? 'visible' : 'none');
    applyBuildings();
}

/* ---- 3D BUILDINGS ----
   OpenStreetMap buildings as blocks on top of any basemap, to line up rooflines and skylines on the
   tilted map. Vector tiles from OpenFreeMap (keyless, OpenMapTiles schema). Source and layer exist
   only while the switch is on: off removes them, so that server is not contacted at all. */
const BUILDINGS_TILEJSON = 'https://tiles.openfreemap.org/planet';
const BUILDINGS_MIN_ZOOM = 13;   // the tiles carry buildings from here on
const BUILDING_FALLBACK_HEIGHT = 5;   // metres, for the rare building without a height in the tiles

function applyBuildings() {
    const s = mapSettings;
    if (!s.buildings) {
        if (map.getLayer('buildings'))  map.removeLayer('buildings');
        if (map.getSource('buildings')) map.removeSource('buildings');
        return;
    }
    if (!map.getSource('buildings')) map.addSource('buildings', { type: 'vector', url: BUILDINGS_TILEJSON });
    if (!map.getLayer('buildings')) {
        map.addLayer({
            id: 'buildings', type: 'fill-extrusion', source: 'buildings', 'source-layer': 'building',
            minzoom: BUILDINGS_MIN_ZOOM,
            filter: ['!=', ['get', 'hide_3d'], true],   // outlines that only repeat the parts of a detailed building
            paint: {
                'fill-extrusion-color':  '#d9d9d6',
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], BUILDING_FALLBACK_HEIGHT],
                'fill-extrusion-base':   ['coalesce', ['get', 'render_min_height'], 0],
                'fill-extrusion-vertical-gradient': true   // sides a little darker than the roofs
            }
        }, 'ellipse');   // above basemap and hillshade, below rays and ellipse
    }
    map.setPaintProperty('buildings', 'fill-extrusion-opacity', s.buildingsOpacity / 100);
}

function setMapSetting(key, value) {
    mapSettings[key] = value;
    // The zoom limits push each other instead of crossing
    if (key === 'minZoom' && value > mapSettings.maxZoom) mapSettings.maxZoom = value;
    if (key === 'maxZoom' && value < mapSettings.minZoom) mapSettings.minZoom = value;
    localStorage.setItem(MAP_SETTINGS_KEY, JSON.stringify(mapSettings));
    applyMapSettings();
    syncMapPanel();
}

/* Full-frame focal length with the same vertical field of view (24 mm sensor height, landscape):
   set it to the lens in a photo's EXIF and the tilted map shows the scene with that perspective. */
function fovToFocal(fov) { return 12 / Math.tan(fov * DEG / 2); }

/* ---- MAP PANEL: terrain, buildings and camera in one place ---- */
/* Opens from the ☰ button in the map bar under the map header. It stays open while its controls are
   used; a click on the map or outside it, Esc or the button closes it.
   The basemap has a dropdown of its own in the map header (see BASEMAP DROPDOWN). */
let layerMenu = null;      // the panel
let layerList = null;      // the basemap dropdown's list, redrawn by renderLayerMenu
const mapPanelSync = [];   // one function per control: bring it in line with the settings

function syncMapPanel() { mapPanelSync.forEach(fn => fn()); }

function buildLayerSwitcher() {
    const wrap = document.getElementById('layer-switcher-wrap');

    const btn = el('button', 'layer-burger', wrap);
    btn.type = 'button';
    btn.title = 'Terrain, buildings and camera';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="1.5" y1="5" x2="14.5" y2="5"/><line x1="1.5" y1="11" x2="14.5" y2="11"/>
        <circle cx="5.5" cy="5" r="2" fill="#151515"/><circle cx="10.5" cy="11" r="2" fill="#151515"/>
    </svg>`;

    const menu = el('div', 'layer-menu map-panel', wrap);
    menu.style.display = 'none';
    layerMenu = menu;

    const section = (title) => {
        el('div', 'map-panel-title', menu).textContent = title;
        return el('div', 'map-panel-body', menu);
    };
    const row = (parent, label, title) => {
        const r = el('div', 'adjust-row', parent);
        if (title) r.title = title;
        const id = `map-opt-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const l = el('label', '', r);
        l.textContent = label;
        l.htmlFor = id;
        return { r, id };
    };
    const addSwitch = (parent, label, title, get, set) => {
        const { r, id } = row(parent, label, title);
        const input = el('input', 'adjust-switch', r);
        input.type = 'checkbox'; input.id = id; input.setAttribute('role', 'switch');
        const val = el('span', 'adjust-val', r);
        input.onchange = () => set(input.checked);
        mapPanelSync.push(() => { input.checked = get(); val.textContent = get() ? 'On' : 'Off'; });
    };
    /* A slider for one map setting; double-click puts it back to its default */
    const addSlider = (parent, label, title, key, step, fmt, enabled = () => true) => {
        const [min, max, def] = MAP_SETTING_RANGES[key];
        const { r, id } = row(parent, label, title);
        const input = el('input', '', r);
        input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = step;
        const val = el('span', 'adjust-val', r);
        input.oninput    = () => setMapSetting(key, +input.value);
        input.ondblclick = () => { input.blur(); setMapSetting(key, def); };
        mapPanelSync.push(() => {
            if (document.activeElement !== input) input.value = mapSettings[key];   // not under the dragging thumb
            val.textContent = fmt(mapSettings[key]);
            input.disabled = !enabled();
            r.classList.toggle('disabled', !enabled());
        });
    };

    // Terrain
    const terrain = section('Terrain');
    addSwitch(terrain, '3D terrain', 'Elevation tiles from AWS. Tilt the map (Ctrl+drag) to see the relief.',
        () => terrainOn, setTerrain);
    addSlider(terrain, 'Height', 'How much the relief is exaggerated. Needs 3D terrain.',
        'exaggeration', 0.1, v => `${v.toFixed(1)}×`, () => terrainOn);
    addSwitch(terrain, 'Hillshade', 'Shades the slopes on top of the basemap, with or without 3D terrain. Uses the same elevation tiles.',
        () => mapSettings.hillshade, on => setMapSetting('hillshade', on));

    // Buildings
    const buildings = section('Buildings');
    addSwitch(buildings, '3D buildings', `OpenStreetMap buildings as 3D blocks, from zoom ${BUILDINGS_MIN_ZOOM}. Loaded from OpenFreeMap while this is on. Tilt the map (Ctrl+drag) to see them rise.`,
        () => mapSettings.buildings, on => setMapSetting('buildings', on));
    addSlider(buildings, 'Opacity', 'How much of the basemap shows through the blocks',
        'buildingsOpacity', 5, v => `${v}%`, () => mapSettings.buildings);

    // Camera
    const camera = section('Camera');
    addSlider(camera, 'Field of view', 'Strength of the perspective when the map is tilted. The focal length is the full-frame lens with the same vertical angle.',
        'fov', 1, v => `${v}° · ${Math.round(fovToFocal(v))} mm`);
    addSlider(camera, 'Max tilt', 'How far the map can be tilted', 'maxPitch', 1, v => `${v}°`);
    addSlider(camera, 'Min zoom', 'How far out the map can zoom', 'minZoom', 1, v => `${v}`);
    addSlider(camera, 'Max zoom', 'How far in the map can zoom', 'maxZoom', 1, v => `${v}`);

    const actions = el('div', 'map-panel-actions', camera);
    const action = (label, title, fn) => {
        const b = el('button', '', actions);
        b.type = 'button'; b.textContent = label; b.title = title;
        b.onclick = fn;
        return b;
    };
    action('North up', 'Turn the map to north; the tilt stays',  () => map.easeTo({ bearing: 0 }));
    action('Top down', 'Look straight down; the bearing stays', () => map.easeTo({ pitch: 0 }));
    action('Reset', 'All sliders back to their defaults: terrain height, buildings opacity, field of view and the camera limits', () => {
        Object.keys(MAP_SETTING_RANGES).forEach(key => { mapSettings[key] = MAP_SETTING_RANGES[key][2]; });
        setMapSetting('fov', mapSettings.fov);
    }).classList.add('map-panel-reset');

    renderLayerMenu();
    syncMapPanel();

    const close = () => { menu.style.display = 'none'; };
    btn.onclick = () => {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        if (menu.style.display !== 'none') { hideHelp(); closeBasemapMenu(); closeGisMenu(); }   // only one of them is open
    };
    map.on('click', close);
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target) && e.target.isConnected) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    menu.addEventListener('wheel', (e) => e.stopPropagation());   // scrolling the panel must not zoom anything under it
}

/* ---- BASEMAP DROPDOWN ----
   In the map header, where the title used to be: the button shows the active basemap, the list has
   the built-in layers, then the custom ones with edit and remove, then "add". Picking one closes it. */
const basemapBtn = document.getElementById('btn-basemap');
layerList = document.getElementById('basemap-menu');

function closeBasemapMenu() {
    layerList.style.display = 'none';
    basemapBtn.setAttribute('aria-expanded', 'false');
}

basemapBtn.onclick = () => {
    if (layerList.style.display !== 'none') { closeBasemapMenu(); return; }
    layerList.style.display = 'block';
    basemapBtn.setAttribute('aria-expanded', 'true');
    hideHelp();
    closeGisMenu();
    if (layerMenu) layerMenu.style.display = 'none';
};
document.addEventListener('click', (e) => {
    if (!document.getElementById('basemap-wrap').contains(e.target) && e.target.isConnected) closeBasemapMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBasemapMenu(); });
layerList.addEventListener('wheel', (e) => e.stopPropagation());

function renderLayerMenu() {
    const list = layerList;
    list.innerHTML = '';
    const active = allTileSets().find(s => s.id === activeTileSetId) || TILE_SETS[0];
    document.getElementById('basemap-name').textContent = active.label;
    basemapBtn.title = `Basemap: ${active.label}`;

    const addItem = (set) => {
        const item = el('div', 'layer-item', list);
        item.dataset.id = set.id;
        if (set.id === activeTileSetId) item.classList.add('active');
        item.onclick = () => { setTileSet(set.id); renderLayerMenu(); closeBasemapMenu(); };
        if (!set.custom) { item.textContent = set.label; return; }

        item.classList.add('layer-item-custom');
        const label = el('span', 'layer-label', item);
        label.textContent = set.label;
        const edit = el('button', 'layer-action', item);
        edit.title = 'Edit layer';
        edit.textContent = '✎';
        edit.onclick = (e) => { e.stopPropagation(); closeBasemapMenu(); openLayerModal(set.id); };
        const del = el('button', 'layer-action layer-action-delete', item);
        del.title = 'Remove layer';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); removeCustomLayer(set.id); };
    };

    TILE_SETS.forEach(addItem);
    if (customLayers.length) el('div', 'layer-divider', list);
    allTileSets().filter(s => s.custom).forEach(addItem);

    const add = el('div', 'layer-item layer-add', list);
    add.textContent = '＋ Add custom layer…';
    add.onclick = () => { closeBasemapMenu(); openLayerModal(null); };
}

function removeCustomLayer(id) {
    customLayers = customLayers.filter(c => c.id !== id);
    saveCustomLayers();
    if (activeTileSetId === id) setTileSet('esri-sat');
    renderLayerMenu();
}

buildLayerSwitcher();
applyMapSettings();   // camera settings now; terrain and hillshade follow when the style has loaded

/* ---- CUSTOM LAYER POPUP ---- */
const layerModal      = document.getElementById('layer-modal');
const layerForm       = document.getElementById('layer-form');
const layerNameInput  = document.getElementById('layer-name');
const layerUrlInput   = document.getElementById('layer-url');
const layerUrlHint    = document.getElementById('layer-url-hint');
const btnLayerSave    = document.getElementById('btn-layer-save');
let editingLayerId    = null;

function openLayerModal(id) {
    editingLayerId = id;
    const existing = customLayers.find(c => c.id === id);
    document.getElementById('layer-modal-title').textContent = existing ? 'Edit custom layer' : 'Add custom layer';
    btnLayerSave.textContent = existing ? 'Save' : 'Add';
    layerNameInput.value = existing ? existing.name : '';
    layerUrlInput.value  = existing ? existing.url  : '';
    validateLayerForm();
    layerModal.style.display = 'flex';
    layerNameInput.focus();
}

function closeLayerModal() {
    layerModal.style.display = 'none';
    editingLayerId = null;
}

function validateLayerForm() {
    const url = layerUrlInput.value.trim();
    const urlOk = isValidTileUrl(url);
    layerUrlHint.classList.toggle('field-error', url !== '' && !urlOk);
    btnLayerSave.disabled = !(urlOk && layerNameInput.value.trim());
}

layerNameInput.addEventListener('input', validateLayerForm);
layerUrlInput.addEventListener('input', validateLayerForm);

layerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (btnLayerSave.disabled) return;
    const name = layerNameInput.value.trim();
    const url  = layerUrlInput.value.trim();
    const existing = customLayers.find(c => c.id === editingLayerId);
    let id;
    if (existing) {
        existing.name = name;
        existing.url  = url;
        id = existing.id;
    } else {
        id = 'custom-' + Date.now().toString(36);
        customLayers.push({ id, name, url });
    }
    saveCustomLayers();
    if (!existing || activeTileSetId === id) setTileSet(id);
    renderLayerMenu();
    closeLayerModal();
});

document.getElementById('btn-layer-cancel').onclick = closeLayerModal;
document.getElementById('btn-layer-modal-close').onclick = closeLayerModal;
layerModal.addEventListener('mousedown', (e) => { if (e.target === layerModal) closeLayerModal(); });
layerModal.addEventListener('keydown', (e) => {
    e.stopPropagation();   // keep app shortcuts (E, R, Space, …) from firing behind the popup
    if (e.key === 'Escape') closeLayerModal();
});

/* ============================================================
   COORDINATE SEARCH – paste or type coordinates → numbered pin
   Pins live only in memory: not saved, not part of any session.
   ============================================================ */

/* Parse "52.40, 13.06", "52.4012° N, 13.0645° E", "52°24'04.4"N 13°03'52.4"E"
   and Google Maps links. Returns { lat, lng } or null. */
function parseCoordinates(text) {
    const s = String(text || '').trim();
    if (!s || s.length > 2000) return null;

    if (/^https?:\/\//i.test(s)) {
        const known = parseCoordinateUrl(s);   // Apple, Bing, Yandex, OpenStreetMap, Lookmap, Baidu, Google Earth search, lat=/lon=
        if (known !== undefined) return known;
        const m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
                  s.match(/[?&](?:q|ll|query|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
        return m ? validLatLng(+m[1], +m[2]) : null;
    }

    const mercator = parseWebMercator(s);
    if (mercator) return mercator;

    const norm = s.replace(/[″“”]|''/g, '"').replace(/[′‘’]/g, "'");
    const PART = /(?<![A-Za-z])([NSEW])?\s*([-+]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*)?(?:(\d+(?:\.\d+)?)\s*"\s*)?([NSEW](?![A-Za-z]))?/gi;
    const parts = [];
    for (const m of norm.matchAll(PART)) {
        const [, pre, deg, min, sec, post] = m;
        if ((min && +min >= 60) || (sec && +sec >= 60)) return null;
        const hemi = (pre || post || '').toUpperCase();
        let v = Math.abs(+deg) + (min ? +min / 60 : 0) + (sec ? +sec / 3600 : 0);
        if (deg.startsWith('-') || hemi === 'S' || hemi === 'W') v = -v;
        parts.push({ v, hemi });
    }
    if (parts.length !== 2) return null;

    let [a, b] = parts;
    if (/[EW]/.test(a.hemi) || /[NS]/.test(b.hemi)) [a, b] = [b, a];           // hemisphere letters decide
    else if (!a.hemi && !b.hemi && Math.abs(a.v) > 90 && Math.abs(b.v) <= 90) [a, b] = [b, a]; // lng first
    return validLatLng(a.v, b.v);
}

/* ---- LINKS FROM OTHER MAP SERVICES ----
   Formats after briatlon's coordinatePaste.js. A known service is read by its own rules and the answer
   is final (Yandex writes longitude first, so a generic rule would get it wrong); undefined means
   "not a service known here", and the generic rules in parseCoordinates get their turn. */
function parseCoordinateUrl(s) {
    let url;
    try { url = new URL(s.replace(/\\&/g, '&')); } catch (err) { return null; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const q = url.searchParams, hash = new URLSearchParams(url.hash.slice(1));
    const NUM = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
    const pair = (text, sep = ',', lngFirst = false) => {
        const m = (text || '').match(new RegExp(`^\\s*(${NUM})\\s*${sep}\\s*(${NUM})\\s*$`));
        return m ? validLatLng(+m[lngFirst ? 2 : 1], +m[lngFirst ? 1 : 2]) : null;
    };

    if (host === 'maps.apple.com') return pair(q.get('coordinate') ?? q.get('ll') ?? q.get('q'));
    if (host === 'bing.com')       return pair(q.get('cp'), '~');
    if (/^yandex\.[a-z.]+$/.test(host)) return pair(q.get('ll'), ',', true);
    if (host === 'openstreetmap.org' || host === 'osm.org') {
        if (q.has('mlat') && q.has('mlon')) return pair(`${q.get('mlat')},${q.get('mlon')}`);
        const view = hash.get('map')?.split('/');             // #map=zoom/lat/lng
        return view?.length === 3 ? pair(`${view[1]},${view[2]}`) : null;
    }
    if (host === 'lookmap.skzk.dev') {
        const view  = hash.get('c')?.split('/');              // #c=zoom/lat/lng, optional p=lat/lng
        const point = hash.get('p')?.split('/') ?? view?.slice(1);
        return point?.length === 2 ? pair(point.join(',')) : null;
    }
    if (host === 'map.baidu.com') {
        const m  = url.pathname.match(new RegExp(`^/@(${NUM}),(${NUM})`));   // Baidu's own projected metres
        const ll = m && baiduMercatorToWgs84(+m[1], +m[2]);
        return ll ? validLatLng(ll.lat, ll.lng) : null;
    }
    if (host === 'earth.google.com') {
        const m = url.pathname.match(/^\/web\/search\/([^/]+)/);
        if (m) { try { const p = pair(decodeURIComponent(m[1])); if (p) return p; } catch (err) { /* not a pair */ } }
    }
    if (q.has('lat') && (q.has('lon') || q.has('lng'))) return pair(`${q.get('lat')},${q.get('lon') ?? q.get('lng')}`);
    return undefined;
}

/* Short links carry no coordinates; reading them would mean asking their server where they lead */
function isShortMapLink(text) {
    const m = String(text || '').trim().match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
    if (!m) return false;
    const host = m[1].toLowerCase().replace(/^www\./, '');
    return ['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.apple', 'binged.it', 'bit.ly', 't.co', 'tinyurl.com'].includes(host) ||
           (/^yandex\./.test(host) && /^\/maps\/-\//.test(m[2] || ''));
}
const SHORT_LINK_NOTE = "Short links can't be read here. Open it and copy the full address.";

/* Web Mercator metres (EPSG:3857) as "x, y", with or without a leading @. Only taken when a number is
   far too large for degrees, so it cannot be mistaken for latitude and longitude. */
function parseWebMercator(s) {
    const m = s.match(/^@?\s*([-+]?\d+(?:\.\d+)?)\s*[,;\s]\s*([-+]?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const x = +m[1], y = +m[2], RADIUS = 6378137, MAX = Math.PI * RADIUS;
    if (Math.max(Math.abs(x), Math.abs(y)) <= 1000 || Math.abs(x) > MAX || Math.abs(y) > MAX) return null;
    return validLatLng(Math.atan(Math.sinh(y / RADIUS)) * RAD, x / RADIUS * RAD);
}

/* ---- BAIDU ----
   Baidu Maps shows its own projected coordinates (BD-09 Mercator). This turns them into an approximate
   WGS84 position, in the browser: good to some metres, enough to land on the right spot.
   BD09 conversion adapted from https://github.com/46319943/BD09Convertor (via briatlon's baiduCoordinates.js):

   Copyright (c) 2018 The Python Packaging Authority

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */
const baiduMercatorBands = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const baiduMercatorCoefficients = [[1.410526172116255e-08, 8.98305509648872e-06, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 17337981.2], [-7.435856389565537e-09, 8.983055097726239e-06, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 10260144.86], [-3.030883460898826e-08, 8.98305509983578e-06, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6856817.37], [-1.981981304930552e-08, 8.983055099779535e-06, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4482777.06], [3.09191371068437e-09, 8.983055096812155e-06, 6.995724062e-05, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2555164.4], [2.890871144776878e-09, 8.983055095805407e-06, -3.068298e-08, 7.47137025468032, -3.53937994e-06, -0.02145144861037, -1.234426596e-05, 0.00010322952773, -3.23890364e-06, 826088.5]];

// Convert Baidu's projected coordinates to an approximate WGS84 location locally.
function baiduMercatorToWgs84(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 20037726.38 || Math.abs(y) > 12474104.17) return null;
    const index = baiduMercatorBands.findIndex(band => Math.abs(y) >= band);
    const c = baiduMercatorCoefficients[index];
    const t = Math.abs(y) / c[9];
    let lat = 0;
    for (let power = 0; power <= 6; power++) lat += c[power + 2] * t ** power;
    lat *= y < 0 ? -1 : 1;
    let lng = (c[0] + c[1] * Math.abs(x)) * (x < 0 ? -1 : 1);
    // Remove BD09's offset to obtain GCJ02.
    const pi = Math.PI, xPi = pi * 3000 / 180;
    const bx = lng - 0.0065, by = lat - 0.006;
    const distance = Math.hypot(bx, by) - 0.00002 * Math.sin(by * xPi);
    const angle = Math.atan2(by, bx) - 0.000003 * Math.cos(bx * xPi);
    lng = distance * Math.cos(angle);
    lat = distance * Math.sin(angle);
    if (lng <= 73.66 || lng >= 135.05 || lat <= 3.86 || lat >= 53.55) return { lat, lng };
    // Approximate the inverse GCJ02 offset; accuracy is suitable for viewport navigation.
    const dx = lng - 105, dy = lat - 35;
    const wave = (a, b) => (20 * Math.sin(6 * a * pi) + 20 * Math.sin(2 * a * pi) +
        20 * Math.sin(b * pi) + 40 * Math.sin(b / 3 * pi)) * 2 / 3;
    let dlat = -100 + 2 * dx + 3 * dy + 0.2 * dy ** 2 + 0.1 * dx * dy + 0.2 * Math.sqrt(Math.abs(dx));
    dlat += wave(dx, dy) + (160 * Math.sin(dy / 12 * pi) + 320 * Math.sin(dy / 30 * pi)) * 2 / 3;
    let dlng = 300 + dx + 2 * dy + 0.1 * dx ** 2 + 0.1 * dx * dy + 0.1 * Math.sqrt(Math.abs(dx));
    dlng += wave(dx, dx) + (150 * Math.sin(dx / 12 * pi) + 300 * Math.sin(dx / 30 * pi)) * 2 / 3;
    const radians = lat * pi / 180;
    const magic = 1 - 0.00669342162296594323 * Math.sin(radians) ** 2;
    const root = Math.sqrt(magic);
    dlat = dlat * 180 / (6378245 * (1 - 0.00669342162296594323) / (magic * root) * pi);
    dlng = dlng * 180 / (6378245 / root * Math.cos(radians) * pi);
    return { lat: lat - dlat, lng: lng - dlng };
}

function validLatLng(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

const fmtCoords = (p) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

let searchPins = [];          // { lat, lng, marker }
let searchList = null;
let searchInput = null;

/* Gentle flight: keep the user's zoom unless they are zoomed out further than town level */
function flyToPin(p) {
    const z = map.getZoom() >= 11 ? map.getZoom() : 13;
    const c = map.getContainer();
    if (!c.clientWidth || !c.clientHeight) return jumpTo(p, z);   // flyTo can't animate a hidden map
    map.flyTo({ center: [p.lng, p.lat], zoom: z, duration: 1200 });
}

function addSearchPin(coords) {
    const key = fmtCoords(coords);
    const existing = searchPins.find(p => fmtCoords(p) === key);
    if (existing) { flyToPin(existing); return; }

    const pin = { lat: coords.lat, lng: coords.lng, marker: null };
    const node = el('div', 'search-pin');
    node.textContent = searchPins.length + 1;
    node.onclick = () => flyToPin(pin);
    pin.marker = new maplibregl.Marker({ element: node }).setLngLat([pin.lng, pin.lat]).addTo(map);
    searchPins.push(pin);
    renderSearchList();
    flyToPin(pin);
}

function removeSearchPin(i) {
    searchPins[i].marker.remove();
    searchPins.splice(i, 1);
    searchPins.forEach((p, n) => { p.marker.getElement().textContent = n + 1; });   // keep numbers in step with the list
    renderSearchList();
}

function renderSearchList() {
    searchList.innerHTML = '';
    searchPins.forEach((p, i) => {
        const row = el('div', 'search-row', searchList);
        row.title = 'Go to this location';
        row.innerHTML = `<span class="search-num">${i + 1}</span><span class="search-coords">${fmtCoords(p)}</span>`;
        row.onclick = () => flyToPin(p);
        const del = el('button', 'search-del', row);
        del.title = 'Remove pin';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); removeSearchPin(i); };
    });
    if (searchPins.length > 1) {
        const clear = el('div', 'search-clear', searchList);
        clear.textContent = 'Clear all';
        clear.onclick = () => { searchPins.forEach(p => p.marker.remove()); searchPins = []; renderSearchList(); };
    }
    searchList.style.display = searchPins.length ? 'block' : 'none';
}

/* A bad entry is cleared and the message takes the placeholder's place, in red, until the next keystroke */
const SEARCH_PLACEHOLDER = 'Paste coordinates…';
const SEARCH_ERROR       = 'Not recognised — try 52.40, 13.06';
const SEARCH_TITLE       = 'Paste or type coordinates or a map link, then press Enter. Ctrl+V anywhere works too.';
function setSearchError(on, message = SEARCH_ERROR) {
    searchInput.classList.toggle('search-input-error', on);
    if (on) searchInput.value = '';
    searchInput.placeholder = on ? message : SEARCH_PLACEHOLDER;
    searchInput.title = on ? message : SEARCH_TITLE;   // the box may be too narrow for the whole message
}

/* Lives in the map bar; the pin list floats top-left on the map */
function buildCoordSearch() {
    const wrap = document.getElementById('coord-search');

    searchInput = el('input', 'coord-search-input', wrap);
    searchInput.type = 'text';
    searchInput.placeholder = SEARCH_PLACEHOLDER;
    searchInput.spellcheck = false;
    searchInput.autocomplete = 'off';
    searchInput.title = SEARCH_TITLE;

    searchList = el('div', 'search-list', document.getElementById('map-container'));
    searchList.style.display = 'none';

    const submit = (text) => {
        const c = parseCoordinates(text);
        if (!c) { setSearchError(true, isShortMapLink(text) ? SHORT_LINK_NOTE : SEARCH_ERROR); return false; }
        setSearchError(false);
        searchInput.value = '';
        searchInput.blur();
        addSearchPin(c);
        return true;
    };

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); submit(searchInput.value); }
        if (e.key === 'Escape') { searchInput.value = ''; setSearchError(false); searchInput.blur(); }
    });
    searchInput.addEventListener('input', () => setSearchError(false));
    searchInput.addEventListener('paste', (e) => {
        // a clean paste into an empty box jumps straight away; otherwise let it paste for editing
        const text = e.clipboardData && e.clipboardData.getData('text');
        if (searchInput.value === '' && parseCoordinates(text)) { e.preventDefault(); submit(text); }
    });
}
buildCoordSearch();

/* Ctrl+V anywhere on the page (outside text fields): an image in the clipboard opens as a photo,
   text does the same as the search box. An image wins over text ("Copy image" on a web page carries both).
   Only what is pasted is read, on the paste itself — the page never reads the clipboard on its own. */
document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    const image = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (image) { e.preventDefault(); openPastedImage(image); return; }
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!text || !text.trim()) return;
    const c = parseCoordinates(text);
    if (!c) return showToast(isShortMapLink(text) ? SHORT_LINK_NOTE : 'No coordinates found in clipboard.');
    e.preventDefault();
    setSearchError(false);
    addSearchPin(c);
});

/* ============================================================
   COLOUR PALETTE
   Sessions each get a base colour; lines within a session step
   through the same palette offset by the session's position.
   ============================================================ */
const LINE_COLOURS = [
    '#ffe135', '#ff6b35', '#7fff6b', '#ff35c8',
    '#35ffe1', '#00aaff', '#b535ff', '#ff3535'
];

/* The lowest colour slot no session has yet; with all slots taken, the lowest of the least used ones
   (a loop that waited for a free slot never ended from the ninth image on) */
function nextFreeColourIndex() {
    const count = new Array(LINE_COLOURS.length).fill(0);
    (sessions || []).forEach(s => { if (count[s.colourIndex] !== undefined) count[s.colourIndex]++; });
    return count.indexOf(Math.min(...count));
}

function sessionColourIndex(sessionIdx) {
    return sessions[sessionIdx]?.colourIndex ?? sessionIdx % LINE_COLOURS.length;
}

function lineColour(lineIdx, sessionIdx = activeSessionIndex) {
    return LINE_COLOURS[(sessionColourIndex(sessionIdx) * 2 + lineIdx) % LINE_COLOURS.length];
}

/* Colour of a line of the active session: its own (the EXIF ray) or the palette's */
function activeLineColour(lIdx) {
    const line = sess().lines[lIdx];
    return (line && line.colour) || lineColour(lIdx, activeSessionIndex);
}

/* Now both map and LINE_COLOURS exist — safe to create the first session */
sessions = [createSession('Image 1')];

/* ============================================================
   UI HELPERS
   ============================================================ */
function updateUI() {
    map.getCanvas().style.cursor = (state.mode === 'map-point' || measuring()) ? 'crosshair' : '';
    updatePlacingTag();
    syncMarkerSelection();

    if (state.mode === 'horizon') {
        btnHorizon.classList.add('active-mode');
        btnHorizon.title = 'Click two points on the image to define the horizon. ESC to cancel.';
    } else if (sess().view.rotation !== 0) {
        btnHorizon.classList.add('horizon-active');
        btnHorizon.classList.remove('active-mode');
        btnHorizon.title = `Rotation: ${sess().view.rotation.toFixed(1)}° — click to reset`;
    } else {
        btnHorizon.classList.remove('active-mode', 'horizon-active');
        btnHorizon.title = sess().imgElement ? 'Set horizon correction' : LOAD_FIRST;
    }
    btnHorizon.disabled = !sess().imgElement;
    btnAddLine.disabled = !sess().imgElement;

    historyCommit();
    updateLineManager();
    updateGuide();
    scheduleAutosave();
}

/* ============================================================
   STEP GUIDE – vertical icon column on the image, next step glows,
   a one-line hint in a bar at the bottom of the image. Derived from state on every updateUI.
   ============================================================ */
const GUIDE_STEPS = [
    { title: 'Load an image',            key: '',    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>' },
    { title: 'Add a line',               key: 'newLine', icon: '<line x1="12" y1="3" x2="12" y2="21"/>' },
    { title: 'Drag the line onto a feature', key: '', icon: '<line x1="12" y1="3" x2="12" y2="21"/><path d="M4 12h5M15 12h5"/><path d="M6 9l-3 3 3 3M18 9l3 3-3 3"/>' },
    { title: 'Click the line to place P1 and P2', key: '', icon: '<line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/>' },
    { title: 'Mark the points on the map', key: 'nextPoint', icon: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>' },
    { title: 'Add a second line',         key: 'newLine', icon: '<line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/>' },
    { title: 'Position found',            key: '',    icon: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' }
];

const guideEl   = document.getElementById('guide');
const imageHint = document.getElementById('image-hint');

/* Which step is next, the hint for the bottom bar, and overall progress 0–1.
   Progress counts finished work (image, then per line: created, aligned, 2 points, 2 map points,
   for the two lines a position needs), so the rail only ever grows while steps 2–5 repeat. */
function guideStatus() {
    const s = sess();
    const UNITS_PER_LINE = 6, TOTAL = 1 + 2 * UNITS_PER_LINE;
    let done = s.imgElement ? 1 : 0;
    s.lines.slice(0, 2).forEach(l => {
        done += 1 + (l.pristine ? 0 : 1) + Math.min(l.points.length, 2) + l.points.filter(p => p.geo).length;
    });
    const progress = Math.min(done / TOTAL, 1);

    if (!s.imgElement) return { idx: 0, progress, hint: 'Drop or paste an image, or browse' };
    if (s.lines.length === 0) return { idx: 1, progress, hint: `Press ${keyFor('newLine')} for a new line` };

    // The first line that still needs work drives the guide
    const lIdx = s.lines.findIndex(l => l.points.length < 2 || l.points.some(p => !p.geo));
    if (lIdx !== -1) {
        const line = s.lines[lIdx], L = `L${lIdx + 1}`;
        if (line.pristine) return { idx: 2, progress, hint: `Drag ${L} onto a road, shadow or edge` };
        if (line.points.length < 2) {
            return state.activeLineIndex === lIdx
                ? { idx: 3, progress, hint: `Click ${L} to place P${line.points.length + 1}` }
                : { idx: 3, progress, hint: `Click ${L} to select it` };
        }
        const pIdx = line.points.findIndex(p => !p.geo);
        if (state.mode === 'map-point' && state.mapPointTarget) {
            const t = state.mapPointTarget;
            return { idx: 4, progress, pressed: true, hint: `Click the map to place L${t.lineIndex + 1} · P${t.pointIndex + 1}` };
        }
        return { idx: 4, progress, hint: `Press ${keyFor('nextPoint')} to place ${L} · P${pIdx + 1} on the map` };
    }
    if (s.lines.length < 2) return { idx: 5, progress, hint: `Press ${keyFor('newLine')} for a second line` };
    if (s.lines.length === 2) return { idx: 6, progress, hint: 'Position found · a third line adds an ellipse' };
    return { idx: 6, progress, hint: 'Done · more lines tighten the ellipse' };
}

function buildGuide() {
    guideEl.innerHTML = '';
    const rail = el('div', 'guide-rail', guideEl);
    el('div', 'guide-rail-fill', rail);
    GUIDE_STEPS.forEach((st, i) => {
        const key = st.key ? keyFor(st.key) : '';   // the step's action, as a key of the active layout
        const b = el('button', 'guide-step' + (key ? '' : ' no-key'), guideEl);
        b.type = 'button';
        b.title = st.title + (key ? ` (${key})` : '');
        b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${st.icon}</svg>` +
                      (key ? `<span class="guide-key">${key}</span>` : '');
        b.onclick = () => guideAction(i);
    });
}

/* Clicking the current step does what its key does */
function guideAction(i) {
    const { idx } = guideStatus();
    if (i !== idx) return;
    if (i === 1 || i === 5) { btnAddLine.click(); return; }
    const s = sess();
    if (i === 3) {   // select the line that still needs points; the points themselves are clicks on the line
        const lIdx = s.lines.findIndex(l => l.points.length < 2);
        if (lIdx !== -1) selectLine(lIdx);
        return;
    }
    if (i === 4) {
        const lIdx = s.lines.findIndex(l => l.points.length >= 2 && l.points.some(p => !p.geo));
        if (lIdx !== -1) startMapPoint(lIdx, s.lines[lIdx].points.findIndex(p => !p.geo));
    }
}

function updateGuide() {
    if (!guideEl.querySelector('.guide-rail-fill')) return;   // not built yet
    const { idx, hint, progress, pressed } = guideStatus();
    guideEl.querySelectorAll('.guide-step').forEach((b, i) => {
        b.classList.toggle('done',    i < idx || (progress >= 1 && i !== idx));   // a third line repeats 2–5 but the goal is reached
        b.classList.toggle('current', i === idx);
        b.classList.toggle('pressed', i === idx && !!pressed);                    // key already pressed, step still running
    });
    guideEl.querySelector('.guide-rail-fill').style.height = `${progress * 100}%`;
    imageHint.textContent = hint;
}

buildGuide();
updateGuide();

function updateLineManager() {
    lineBar.querySelectorAll('.line-item, .map-hint').forEach(node => node.remove());

    sess().lines.forEach((line, lIdx) => {
        const colour = line.colour || lineColour(lIdx, activeSessionIndex);
        const active = lIdx === state.activeLineIndex;

        const deg = lineBearing(sess(), line);
        const bearingLabel = deg !== null ? `<span class="line-bearing">${String(deg).padStart(3, '0')}°</span>` : '';

        const item = document.createElement('div');
        item.className = 'line-item' + (active ? ' active-line' : '');
        item.style.setProperty('--lc', colour);

        const header = document.createElement('div');
        header.className = 'line-header';
        header.innerHTML =
            `<span class="line-dot"></span>` +
            `<span class="line-label">L${lIdx + 1}</span>` +
            bearingLabel +
            `<button class="btn-delete" title="Delete line" data-action="delete-line" data-idx="${lIdx}">×</button>`;
        header.onclick = () => selectLine(lIdx);
        item.appendChild(header);

        if (active && line.points.length > 0) {
            const ptBox = document.createElement('div');
            ptBox.className = 'point-manager';

            line.points.forEach((pt, pIdx) => {
                const hasGeo = !!(pt.geo);
                const ptItem = document.createElement('div');
                const sel = state.selectedPoint;
                ptItem.className = 'point-item' + (hasGeo ? ' has-geo' : '') +
                                   (sel && sel.lineIndex === lIdx && sel.pointIndex === pIdx ? ' selected' : '');

                const isTarget = state.mode === 'map-point'
                    && state.mapPointTarget
                    && state.mapPointTarget.lineIndex === lIdx
                    && state.mapPointTarget.pointIndex === pIdx;

                ptItem.title = hasGeo ? 'Re-place on map' : 'Place on map';
                const iconStyle = isTarget ? `style="color:${escHtml(colour)}"` : '';
                const geoIcon = hasGeo
                    ? `<svg class="pt-geo-icon ${isTarget ? 'geo-active' : ''}" ${iconStyle} viewBox="0 0 24 24" fill="currentColor">
                           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
                       </svg>`
                    : `<svg class="pt-geo-icon ${isTarget ? 'geo-active' : ''}" ${iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                           <circle cx="12" cy="12" r="10"/>
                           <line x1="2" y1="12" x2="22" y2="12"/>
                           <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                       </svg>`;
                ptItem.innerHTML =
                    `<span class="pt-label">P${pIdx + 1}</span>` +
                    geoIcon +
                    `<button class="btn-delete" data-action="delete-point" data-lidx="${lIdx}" data-pidx="${pIdx}">×</button>`;
                ptItem.onclick = () => { state.selectedPoint = { lineIndex: lIdx, pointIndex: pIdx }; startMapPoint(lIdx, pIdx); };
                ptBox.appendChild(ptItem);
            });

            item.appendChild(ptBox);
        }

        lineBar.insertBefore(item, document.getElementById('line-bar-end'));
    });

    if (state.mode === 'map-point' && state.mapPointTarget) {
        const { lineIndex, pointIndex } = state.mapPointTarget;
        const c = activeLineColour(lineIndex);
        const hint = document.createElement('div');
        hint.className = 'map-hint';
        hint.style.cssText = `color:${c}; border-color:${c}55; background:${c}18;`;
        hint.textContent = `Click map → L${lineIndex + 1} P${pointIndex + 1}`;
        lineBar.insertBefore(hint, document.getElementById('line-bar-end'));
    }
}

/* ============================================================
   LINE / POINT LOGIC
   ============================================================ */
function deleteLine(idx) {
    clearMapObjectsForLine(idx);
    sess().lines.splice(idx, 1);
    sess().mapObjects.geoMarkers.splice(idx, 1);
    // The line numbers shift: a pending map point would land on another line, so it is dropped
    if (state.mapPointTarget) {
        state.mapPointTarget = null;
        if (state.mode === 'map-point') state.mode = 'drag-line';
    }
    state.selectedPoint = null;
    if (idx < state.activeLineIndex) state.activeLineIndex--;   // keep the same line active
    state.activeLineIndex = Math.min(state.activeLineIndex, sess().lines.length - 1);
    if (state.activeLineIndex === -1 && state.mode !== 'horizon') state.mode = 'idle';
    sess().lines.forEach((_, lIdx) => rebuildMapForLine(lIdx));
    recomputeIntersection();
    render(); updateUI();
}

function deletePoint(lIdx, pIdx) {
    sess().lines[lIdx].points.splice(pIdx, 1);
    if (state.mode === 'map-point' && state.mapPointTarget &&
        state.mapPointTarget.lineIndex === lIdx) {
        state.mode = 'drag-line';
        state.mapPointTarget = null;
    }
    state.selectedPoint = null;
    rebuildMapForLine(lIdx);
    recomputeIntersection();
    render(); updateUI();
}

/* The next map click places this point. Runs by itself once a line has its second point,
   and from F, the point pills and the step guide. */
function startMapPoint(lIdx, pIdx) {
    clearMeasure();   // the next map click belongs to the point, not to a measurement
    state.activeLineIndex = lIdx;
    state.mode = 'map-point';
    state.mapPointTarget = { lineIndex: lIdx, pointIndex: pIdx };
    render(); updateUI();
}

/* Work on the line whose point is waiting for its map click keeps the placement going;
   turning to another line, or clicking the photo next to the lines, cancels it. */
function keepPlacement(lIdx) {
    if (state.mode === 'map-point' && state.mapPointTarget && state.mapPointTarget.lineIndex === lIdx) return;
    state.mapPointTarget = null;
    if (state.mode === 'map-point') state.mode = 'drag-line';
}

function selectLine(lIdx) {
    keepPlacement(lIdx);
    state.activeLineIndex = lIdx;
    state.selectedPoint = null;
    if (state.mode !== 'map-point') state.mode = 'drag-line';
    render(); updateUI();
}

/* A click on the active line: P1, then P2. With P2 the map placement starts by itself. */
function addPhotoPoint(lIdx, y) {
    const line = sess().lines[lIdx];
    if (!line || line.points.length >= 2) return;
    line.points.push({ y: Math.max(0, Math.min(canvas.height, y)), geo: null });
    line.pristine = false;
    const unplaced = line.points.findIndex(p => !p.geo);
    if (line.points.length === 2 && unplaced !== -1) return startMapPoint(lIdx, unplaced);
    render(); updateUI();
}

/* Where the mouse is over the photo panel, or null when it is elsewhere (see addLine) */
let photoCursor = null;
container.addEventListener('mousemove',  (e) => { photoCursor = { clientX: e.clientX, clientY: e.clientY }; });
container.addEventListener('mouseleave', () => { photoCursor = null; });

/* atCursor: the E key puts the line under the mouse when that is over the photo.
   Otherwise, and for the button and the step guide, it goes to the centre of the visible photo. */
function addLine(atCursor = false) {
    if (photoCollapsed()) return;   // nowhere to put it while the photo side is hidden
    if (!sess().imgElement) return showToast("Drop an image first.");
    if (sess().lines.length >= MAX_LINES) return showToast(`Maximum of ${MAX_LINES} lines per image.`);
    const v  = sess().view;
    const cr = container.getBoundingClientRect();
    const x  = (atCursor && photoCursor) ? clientToImage(photoCursor).x : (cr.width / 2 - v.tx) / v.scale;
    sess().lines.push({ x: Math.max(0, Math.min(canvas.width, x)), points: [], pristine: true });
    state.activeLineIndex = sess().lines.length - 1;
    state.mode = 'drag-line';
    render(); updateUI();
}

btnAddLine.onclick = () => addLine();

btnHorizon.onclick = () => {
    if (!sess().imgElement) return;
    state.mapPointTarget = null;
    state.selectedPoint  = null;
    sess().horizonPoints = [];
    if (sess().view.rotation !== 0) {
        sess().view.rotation = 0;
        state.mode = state.activeLineIndex !== -1 ? 'drag-line' : 'idle';
    } else {
        state.mode = 'horizon';
        state.activeLineIndex = -1;   // no line is active while levelling, so the mode button reads Idle
    }
    render(); updateUI();
};

/* Esc with a menu or card open closes just that, and leaves the selection or point placement alone.
   Runs before every other key handler (capture on window). */
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [layerMenu, layerList, adjustCard, ctxMenu, gisUi.menu,
                  document.getElementById('session-menu'), document.getElementById('exif-card')]
        .filter(node => node && node.style.display !== 'none');
    if (!open.length) return;
    if (layerMenu) layerMenu.style.display = 'none';
    closeBasemapMenu();
    closeGisMenu();
    adjustCard.style.display = 'none';
    hideCtxMenu();
    document.getElementById('session-menu').style.display = 'none';
    document.getElementById('exif-card').style.display = 'none';
    e.stopPropagation();
}, true);

/* Keyboard shortcuts */
document.addEventListener('keydown', (e) => {
    // Ignore when typing in an actual text input
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // F2 — rename the active image in the ☰ list
    if (e.key === 'F2') { e.preventDefault(); renameSession(activeSessionIndex); return; }

    // Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes (text fields returned above and keep the browser's own undo)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (k === 'y' && !e.shiftKey) { e.preventDefault(); redo(); return; }
        // Ctrl+S exports all images, with or without photos as set in the ☰ menu (never the browser's "save page")
        if (k === 's' && !e.shiftKey) { e.preventDefault(); if (!e.repeat) exportAllSessions(); return; }
    }
    // Browser shortcuts (Ctrl+R reload, Ctrl+F find, ...) are not ours; Ctrl+V arrives as a paste event
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Escape — cancel / deselect
    if (e.key === 'Escape') {
        // A drag in progress snaps back instead of deselecting
        if (cancelMarkerDrag()) return;
        if (measure.active) { clearMeasure(); return; }
        if (state.pointDrag) {
            const { line, pt, origY } = state.pointDrag;
            pt.y = origY; state.pointDrag = null; line.pristine = false;
            render(); updateUI();
            return;
        }
        if (state.mode === 'map-point') {
            state.mode = 'drag-line';
            state.mapPointTarget = null;
        } else if (state.mode === 'horizon') {
            state.mode = 'idle';
            sess().horizonPoints = [];
        } else {
            state.activeLineIndex = -1;
            state.selectedPoint = null;
            state.mode = 'idle';
        }
        render(); updateUI();
        return;
    }

    // Delete / Backspace — the selected point (or the one waiting for its map click), else the active line
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (state.mode === 'horizon') return;
        const pt = state.selectedPoint || (state.mode === 'map-point' ? state.mapPointTarget : null);
        if (pt && sess().lines[pt.lineIndex]?.points[pt.pointIndex]) deletePoint(pt.lineIndex, pt.pointIndex);
        else if (state.activeLineIndex !== -1) deleteLine(state.activeLineIndex);
        return;
    }

    // 1–5 (number row or keypad) — jump to line
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) {
        const lineNum = Number(digit[1]);
        if (lineNum > MAX_LINES) return;
        e.preventDefault();
        if (lineNum - 1 < sess().lines.length && state.mode !== 'horizon') selectLine(lineNum - 1);
        return;
    }

    // Letter keys: what they do depends on the key layout chosen in the help card
    const action = actionForKey(e.code);
    if (!action) return;
    e.preventDefault();
    if (MOVE_ACTIONS.has(action)) { holdMapMove(action); return; }
    KEY_ACTIONS[action]?.(e);
});

/* What each action of a key layout does */
const KEY_ACTIONS = {
    newLine() {
        if (!sess().imgElement) return;   // like the greyed-out button
        addLine(true);
    },
    removeLine() {
        if (state.activeLineIndex !== -1) deleteLine(state.activeLineIndex);
    },
    // Map placement for the next unmapped point: of the active line, else of the first line that has one
    nextPoint() {
        const s = sess();
        const hasUnmapped = (l) => !!l && l.points.some(p => !p.geo);
        const lIdx = hasUnmapped(s.lines[state.activeLineIndex]) ? state.activeLineIndex : s.lines.findIndex(hasUnmapped);
        if (lIdx !== -1) startMapPoint(lIdx, s.lines[lIdx].points.findIndex(p => !p.geo));
    },
    // Level tool (toggle / reset)
    level() {
        if (!sess().imgElement) return;   // like the greyed-out button
        btnHorizon.click();
    },
    help() {
        const card = document.getElementById('help-card');
        if (card.style.display === 'none') showHelp(false); else hideHelp();
    },
    // Measure a distance on the map (again to clear)
    measure(e) {
        if (!e.repeat) { if (measure.active) clearMeasure(); else startMeasure(); }
    },
    // Same as clicking the compass: reset bearing and tilt
    north() { map.resetNorthPitch(); },
    // Look straight down; the bearing stays
    topDown(e) { if (!e.repeat) map.easeTo({ pitch: 0 }); }
};

/* Map layout: while W A S D are held the map glides in screen directions, so "up" stays up on a turned map;
   Q and E turn it. Several keys at once combine. Everything stops when the window loses focus. */
const MOVE_ACTIONS = new Set(['panUp', 'panLeft', 'panDown', 'panRight', 'turnLeft', 'turnRight']);
const MOVE_SPEED = 380;   // screen pixels per second
const TURN_SPEED = 70;    // degrees per second
const mapMove = { held: new Set(), frame: null, last: 0 };

function holdMapMove(action) {
    mapMove.held.add(action);
    if (mapMove.frame !== null) return;
    mapMove.last = performance.now();
    mapMove.frame = requestAnimationFrame(mapMoveStep);
}

function mapMoveStep(now) {
    const h = mapMove.held;
    if (!h.size) { mapMove.frame = null; return; }
    const dt = Math.min(0.05, (now - mapMove.last) / 1000);   // a stalled frame does not jump the map
    mapMove.last = now;
    const dx = (h.has('panRight') ? 1 : 0) - (h.has('panLeft') ? 1 : 0);
    const dy = (h.has('panDown') ? 1 : 0) - (h.has('panUp') ? 1 : 0);
    const turn = (h.has('turnRight') ? 1 : 0) - (h.has('turnLeft') ? 1 : 0);
    if (dx || dy) map.panBy([dx * MOVE_SPEED * dt, dy * MOVE_SPEED * dt], { animate: false });
    if (turn) map.setBearing(map.getBearing() + turn * TURN_SPEED * dt);
    mapMove.frame = requestAnimationFrame(mapMoveStep);
}

function stopMapMove() { mapMove.held.clear(); }

document.addEventListener('keyup', (e) => {
    const action = actionForKey(e.code);
    if (action) mapMove.held.delete(action);
});
window.addEventListener('blur', stopMapMove);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMapMove(); });

/* Switch the key layout: saved in this browser; the help card, guide and tooltips follow */
function setKeyLayout(name) {
    keyLayout = name === 'map' ? 'map' : 'photo';
    localStorage.setItem(KEY_LAYOUT_STORE, keyLayout);
    stopMapMove();
    showKeyLayout();
}

/* Everything that names a key of the active layout */
function showKeyLayout() {
    renderHelpKeys();
    buildGuide();
    updateGuide();
    const add = document.getElementById('btn-add-line');
    add.dataset.title = `New line (${keyFor('newLine')})`;
    if (!add.disabled) add.title = add.dataset.title;
    if (measure.button) measure.button.title = `Measure distance (${keyFor('measure')})`;
}

/* The key list of the help card, for the active layout. Fixed keys are the same in both. */
function renderHelpKeys() {
    const k = keyFor;
    const rows = keyLayout === 'map' ? [
        [k('panUp') + k('panLeft') + k('panDown') + k('panRight'), 'Move the map'],
        [`${k('turnLeft')} / ${k('turnRight')}`, 'Turn the map'],
        [k('newLine'), 'New line'],
        ['1–5', 'Jump to line'],
        [k('nextPoint'), 'Map next point'],
        ['Del', 'Delete point or line'],
        [k('level'), 'Level tool'],
        [k('topDown'), 'Look straight down'],
        [k('north'), 'Map north and flat'],
        [k('measure'), 'Measure distance'],
        ['Ctrl+Z', 'Undo; Ctrl+Y redo'],
        ['Esc', 'Cancel'],
        ['Ctrl+V', 'Paste photo / coordinates'],
        ['Ctrl+S', 'Export all'],
        ['F2', 'Rename image'],
        [k('help'), 'This help']
    ] : [
        [k('newLine'), 'New line'],
        [k('removeLine'), 'Delete line'],
        ['1–5', 'Jump to line'],
        [k('nextPoint'), 'Map next point'],
        ['Del', 'Delete point or line'],
        [k('level'), 'Level tool'],
        ['Ctrl+Z', 'Undo; Ctrl+Y redo'],
        ['Esc', 'Cancel'],
        ['Ctrl+V', 'Paste photo / coordinates'],
        ['Ctrl+S', 'Export all'],
        ['F2', 'Rename image'],
        [k('north'), 'Map north and flat'],
        [k('measure'), 'Measure distance'],
        [k('help'), 'This help']
    ];
    const grid = document.getElementById('help-keys');
    grid.innerHTML = '';
    for (const [key, text] of rows) {
        el('span', 'help-key', grid).textContent = key;
        el('span', '', grid).textContent = text;
    }
    document.querySelectorAll('#key-layout-switch button').forEach(b => {
        const on = b.dataset.layout === keyLayout;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on);
    });
}

document.querySelectorAll('#key-layout-switch button').forEach(b => { b.onclick = () => setKeyLayout(b.dataset.layout); });
// Chrome and Edge tell which letter each key carries on this keyboard; the labels follow once they know
navigator.keyboard?.getLayoutMap?.().then(m => { keyNames = m; showKeyLayout(); }).catch(() => {});

/* ============================================================
   SESSION MANAGEMENT
   ============================================================ */
/* The images as tabs in the photo header: colour dot, name, × to remove; "+" adds an image.
   A click switches, a double-click on the name (or F2) renames. Redrawn together with the ☰ menu. */
function renderImageTabs() {
    const bar = document.getElementById('image-tabs');
    if (!bar) return;
    bar.innerHTML = '';
    sessions.forEach((s, idx) => {
        const tab = el('div', 'image-tab' + (idx === activeSessionIndex ? ' active' : ''), bar);
        tab.style.setProperty('--sc', LINE_COLOURS[(sessionColourIndex(idx) * 2) % LINE_COLOURS.length]);
        tab.title = s.name;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', idx === activeSessionIndex ? 'true' : 'false');
        el('span', 'session-dot', tab);
        const name = el('span', 'session-name', tab);
        name.textContent = s.name;
        const close = el('button', 'image-tab-close', tab);
        close.type = 'button';
        close.title = 'Remove image';
        close.setAttribute('aria-label', `Remove ${s.name}`);
        close.textContent = '×';
        close.onclick = (e) => { e.stopPropagation(); removeSession(idx); };
        tab.onclick = (e) => {
            if (e.target.closest('input')) return;   // the name being edited
            if (idx !== activeSessionIndex) switchToSession(idx);
        };
        tab.ondblclick = (e) => { if (!e.target.closest('button, input')) renameSession(idx); };
    });
    const add = el('button', 'image-tab-add', bar);
    add.type = 'button';
    add.title = 'Add image';
    add.setAttribute('aria-label', 'Add image');
    add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';   // the same plus as New line
    add.onclick = () => addSession();
    bar.querySelector('.image-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* The ☰ menu of the photo side, in sections like the map panel:
   File (import, export, with or without photos) · This browser (autosave) · Demo.
   The images themselves are the tabs in the header (renderImageTabs). */
function renderSessionMenu() {
    renderImageTabs();
    const menu = document.getElementById('session-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const close   = () => { menu.style.display = 'none'; };
    const section = (title) => { el('div', 'map-panel-title session-title', menu).textContent = title; };
    const arrow   = (up) => `<span class="export-icon">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${up ? '<line x1="5" y1="9" x2="5" y2="2"/><polyline points="2,4.5 5,1.5 8,4.5"/>'
                 : '<line x1="5" y1="1" x2="5" y2="8"/><polyline points="2,5.5 5,8.5 8,5.5"/>'}
        </svg></span>`;
    // An entry that stays in place, greyed out, while it cannot be used: the menu keeps its shape
    const entry = (cls, html, title, enabled, action) => {
        const item = el('div', `session-add ${cls}` + (enabled ? '' : ' disabled'), menu);
        item.innerHTML = html;
        item.title = enabled ? title : 'Load a photo first';
        if (enabled) item.onclick = () => { action(); close(); };
        return item;
    };

    // ---- File ----
    section('File');
    entry('session-import', `${arrow(true)} Import…`, 'Open a TracePoint session file (.json)', true, () => jsonPicker.click());
    entry('session-export-all', `${arrow(false)} Export this image`, 'Save the image on screen with its lines and points',
        !!sess()?.imgElement, () => exportSession(activeSessionIndex));
    entry('session-export-all', `${arrow(false)} Export all <span class="session-key">Ctrl+S</span>`,
        'Save all images with their lines and points as one file', sessions.some(s => s.imgElement), () => exportAllSessions());

    // Export with or without the photos themselves; the note is there only while it is on
    const photoRow = el('div', 'session-autosave session-export-photos', menu);
    photoRow.innerHTML =
        `<label class="autosave-switch" for="export-photos-switch" title="Store each photo inside the exported file, unchanged, with its GPS and camera data, so an import restores it without asking for the image. The file gets about a third bigger than the photo. Applies to every export, also Ctrl+S.">
             Include photos</label>
         <input type="checkbox" id="export-photos-switch" class="adjust-switch" role="switch" aria-label="Include photos" ${exportPhotos ? 'checked' : ''}>`;
    photoRow.querySelector('input').onchange = (e) => { setExportPhotos(e.target.checked); renderSessionMenu(); };
    if (exportPhotos) {
        el('div', 'session-note', menu).textContent = 'Photos go into the file with their GPS data; it gets much bigger.';
    }

    // ---- This browser: autosave switch and the button that deletes what it saved ----
    section('This browser');
    const saveRow = el('div', 'session-autosave', menu);
    saveRow.innerHTML =
        `<label class="autosave-switch" for="autosave-switch" title="Keep the work in this browser so a refresh does not lose it. Off deletes the saved copy.">
             Autosave</label>
         <span class="session-row-end">
             <button type="button" class="btn-clear-saved"
                     title="${autosaveOwner ? 'Delete the saved session and start empty' : 'TracePoint is open in another tab: clear the saved session there'}"
                     ${autosaveOn && autosaveOwner && sessionsHaveWork() ? '' : 'disabled'}>Clear</button>
             <input type="checkbox" id="autosave-switch" class="adjust-switch" role="switch" aria-label="Autosave" ${autosaveOn ? 'checked' : ''}>
         </span>`;
    saveRow.querySelector('input').onchange = (e) => { setAutosave(e.target.checked); renderSessionMenu(); };
    saveRow.querySelector('button').onclick = () => { close(); clearSavedSession(); };

    // ---- Demo: a photo to try the method on ----
    section('Demo');
    entry('session-demo', 'Potsdam, Germany', 'Load the demo photo', true, () => loadDemoImage());
}

/* Rename an image: the name on its tab becomes a text field. Enter or a click elsewhere saves,
   Esc cancels, an empty name keeps the old one. From a double-click on the tab and from F2 (active image).
   After renameSessionTab in briatlon's sessionTabs.js. */
const SESSION_NAME_MAX = 60;

function renameSession(idx) {
    const s = sessions[idx];
    if (!s) return;
    renderImageTabs();
    const span = document.querySelectorAll('#image-tabs .image-tab .session-name')[idx];
    if (!span) return;
    const input = document.createElement('input');
    input.className = 'session-name-input';
    input.value = s.name;
    input.maxLength = SESSION_NAME_MAX;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Image name');
    let finished = false;
    const finish = (cancel) => {
        if (finished) return;
        finished = true;
        const name = input.value.trim().slice(0, SESSION_NAME_MAX);
        if (!cancel && name && name !== s.name) {
            s.name = name;
            s.renamed = true;   // a photo loaded into this image later no longer names it (see loadImage)
            scheduleAutosave();
        }
        renderSessionMenu();
    };
    input.onkeydown = (e) => {
        e.stopPropagation();   // typing a name is not a shortcut
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        finish(e.key === 'Escape');
    };
    input.onblur = () => finish(false);
    span.replaceWith(input);
    input.focus();
    input.select();
}

function switchToSession(idx) {
    hideHelp();
    state.mode           = 'idle';
    state.activeLineIndex = -1;
    state.mapPointTarget  = null;
    state.selectedPoint   = null;
    state.showOriginal    = false;
    state.press           = null;
    state.isDragging      = false;
    state.pointDrag       = null;
    state._horizonMouse   = null;

    // Save outgoing session's map position (guard: session may already be gone if called from removeSession)
    if (sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].mapView = getMapView();
        setMarkersDraggable(sessions[activeSessionIndex], false);
    }
    if (sessions[idx]) setMarkersDraggable(sessions[idx], true);

    activeSessionIndex = idx;
    const s = sess();

    if (s.mapView) {
        applyMapView(s.mapView);
    } else {
        const hasGeoWork = s.lines.some(l => l.points.some(p => p.geo));
        if (!hasGeoWork) applyMapView(WORLD_VIEW);
    }

    const exifCard = document.getElementById('exif-card');
    exifCard.style.display = 'none';
    adjustCard.style.display = 'none';
    updateAdjustUI();

    if (s.imgElement) {
        sizePhotoCanvas(s.imgElement);
        canvas.style.display = 'block';
        overlay.style.display = 'none';
        applyTransform();
        render();
    } else {
        canvas.style.display  = 'none';
        overlay.style.display = 'flex';
        updateDropOverlay();
        render();   // clears the lines of the image before
    }

    updateUI();
    renderSessionMenu();
}

function nextSessionName() {
    const used = new Set(sessions.map(s => s.name.match(/^Image (\d+)$/)?.[1]).filter(Boolean).map(Number));
    let n = 1;
    while (used.has(n)) n++;
    return `Image ${n}`;
}

function addSession() {
    sessions.push(createSession(nextSessionName()));
    switchToSession(sessions.length - 1);
}

function removeSession(idx) {
    removeSessionMarkers(sessions[idx]);
    if (sessions[idx].currentObjectURL) URL.revokeObjectURL(sessions[idx].currentObjectURL);
    const wasActive = idx === activeSessionIndex;
    sessions.splice(idx, 1);
    rebuildWorkSource();   // drops the removed session's rays and ellipse

    if (!wasActive) {
        // Another session went: stay on the one being worked on, only its index may have shifted
        if (idx < activeSessionIndex) activeSessionIndex--;
        renderSessionMenu();
        scheduleAutosave();
        return;
    }

    hideHelp();
    const wasLast = sessions.length === 0;
    if (wasLast) sessions.push(createSession('Image 1'));
    activeSessionIndex = sessions.length; // out of range → switchToSession skips its save step
    switchToSession(Math.min(idx, sessions.length - 1));
    if (wasLast) applyMapView(WORLD_VIEW);
}

/* ============================================================
   HELP CARD
   ============================================================ */
function showHelp(isDemo = false) {
    document.getElementById('help-card').style.display = 'block';
    if (layerMenu) layerMenu.style.display = 'none';   // the map panel would sit behind the card
    closeBasemapMenu();
    document.getElementById('help-demo-note').style.display = isDemo ? 'block' : 'none';
}

function hideHelp() {
    document.getElementById('help-card').style.display = 'none';
}

document.getElementById('btn-help').onclick       = () => {
    const card = document.getElementById('help-card');
    if (card.style.display === 'none') showHelp(false); else hideHelp();
};
document.getElementById('btn-help-close').onclick = hideHelp;

/* ============================================================
   DEMO IMAGE
   ============================================================ */
function loadDemoImage() {
    fetch('assets/Potsdam_Germany.jpg')
        .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(blob => {
            const file = new File([blob], 'Potsdam_Germany.jpg', { type: 'image/jpeg' });
            openImageFile(file, () => {
                jumpTo({ lat: 52.3899735750511, lng: 13.060147762298586 }, 15);
                showHelp(true);
            });
        })
        .catch(() => showToast('Could not load the demo image.'));
}

/* Wire up session burger button */
document.getElementById('btn-session-burger').onclick = () => {
    const menu = document.getElementById('session-menu');
    const open = menu.style.display !== 'none';
    renderSessionMenu();
    menu.style.display = open ? 'none' : 'block';
};

/* Close session menu on outside click */
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('session-manager-wrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('session-menu').style.display = 'none';
    }
});

/* ============================================================
   IMAGE HANDLING
   ============================================================ */
function updateDropOverlay() {
    const s = sess();
    if (s.pendingImageFilename) {
        overlay.innerHTML =
            `<span class="drop-restored-title">Session restored</span>` +
            `<span class="drop-restore">reload <strong>${escHtml(s.pendingImageFilename)}</strong> to continue</span>` +
            `<button id="btn-browse" type="button">Browse</button>`;
    } else {
        overlay.innerHTML =
            `Drop / Paste image here` +
            `<button id="btn-browse" type="button">Browse</button>` +
            `<span class="drop-or">or</span><button id="btn-demo-link" type="button">Try the Demo</button>`;
    }
}

/* s: the session that gets the image; null = a new session, created once the image has loaded.
   fromStore: the file comes out of the autosave store, so it is not written back.
   Nothing in the session changes until the browser has decoded the image, so a file it cannot
   show (HEIC, a broken download) leaves the session as it was. */
function loadImage(file, s = sess(), fromStore = false, onReady = null) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
        URL.revokeObjectURL(url);
        showToast(`Could not open ${file.name || 'the image'}: this browser cannot display it.`);
    };
    img.onload = () => {
        if (!s) { addSession(); s = sess(); }
        else if (!sessions.includes(s)) { URL.revokeObjectURL(url); return; }   // removed while loading
        const isRestore = fromStore || !!s.pendingImageFilename;
        if (s.currentObjectURL) URL.revokeObjectURL(s.currentObjectURL);
        s.currentObjectURL = url;
        s.imgElement = img;
        s.imageFile = file;
        s.imageFilename = file.name || s.imageFilename;
        s.pendingImageFilename = null;
        if (!isRestore && file.name && !s.renamed) s.name = file.name.replace(/\.[^.]+$/, '');
        if (!fromStore) autosavePutImage(s);
        if (!isRestore) fitPhoto(s);
        if (img.width > MAX_CANVAS_SIDE || img.height > MAX_CANVAS_SIDE || img.width * img.height > MAX_CANVAS_AREA) {
            showToast(`This photo (${img.width} × ${img.height} px) is larger than a browser canvas can hold and may stay blank. Scale it down first.`);
        }
        if (s === sess()) {
            sizePhotoCanvas(img);
            canvas.style.display = 'block';
            overlay.style.display = 'none';
            applyTransform();
            render();
            updateGuide();
            updateAdjustUI();
        }
        renderSessionMenu();
        scheduleAutosave();
        if (onReady) onReady();

        // Read EXIF metadata — enable all segments so XMP/IPTC fields are included
        exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
            .then(exif => { s.exif = exif || null; })
            .catch(() => { s.exif = null; })
            .finally(() => {
                scheduleAutosave();
                if (s !== sess()) return;
                updateLineBarTools();
                document.getElementById('exif-card').style.display = 'none';
            });
    };
    img.src = url;
}

/* An image the user picked: into the active session, or into a new one when that already has a photo
   (its lines belong to the old photo). */
function openImageFile(file, onReady) {
    if (!file.type.startsWith('image/')) return showToast('That is not an image file.');
    loadImage(file, sess().imgElement ? null : sess(), false, onReady);
}

/* The clipboard calls every image "image.png" and hands over pixels only, without EXIF.
   Pasted photos are numbered instead: pasted_image_01, pasted_image_02, … */
function openPastedImage(file) {
    const used = sessions.map(s => +(s.name.match(/^pasted_image_(\d+)$/)?.[1] || 0));
    const name = `pasted_image_${String(Math.max(0, ...used) + 1).padStart(2, '0')}`;
    const ext  = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[file.type] || file.type.slice(6) || 'png';
    if (photoCollapsed()) btnPaneCollapse.click();   // the photo side comes back before the photo is fitted into it
    openImageFile(new File([file], `${name}.${ext}`, { type: file.type }),
        () => showToast('Photo pasted. Clipboard images carry no EXIF data.', 'success'));
}

container.addEventListener('dragover',  (e) => { e.preventDefault(); container.classList.add('drag-active'); });
container.addEventListener('dragleave', ()  => container.classList.remove('drag-active'));
container.addEventListener('drop', (e) => {
    e.preventDefault(); container.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file) openImageFile(file);
});
/* A file dropped anywhere else would make the browser open it and leave the app */
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop',     (e) => e.preventDefault());

const filePicker = document.getElementById('file-picker');
overlay.addEventListener('click', (e) => {
    if (e.target.id === 'btn-browse') filePicker.click();
    if (e.target.id === 'btn-demo-link') loadDemoImage();
});
filePicker.addEventListener('change', () => {
    const file = filePicker.files[0];
    if (file) { openImageFile(file); filePicker.value = ''; }
});

/* ============================================================
   EXIF CARD
   ============================================================ */
function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatExifDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
        return val.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
    // exifr sometimes returns a string "YYYY:MM:DD HH:MM:SS"
    if (typeof val === 'string') {
        // A date that went through a session file or the autosave is an ISO string
        if (/^\d{4}-\d{2}-\d{2}T/.test(val) && !isNaN(Date.parse(val))) {
            return new Date(val).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        }
        const m = val.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (m) {
            const d = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
            return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        }
        return val;
    }
    return String(val);
}

/* exifr hands most coded fields over already translated to text ("Flash did not fire", "Auto",
   "Rotate 90 CW"); the raw numbers are handled too, for files read with other settings. */
function formatExposure(val) {
    if (!finite(val) || val <= 0) return null;
    if (val >= 1) return `${+val.toFixed(1)}s`;
    const denom = Math.round(1 / val);
    return `1/${denom}s`;
}

/* ShutterSpeedValue and ApertureValue are APEX values, not seconds and f-numbers */
function apexToSeconds(v) { return finite(v) ? Math.pow(2, -v) : null; }
function apexToFNumber(v) { return finite(v) ? +Math.pow(2, v / 2).toFixed(1) : null; }

function formatFlash(val) {
    if (val == null) return null;
    if (typeof val === 'string') return /fired/i.test(val) && !/not fire/i.test(val) ? 'Fired' : 'No flash';
    return (val & 0x01) ? 'Fired' : 'No flash';
}

function formatOrientation(val) {
    if (typeof val === 'string') return val || null;
    const names = { 1:'Normal', 2:'Mirrored', 3:'180°', 4:'Mirrored 180°',
                    5:'90° CCW mirrored', 6:'90° CW', 7:'90° CW mirrored', 8:'90° CCW' };
    return names[val] || null;
}

function formatWhiteBalance(val) {
    if (val == null) return null;
    if (typeof val === 'string') return val || null;
    return val === 0 ? 'Auto' : val === 1 ? 'Manual' : null;
}

function formatExposureMode(val) {
    if (val == null) return null;
    if (typeof val === 'string') return val || null;
    return (['Auto', 'Manual', 'Auto bracket'][val]) ?? null;
}

function formatGPSSpeed(speed, ref) {
    if (!finite(speed)) return null;
    const r = String(ref || '');
    const unit = /^m/i.test(r) ? 'mph' : /^(n|kn)/i.test(r) ? 'kn' : 'km/h';
    return `${speed.toFixed(1)} ${unit}`;
}

function formatGPSTimestamp(ts, dateStamp) {
    if (ts == null) return null;
    let time;
    if (Array.isArray(ts) && ts.length === 3) {
        time = ts.map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
    } else if (typeof ts === 'string' && /^\d{1,2}:\d{1,2}:\d{1,2}/.test(ts)) {
        time = ts.split(':').map(n => String(Math.floor(+n)).padStart(2, '0')).join(':');
    } else if (ts instanceof Date) {
        time = ts.toISOString().slice(11, 19);
    } else return null;
    const date = dateStamp ? String(dateStamp).replace(/:/g, '-') + ' ' : '';
    return `${date}${time} UTC`;
}

/* Return the first non-null value found across multiple possible field names */
function pick(e, ...keys) {
    for (const k of keys) { if (e[k] != null) return e[k]; }
    return null;
}

/* Convert DMS array [deg, min, sec] or plain decimal to decimal degrees */
function dmsToDecimal(val) {
    if (val == null) return null;
    if (typeof val === 'number') return val;
    if (Array.isArray(val) && val.length === 3 && val.every(finite)) return val[0] + val[1] / 60 + val[2] / 3600;
    return null;
}

/* Signed position of the photo, or null. exifr adds latitude/longitude with the hemisphere applied;
   the raw GPSLatitude/GPSLongitude arrays carry no sign, so without those two the Ref letters decide. */
function exifLatLng(e) {
    if (!e) return null;
    let lat = finite(e.latitude)  ? e.latitude  : dmsToDecimal(e.GPSLatitude);
    let lng = finite(e.longitude) ? e.longitude : dmsToDecimal(e.GPSLongitude);
    if (!finite(lat) || !finite(lng)) return null;
    if (!finite(e.latitude)  && /^S/i.test(String(e.GPSLatitudeRef  || ''))) lat = -Math.abs(lat);
    if (!finite(e.longitude) && /^W/i.test(String(e.GPSLongitudeRef || ''))) lng = -Math.abs(lng);
    return validLatLng(lat, lng);
}

/* GPSImgDirectionRef "M": the camera direction is measured from magnetic north, not true north */
function magneticDirection(e) {
    return /^m/i.test(String(e?.GPSImgDirectionRef || ''));
}

function cardinalDir(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
}

function renderExifCard() {
    const s    = sess();
    const card = document.getElementById('exif-card');
    if (!s.exif) {
        card.innerHTML = '<p class="exif-empty">No metadata found</p>';
        return;
    }
    try {
        const e   = s.exif;
        const pos = exifLatLng(e);
        const lat = pos ? pos.lat : null;
        const lng = pos ? pos.lng : null;
        const alt = dmsToDecimal(e.GPSAltitude);
        const dir = finite(e.GPSImgDirection) ? e.GPSImgDirection : null;
        const trk = finite(e.GPSTrack)        ? e.GPSTrack        : null;
        const fNumber  = finite(e.FNumber) ? e.FNumber : apexToFNumber(e.ApertureValue);
        const exposure = finite(e.ExposureTime) ? e.ExposureTime : apexToSeconds(e.ShutterSpeedValue);

        const cameraStr = [e.Make, e.Model].filter(Boolean).join(' ') || null;
        const lensStr   = e.LensModel && e.LensModel !== e.Model ? e.LensModel : null;
        const imgW      = pick(e, 'ImageWidth',  'ExifImageWidth',  'PixelXDimension');
        const imgH      = pick(e, 'ImageHeight', 'ExifImageHeight', 'PixelYDimension');
        const date      = pick(e, 'DateTimeOriginal', 'DateTimeDigitized', 'DateTime');
        const software  = pick(e, 'Software', 'CreatorTool');
        const creator   = pick(e, 'Creator', 'Byline', 'Artist');
        const desc      = pick(e, 'Description', 'Caption', 'Caption-Abstract', 'ImageDescription');
        const kwRaw     = pick(e, 'Keywords', 'Subject');
        const keywords  = kwRaw ? (Array.isArray(kwRaw) ? kwRaw.join(', ') : String(kwRaw)) : null;
        const copyright = pick(e, 'Copyright', 'Rights');

        const rows = [
            // — Camera —
            ['Camera',        cameraStr],
            ['Lens',          lensStr],
            ['Software',      software],
            // — Exposure —
            ['Date',          formatExifDate(date)],
            ['Focal length',  pick(e, 'FocalLength')         != null ? `${e.FocalLength} mm` : null],
            ['35mm equiv',    pick(e, 'FocalLengthIn35mmFilm')!= null ? `${e.FocalLengthIn35mmFilm} mm` : null],
            ['Aperture',      fNumber != null ? `f/${fNumber}` : null],
            ['Shutter',       formatExposure(exposure)],
            ['ISO',           pick(e, 'ISO', 'ISOSpeedRatings', 'PhotographicSensitivity') != null ? `${pick(e, 'ISO', 'ISOSpeedRatings', 'PhotographicSensitivity')}` : null],
            ['Flash',         formatFlash(pick(e, 'Flash'))],
            ['Exposure',      formatExposureMode(pick(e, 'ExposureMode'))],
            ['White balance', formatWhiteBalance(pick(e, 'WhiteBalance'))],
            // — Image —
            ['Resolution',    imgW && imgH ? `${imgW} × ${imgH}` : null],
            ['Orientation',   formatOrientation(pick(e, 'Orientation'))],
            // — Location —
            ['GPS',           lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : null],
            ['Altitude',      alt != null ? `${Math.round(alt)} m` : null],
            ['Cam direction', dir != null ? `${Math.round(dir)}° ${cardinalDir(dir)}${magneticDirection(e) ? ' (magnetic)' : ''}` : null],
            ['Travel dir',    trk != null ? `${Math.round(trk)}° ${cardinalDir(trk)}` : null],
            ['Speed',         formatGPSSpeed(pick(e, 'GPSSpeed'), pick(e, 'GPSSpeedRef'))],
            ['GPS time',      formatGPSTimestamp(pick(e, 'GPSTimeStamp'), pick(e, 'GPSDateStamp'))],
            // — Attribution —
            ['Creator',       creator],
            ['Description',   desc],
            ['Keywords',      keywords],
            ['Copyright',     copyright]
        ].filter(r => r[1] != null);

        if (!rows.length) {
            card.innerHTML = '<p class="exif-empty">No metadata found</p>';
            return;
        }
        const crosshair = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <circle cx="8" cy="8" r="3"/>
            <line x1="8" y1="1" x2="8" y2="4.5"/>
            <line x1="8" y1="11.5" x2="8" y2="15"/>
            <line x1="1" y1="8" x2="4.5" y2="8"/>
            <line x1="11.5" y1="8" x2="15" y2="8"/>
        </svg>`;
        const gpsBtn = (lat != null && lng != null)
            ? `<button class="exif-gps-btn" data-action="exif-gps">${crosshair}${sess().exifGpsMarker ? 'Remove from map' : 'Show on map'}</button>`
            : '';
        const rayBtn = (lat != null && lng != null && dir != null)
            ? `<button class="exif-gps-btn exif-ray-btn" data-action="exif-ray">${crosshair}Add direction ray</button>`
            : '';
        card.innerHTML =
            '<div class="exif-card-header">Image metadata</div>' +
            '<table class="exif-table">' +
            rows.map(([k, v]) => k === 'GPS'
                ? `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}<button class="exif-copy-btn" data-action="copy-coords" data-coords="${escHtml(v)}" title="Copy coordinates"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M2 11V2h9"/></svg></button></td></tr>`
                : `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`
            ).join('') +
            '</table>' + gpsBtn + rayBtn;
    } catch (err) {
        card.innerHTML = '<p class="exif-empty">Could not read metadata</p>';
    }
}

/* "Show on map" puts the photo's GPS position on the map; with the marker there, the same button
   reads "Remove from map" and takes it away again. */
function goToExifGps() {
    const s   = sess();
    if (s.exifGpsMarker) {
        s.exifGpsMarker.remove();
        s.exifGpsMarker = null;
        renderExifCard();
        return;
    }
    const pos = exifLatLng(s.exif);
    if (!pos) return;
    const { lat, lng } = pos;

    const exifCoords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    s.exifGpsMarker = new maplibregl.Marker({ element: el('div', 'exif-gps-marker') })
        .setLngLat([lng, lat])
        .setPopup(coordPopup('EXIF GPS Position', exifCoords, 'tp-popup tp-popup-exif', 12))
        .addTo(map);

    jumpTo({ lat, lng }, Math.max(map.getZoom(), 15));
    s.exifGpsMarker.togglePopup();
    renderExifCard();
}

/* Popup with a header, the coordinates and a copy button (intersection + EXIF markers) */
function coordPopup(title, coords, className, offset) {
    return new maplibregl.Popup({ className, offset, closeOnClick: false })
        .setHTML(
            `<div class="tp-popup-header">${title}</div>` +
            `<div class="tp-popup-body">` +
            `<span>${coords}</span>` +
            `<button class="tp-copy-btn" data-action="copy-coords" data-coords="${coords}" title="Copy coordinates">` +
            `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
            `<rect x="5" y="5" width="9" height="9" rx="1"/><path d="M2 11V2h9"/>` +
            `</svg></button>` +
            `</div>`
        );
}

function addExifRay() {
    const s   = sess();
    const pos = exifLatLng(s.exif);
    const dir = finite(s.exif?.GPSImgDirection) ? s.exif.GPSImgDirection : null;
    if (!pos) return showToast('No GPS coordinates in image metadata.');
    if (dir == null) return showToast('No camera direction in image metadata.');
    if (!s.imgElement) return showToast('Load the image before adding a ray.');
    if (s.lines.some(l => l.source === 'exif' || l.colour === '#e03c3c')) return showToast('EXIF direction ray already added.');
    if (s.lines.length >= MAX_LINES) return showToast(`Maximum of ${MAX_LINES} lines per image.`);
    const { lat, lng } = pos;

    // Canvas line centred horizontally, points at top and bottom of image
    const v  = sess().view;
    const cr = container.getBoundingClientRect();
    const viewCenterX = (cr.width / 2 - v.tx) / v.scale;
    const clampedX    = Math.max(0, Math.min(canvas.width, viewCenterX));
    const p2 = destinationPoint({ lat, lng }, dir, 1); // 1 km along bearing

    s.lines.push({
        x:      clampedX,
        colour: '#e03c3c',
        source: 'exif',
        pristine: false,
        points: [
            { y: 0,             geo: { lat, lng } },
            { y: canvas.height, geo: { lat: p2.lat, lng: p2.lng } }
        ]
    });

    const lIdx = s.lines.length - 1;
    state.activeLineIndex = lIdx;
    state.mode = 'drag-line';
    rebuildMapForLine(lIdx);
    recomputeIntersection();
    render(); updateUI();
    showToast('EXIF direction ray added.', 'success');
    // The magnetic declination (a few degrees in most places) is not corrected: it needs a world magnetic model
    if (magneticDirection(s.exif)) showToast('The camera recorded a magnetic bearing: the ray can be off true north by the local declination.');
}

/* Button toggle */
document.getElementById('btn-exif').addEventListener('click', (e) => {
    e.stopPropagation();
    const card = document.getElementById('exif-card');
    const open = card.style.display !== 'none';
    if (open) {
        card.style.display = 'none';
    } else {
        renderExifCard();
        card.style.display = 'block';
    }
});

/* Close on outside click */
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('exif-wrap');
    const card = document.getElementById('exif-card');
    if (!wrap.contains(e.target)) card.style.display = 'none';
});

/* ============================================================
   CONTRAST / BRIGHTNESS  (#16)
   A CSS filter applied while the photo is drawn, so lines and points
   stay crisp and the pixels used for measuring are untouched.
   ============================================================ */
const adjustWrap   = document.getElementById('adjust-wrap');
const adjustCard   = document.getElementById('adjust-card');
const btnAdjust    = document.getElementById('btn-adjust');
const adjustInvert = document.getElementById('adjust-invert');
const btnFit          = document.getElementById('btn-fit');
const btnOriginal     = document.getElementById('btn-original');
const btnCardOriginal = document.getElementById('btn-adjust-original');
const originalBadge   = document.getElementById('original-badge');

/* Each slider runs 0–200 with 100 % in the middle: the left half covers lo–100 %, the right half
   100–hi %. So "normal" stays centred and small corrections stay easy although the range is wide.
   Ranges after briatlon's imageAdjustments.js (25–300 %). */
const ADJUST_SLIDERS = [['contrast', 25, 300], ['brightness', 25, 300], ['saturation', 0, 300]].map(([key, lo, hi]) => ({
    key, input: document.getElementById(`adjust-${key}`), val: document.getElementById(`adjust-${key}-val`),
    toValue: (pos) => Math.round(pos <= 100 ? lo + pos * (100 - lo) / 100 : 100 + (pos - 100) * (hi - 100) / 100),
    toPos:   (v)   => v <= 100 ? (v - lo) * 100 / (100 - lo) : 100 + (v - 100) * 100 / (hi - 100)
}));

function isAdjusted(s) { return ADJUST_SLIDERS.some(sl => s.adjust[sl.key] !== 100) || s.adjust.invert; }

function imageFilter(s) {
    const a = s.adjust;
    return isAdjusted(s) && !state.showOriginal
        ? `contrast(${a.contrast}%) brightness(${a.brightness}%) saturate(${a.saturation}%)` + (a.invert ? ' invert(1)' : '')
        : 'none';
}

/* The photo with its rotation and display filter, drawn into the photo canvas only when the image,
   the rotation or a slider changes. Lines and points have a canvas of their own at screen size
   (drawLines), so the pulse animation and every drag frame never touch the full-resolution photo.
   Browsers without ctx.filter fall back to a CSS filter on the photo canvas. */
const photoCache = { img: null, key: '' };

/* The largest canvas Chrome and Firefox draw; a bigger photo stays blank (Safari's limits are lower) */
const MAX_CANVAS_SIDE = 32767, MAX_CANVAS_AREA = 268435456;

/* The photo canvas has the photo's own pixel size: lines and points are stored in those pixels.
   Setting the size wipes the canvas, so it is only set when it changes, and the photo is redrawn then. */
function sizePhotoCanvas(img) {
    if (canvas.width === img.width && canvas.height === img.height) return;
    canvas.width  = img.width;
    canvas.height = img.height;
    photoCache.key = '';
}

function drawPhoto(s) {
    const img = s.imgElement, f = imageFilter(s);
    sizePhotoCanvas(img);
    const key = `${s.view.rotation}|${f}`;
    if (photoCache.img === img && photoCache.key === key) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(s.view.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
    if ('filter' in ctx) { ctx.filter = f; canvas.style.filter = ''; }
    else canvas.style.filter = f;
    ctx.drawImage(img, 0, 0);
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    photoCache.img = img; photoCache.key = key;
}

/* The tools of the line bar are always there; without a photo they are greyed out and do nothing.
   The metadata button also works for an image whose metadata came back from a session file. */
function updateLineBarTools() {
    const s = sess();
    const set = (id, on) => {
        const btn = document.getElementById(id);
        if (!btn.dataset.title) btn.dataset.title = btn.title;
        btn.disabled = !on;
        btn.title = on ? btn.dataset.title : LOAD_FIRST;
    };
    set('btn-exif', !!(s.imgElement || s.exif));
    set('btn-adjust', !!s.imgElement);
    set('btn-fit', !!s.imgElement);
    set('btn-add-line', !!s.imgElement);
    // Level: its tooltip also tells the rotation, which updateUI keeps; only its state changes here
    btnHorizon.disabled = !s.imgElement;
    if (!s.imgElement) btnHorizon.title = LOAD_FIRST;
    else if (btnHorizon.title === LOAD_FIRST) btnHorizon.title = 'Set horizon correction';
}

function updateAdjustUI() {
    const s = sess();
    const adjusted = !!s.imgElement && isAdjusted(s);
    if (!adjusted) state.showOriginal = false;   // nothing to compare with
    updateLineBarTools();
    ADJUST_SLIDERS.forEach(sl => {
        if (document.activeElement !== sl.input) sl.input.value = sl.toPos(s.adjust[sl.key]);   // not under the dragging thumb
        sl.val.textContent = `${s.adjust[sl.key]}%`;
    });
    adjustInvert.checked = !!s.adjust.invert;
    document.getElementById('adjust-invert-val').textContent = s.adjust.invert ? 'On' : 'Off';
    btnAdjust.classList.toggle('active', adjusted);
    // Show original: always in the row, clickable only while the photo is adjusted, yellow while it is on
    btnOriginal.disabled = !adjusted;
    if (!btnOriginal.dataset.title) btnOriginal.dataset.title = btnOriginal.title;
    btnOriginal.title = adjusted ? btnOriginal.dataset.title : (s.imgElement ? 'Adjust the photo first' : LOAD_FIRST);
    btnOriginal.classList.toggle('active', state.showOriginal);
    btnCardOriginal.disabled = !adjusted;
    btnCardOriginal.classList.toggle('active-mode', state.showOriginal);
    btnCardOriginal.textContent = state.showOriginal ? 'Show adjusted' : 'Show original';
    originalBadge.hidden = !state.showOriginal;
}

/* Changing an adjustment switches back to the adjusted photo: that is what is being tuned */
function setAdjust(change) {
    change(sess().adjust);
    state.showOriginal = false;
    render(); updateAdjustUI();
}

ADJUST_SLIDERS.forEach(sl => {
    sl.input.addEventListener('input',    () => setAdjust(a => { a[sl.key] = sl.toValue(+sl.input.value); }));
    sl.input.addEventListener('dblclick', () => { sl.input.blur(); setAdjust(a => { a[sl.key] = 100; }); });   // this slider back to normal
});
adjustInvert.addEventListener('change', () => setAdjust(a => { a.invert = adjustInvert.checked; }));
document.getElementById('btn-adjust-reset').addEventListener('click', () => {
    sess().adjust = { ...ADJUST_DEFAULTS };
    setAdjust(() => {});
});

/* Show original: a switch, on both buttons. Only the adjustments are dropped; the level rotation
   stays, so lines and points keep matching the picture. */
function toggleOriginal() {
    if (!isAdjusted(sess())) return;
    state.showOriginal = !state.showOriginal;
    render(); updateAdjustUI();
}
btnOriginal.addEventListener('click', toggleOriginal);
btnCardOriginal.addEventListener('click', toggleOriginal);

/* Fit: the whole photo, centred in the panel, as right after loading (never enlarged past 100 %) */
function fitPhoto(s = sess()) {
    const img = s.imgElement;
    if (!img) return;
    const cr = container.getBoundingClientRect();
    s.view.scale = Math.min(cr.width / img.width, cr.height / img.height, 1);
    s.view.tx = (cr.width  - img.width  * s.view.scale) / 2;
    s.view.ty = (cr.height - img.height * s.view.scale) / 2;
}
btnFit.addEventListener('click', () => { fitPhoto(); applyTransform(); render(); scheduleAutosave(); });

btnAdjust.addEventListener('click', (e) => {
    e.stopPropagation();
    adjustCard.style.display = adjustCard.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', (e) => {
    if (!adjustWrap.contains(e.target)) adjustCard.style.display = 'none';
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') adjustCard.style.display = 'none';
});

/* ============================================================
   JSON PICKER  (import trigger)
   ============================================================ */
const jsonPicker = document.getElementById('json-picker');
jsonPicker.addEventListener('change', () => {
    const file = jsonPicker.files[0];
    if (file) { importSessions(file); jsonPicker.value = ''; }
});

/* ============================================================
   EXPORT / IMPORT
   json_version 2: mapView.zoom is a MapLibre zoom (one less than the
   Leaflet zoom of v1 files) and mapView carries bearing and pitch.
   ============================================================ */
const JSON_VERSION = 2;

function sessionToData(s) {
    return {
        name:              s.name,
        imageFilename:     s.imageFilename || null,
        lines:             s.lines.map((l, lIdx) => ({
            label:   `L${lIdx + 1}`,
            x:       l.x,
            colour:  l.colour || null,
            source:  l.source || null,
            bearing: lineBearing(s, l),
            points:  l.points.map((pt, pIdx) => ({
                label: `L${lIdx + 1}P${pIdx + 1}`,
                y:     pt.y,
                geo:   pt.geo || null
            }))
        })),
        view:              { ...s.view },
        mapView:           s.mapView
            ? { center: { lat: s.mapView.center.lat, lng: s.mapView.center.lng }, zoom: s.mapView.zoom,
                bearing: s.mapView.bearing ?? 0, pitch: s.mapView.pitch ?? 0 }
            : null,
        intersection:      s.mapObjects.intersectionLatLng || null,
        exif:              s.exif || null,
        colourIndex:       s.colourIndex ?? null
    };
}

/* Bearing from the estimated position to the middle of a line's two map points: the number on the
   line's pill, in the session file and in the GIS export. null until both exist. */
function lineBearing(s, line) {
    const placed = line.points.filter(p => p.geo);
    const pos = s.mapObjects.intersectionLatLng;
    if (placed.length < 2 || !pos) return null;
    const mid = { lat: (placed[0].geo.lat + placed[1].geo.lat) / 2, lng: (placed[0].geo.lng + placed[1].geo.lng) / 2 };
    return Math.round(bearingDeg(pos, mid));
}

function downloadJSON(data, filename) {
    downloadText(JSON.stringify(data, null, 2), filename, 'application/json');
}

function downloadText(text, filename, type) {
    const blob = new Blob([text], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);   // some browsers read the file after click() returns
}

/* An image name as part of a file name: the characters Windows refuses become "_".
   The name inside the JSON stays as typed. */
function fileSafe(name) {
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
}

/* ---- EXPORT WITH PHOTOS ----
   Off by default and remembered in this browser. With it on, each session of an exported file
   carries its photo as `image: { name, type, dataUrl }` (base64, the file's own bytes: EXIF and GPS
   included), and the import restores it without asking for the image. The autosave never uses
   this: it keeps the photos as files next to the JSON.
   After sessionToProject in briatlon's build; the field layout is the same, so his files import too. */
function setExportPhotos(on) {
    exportPhotos = on;
    localStorage.setItem(EXPORT_PHOTOS_KEY, on ? '1' : '0');
}

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

/* sessionToData plus the photo, when the switch is on and the session has one */
async function sessionToExport(s) {
    const data = sessionToData(s);
    if (exportPhotos && s.imageFile) {
        data.image = {
            name:    s.imageFilename || s.imageFile.name || 'photo',
            type:    s.imageFile.type || 'image/jpeg',
            dataUrl: await blobToDataURL(s.imageFile)
        };
    }
    return data;
}

/* The photo of a session file as a File, or null when the entry is not a base64 image.
   Whether it really is a picture is decided by loadImage: what the browser cannot decode is rejected. */
const IMAGE_DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,/i;

function embeddedImageFile(image) {
    if (!image || typeof image !== 'object' || typeof image.dataUrl !== 'string') return null;
    const head = IMAGE_DATA_URL.exec(image.dataUrl.slice(0, 80));
    if (!head) return null;
    try {
        const bin   = atob(image.dataUrl.slice(head[0].length));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const name = typeof image.name === 'string' && image.name ? image.name.slice(0, 255) : 'photo';
        return new File([bytes], name, { type: head[1].toLowerCase() });
    } catch (err) {
        return null;   // broken base64: the session asks for its image as before
    }
}

async function exportSessions(list, filename, doneText) {
    if (!list.length) return showToast('Nothing to export yet: load a photo first.');
    try {
        const data = [];
        for (const s of list) data.push(await sessionToExport(s));
        downloadJSON({ json_version: JSON_VERSION, exported: new Date().toISOString(), sessions: data }, filename);
    } catch (err) {
        // A string the browser cannot hold, or a photo it could not read back
        return showToast(exportPhotos
            ? 'Export failed: the photos are too large for one file. Export the images one by one, or switch off "Include photos".'
            : 'Export failed.');
    }
    const withPhotos = exportPhotos && list.some(s => s.imageFile);
    showToast(doneText + (withPhotos ? ' Photos included.' : ''), 'success');
}

const exportStamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');

function exportSession(idx) {
    const s = sessions[idx];
    if (idx === activeSessionIndex) s.mapView = getMapView();
    return exportSessions([s], `tracepoint_${fileSafe(s.name)}_${exportStamp()}.json`, 'Session exported.');
}

function exportAllSessions() {
    if (sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].mapView = getMapView();
    }
    return exportSessions(sessions.filter(s => s.imgElement), `tracepoint_all_${exportStamp()}.json`, 'All sessions exported.');
}

/* ============================================================
   GIS EXPORT – the map work of every image as KML (Google Earth) or GeoJSON (QGIS, ArcGIS, …)
   The download button in the map bar, as in ShadowFinder Web. Grouped by image, and within an
   image by line: its ray and its map points. Built in the browser, nothing is uploaded. Export only:
   the session file (☰) stays the one to import again. Format notes: docs/export.md.
   ============================================================ */
const gisUi = {
    wrap:   document.getElementById('gis-export-wrap'),
    button: document.getElementById('btn-gis-export'),
    menu:   document.getElementById('gis-export-menu')
};
const GIS_RAY_KM      = 50;   // each way from P1, as on the map
const GIS_RAY_STEP_KM = 5;    // a vertex every 5 km keeps the ray on its great circle in other software

function hasRay(line) { return line.points.filter(p => p.geo).length >= 2; }

/* The ray through a line's two map points, from 50 km behind P1 to 50 km ahead, as [lng, lat] */
function gisRayCoords(line) {
    if (!hasRay(line)) return null;
    const [a, b] = line.points.filter(p => p.geo).map(p => p.geo);
    const bearing = bearingDeg(a, b), coords = [];
    for (let d = -GIS_RAY_KM; d <= GIS_RAY_KM; d += GIS_RAY_STEP_KM) {
        const p = destinationPoint(a, d < 0 ? bearing + 180 : bearing, Math.abs(d));
        coords.push([p.lng, p.lat]);
    }
    return coords;
}

/* What goes out: per image its name, position, ellipse and lines; images with nothing on the map are left out */
function gisGroups() {
    return sessions.map((s, sIdx) => ({
        name:     s.name,
        position: s.mapObjects.intersectionLatLng,
        ellipse:  s.mapObjects.ellipseRing,
        lines:    s.lines.map((line, lIdx) => ({
            label:   `L${lIdx + 1}`,
            colour:  line.colour || lineColour(lIdx, sIdx),
            source:  line.source || null,
            bearing: lineBearing(s, line),
            ray:     gisRayCoords(line),
            points:  line.points.map((p, pIdx) => p.geo && { point: `P${pIdx + 1}`, lat: p.geo.lat, lng: p.geo.lng }).filter(Boolean)
        })).filter(l => l.ray || l.points.length)
    })).filter(g => g.lines.length);
}

/* Longitudes into −180…180. MapLibre keeps them unwrapped past the antimeridian; a line or ring is
   moved as a whole, so one that crosses it stays in one piece. */
const lngShift = (lng) => 360 * Math.round(lng / 360);
const gisNum   = (n) => +n.toFixed(7);
function gisCoords(list) {
    const shift = lngShift(list[0][0]);
    return list.map(([lng, lat]) => [gisNum(lng - shift), gisNum(lat)]);
}
const gisPoint = (lat, lng) => gisCoords([[lng, lat]])[0];

function gisGeoJson(groups) {
    const features = [];
    const add = (geometry, properties) => features.push({ type: 'Feature', properties, geometry });
    groups.forEach(g => {
        if (g.position) {
            add({ type: 'Point', coordinates: gisPoint(g.position.lat, g.position.lng) },
                { image: g.name, kind: 'position', label: 'Estimated position' });
        }
        if (g.ellipse) {
            add({ type: 'Polygon', coordinates: [gisCoords(g.ellipse)] },   // counter-clockwise, as RFC 7946 asks
                { image: g.name, kind: 'ellipse', label: 'Error ellipse' });
        }
        g.lines.forEach(l => {
            const common = { image: g.name, line: l.label, colour: l.colour, source: l.source };
            if (l.ray) add({ type: 'LineString', coordinates: gisCoords(l.ray) },
                           { ...common, kind: 'ray', label: `${l.label} ray`, bearing: l.bearing });
            l.points.forEach(p => add({ type: 'Point', coordinates: gisPoint(p.lat, p.lng) },
                                      { ...common, kind: 'point', point: p.point, label: `${l.label} ${p.point}` }));
        });
    });
    return JSON.stringify({ type: 'FeatureCollection', name: 'TracePoint export', exported: new Date().toISOString(),
                            tracepoint_geojson_version: 1, features }, null, 2);
}

/* KML colours are aabbggrr */
const kmlColour = (hex, alpha = 'ff') => alpha + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);

function gisKml(groups) {
    const x = escHtml;
    const coords = (list) => gisCoords(list).map(([lng, lat]) => `${lng},${lat},0`).join(' ');
    const point  = (lat, lng) => coords([[lng, lat]]);
    const styleId = (hex) => 'c' + hex.slice(1).toLowerCase();
    const colours = new Set(groups.flatMap(g => g.lines.map(l => l.colour.toLowerCase())));
    const placemark = (name, style, geometry, description = '') =>
        `<Placemark><name>${x(name)}</name>${description ? `<description>${x(description)}</description>` : ''}` +
        `<styleUrl>#${style}</styleUrl>${geometry}</Placemark>`;

    const styles = [...colours].map(c =>
        `<Style id="${styleId(c)}"><IconStyle><color>${kmlColour(c)}</color><scale>0.8</scale></IconStyle>` +
        `<LabelStyle><scale>0.8</scale></LabelStyle><LineStyle><color>${kmlColour(c)}</color><width>2</width></LineStyle></Style>`
    ).join('') +
        `<Style id="position"><IconStyle><color>${kmlColour('#ffdc32')}</color><scale>1.2</scale></IconStyle></Style>` +
        `<Style id="ellipse"><LineStyle><color>${kmlColour('#ffdc32')}</color><width>1.5</width></LineStyle>` +
        `<PolyStyle><color>${kmlColour('#ffdc32', '33')}</color></PolyStyle></Style>`;

    const folders = groups.map(g => {
        const parts = [];
        if (g.position) {
            parts.push(placemark('Estimated position', 'position', `<Point><coordinates>${point(g.position.lat, g.position.lng)}</coordinates></Point>`,
                                 fmtCoords(g.position)));
        }
        if (g.ellipse) {
            parts.push(placemark('Error ellipse', 'ellipse',
                `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(g.ellipse)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`));
        }
        g.lines.forEach(l => {
            const name = l.label + (l.source === 'exif' ? ' · EXIF direction' : l.bearing !== null ? ` · ${String(l.bearing).padStart(3, '0')}°` : '');
            const items = [];
            if (l.ray) items.push(placemark(`${l.label} ray`, styleId(l.colour), `<LineString><tessellate>1</tessellate><coordinates>${coords(l.ray)}</coordinates></LineString>`));
            l.points.forEach(p => items.push(placemark(`${l.label} ${p.point}`, styleId(l.colour),
                `<Point><coordinates>${point(p.lat, p.lng)}</coordinates></Point>`, fmtCoords(p))));
            parts.push(`<Folder><name>${x(name)}</name>${items.join('')}</Folder>`);
        });
        return `<Folder><name>${x(g.name)}</name><open>1</open>${parts.join('')}</Folder>`;
    });

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>TracePoint export</name><open>1</open>' +
        styles + folders.join('') + '</Document></kml>\n';
}

function exportGis(kind) {
    closeGisMenu();
    const groups = gisGroups();
    if (!groups.length) return showToast('Nothing on the map to export yet.');
    const stamp = exportStamp();
    if (kind === 'kml') downloadText(gisKml(groups), `tracepoint_${stamp}.kml`, 'application/vnd.google-earth.kml+xml');
    else downloadText(gisGeoJson(groups), `tracepoint_${stamp}.geojson`, 'application/geo+json');
    showToast(`Exported ${groups.length} image${groups.length > 1 ? 's' : ''} as ${kind === 'kml' ? 'KML' : 'GeoJSON'}.`, 'success');
}

function renderGisMenu() {
    const menu = gisUi.menu;
    menu.innerHTML = '';
    el('div', 'map-panel-title', menu).textContent = 'Export for other software';
    const entry = (label, ext, hint, kind) => {
        const item = el('div', 'gis-export-item', menu);
        item.innerHTML =
            `<span class="export-icon"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="1" x2="5" y2="8"/><polyline points="2,5.5 5,8.5 8,5.5"/></svg></span>` +
            `<span class="gis-export-text"><span><b>${label}</b> <i>${ext}</i></span><small>${hint}</small></span>`;
        item.onclick = () => exportGis(kind);
    };
    entry('Google Earth', '.kml', 'A folder per image, inside it a folder per line with its ray and points', 'kml');
    entry('GIS', '.geojson', 'For QGIS, ArcGIS or geojson.io: every ray and point, labelled by image and line', 'geojson');
    el('div', 'gis-export-note', menu).textContent =
        'All images, with the estimated position and the error ellipse. To open the work in TracePoint again, use Export in the ☰ menu.';
}

function closeGisMenu() {
    gisUi.menu.style.display = 'none';
    gisUi.button.setAttribute('aria-expanded', 'false');
}

/* Greyed out until some image has a ray on the map; runs with every change of the rays (rebuildWorkSource) */
function updateGisButton() {
    const on = sessions.some(s => s.lines.some(hasRay));
    gisUi.button.disabled = !on;
    gisUi.button.title = on ? 'Export the rays and points for Google Earth or GIS' : 'Export for Google Earth or GIS: place a line on the map first';
    if (!on) closeGisMenu();
}

gisUi.button.addEventListener('click', () => {
    const open = gisUi.menu.style.display === 'none';
    if (!open) { closeGisMenu(); return; }
    renderGisMenu();
    gisUi.menu.style.display = 'block';
    gisUi.button.setAttribute('aria-expanded', 'true');
    hideHelp(); closeBasemapMenu();
    if (layerMenu) layerMenu.style.display = 'none';
});
document.addEventListener('click', (e) => { if (!gisUi.wrap.contains(e.target) && e.target.isConnected) closeGisMenu(); });
gisUi.menu.addEventListener('wheel', (e) => e.stopPropagation());
updateGisButton();

/* Builds sessions from the `sessions` array of a session file; every field is type-checked.
   Used by the JSON import and by the autosave restore. Returns the sessions it filled.
   keepView: the saved map view wins over the automatic zoom to the intersection. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;   // the only colour form a session file may carry: it ends up in styles

/* A map position from a file: plain numbers in range, nothing else carried over. Longitude may run
   past ±180 on purpose: MapLibre does not wrap a click on the next world copy, and a ray across the
   antimeridian only stays straight with its points unwrapped. */
function cleanGeo(g) {
    if (!g || !finite(g.lat) || !finite(g.lng) || Math.abs(g.lat) > 90 || Math.abs(g.lng) > 360) return null;
    return { lat: g.lat, lng: g.lng };
}

function applySessionData(list, keepView = false) {
    return list.filter(sd => sd && typeof sd === 'object').map((sd, i) => {
        // Only the first session of a file may take over the current slot, and only if that is completely
        // empty. A session waiting for its image has no image and maybe no lines yet, but it is not empty.
        const cur = sess();
        const name = typeof sd.name === 'string' && sd.name ? sd.name : 'Imported session';
        let s;
        if (i === 0 && !cur.imgElement && cur.lines.length === 0 && !cur.pendingImageFilename) {
            s = cur;
            s.name = name;
        } else {
            s = createSession(name);
            sessions.push(s);
        }

        if (Number.isInteger(sd.colourIndex) && sd.colourIndex >= 0 && sd.colourIndex < LINE_COLOURS.length) {
            s.colourIndex = sd.colourIndex;
        }
        if ('exif' in sd) s.exif = (sd.exif && typeof sd.exif === 'object') ? sd.exif : null;
        const filename = typeof sd.imageFilename === 'string' && sd.imageFilename ? sd.imageFilename : null;
        s.imageFilename        = filename;
        s.pendingImageFilename = filename;
        s.lines = (Array.isArray(sd.lines) ? sd.lines : [])
            .filter(l => l && finite(l.x))
            .slice(0, MAX_LINES)
            .map(l => ({
                x:      l.x,
                colour: typeof l.colour === 'string' && HEX_COLOUR.test(l.colour) ? l.colour : null,
                source: l.source === 'exif' ? 'exif' : null,
                points: (Array.isArray(l.points) ? l.points : [])
                    .filter(pt => pt && finite(pt.y))
                    .slice(0, 2)
                    .map(pt => ({ y: pt.y, geo: cleanGeo(pt.geo) }))
            }));
        if (sd.view && typeof sd.view === 'object') {
            const { scale, tx, ty, rotation } = sd.view;
            if (finite(scale) && scale > 0) {
                s.view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
                if (finite(tx)) s.view.tx = tx;
                if (finite(ty)) s.view.ty = ty;
            }
            if (finite(rotation)) s.view.rotation = rotation;
        }

        // Switch first — switchToSession saves the outgoing session's live map
        // position; setting s.mapView before the call would get overwritten when
        // s === sessions[activeSessionIndex] (reused empty slot case).
        switchToSession(sessions.indexOf(s));

        // Restore imported mapView after the switch so it can't be clobbered
        const centre = cleanGeo(sd.mapView?.center);
        if (centre && finite(sd.mapView.zoom)) {
            const num = (v) => finite(v) ? v : 0;
            s.mapView = {
                center:  centre,
                zoom:    Math.min(20, Math.max(0, sd.mapView.zoom)),
                bearing: num(sd.mapView.bearing),
                pitch:   Math.min(90, Math.max(0, num(sd.mapView.pitch)))
            };
            applyMapView(s.mapView);
        }

        if (keepView) s.hasAutoZoomed = true;
        s.lines.forEach((_, lIdx) => rebuildMapForLine(lIdx));
        recomputeIntersection();
        // A session that had not found its position yet may still zoom to it later
        if (keepView) s.hasAutoZoomed = !!s.mapObjects.intersectionLatLng;
        updateUI();
        historyReset(s);
        // A file exported with its photo brings it along: no "reload the image" step
        const photo = embeddedImageFile(sd.image);
        if (photo) loadImage(photo, s);
        return s;
    });
}

function importSessions(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const list = data.sessions;
            if (!Array.isArray(list) || list.length === 0) return showToast('No sessions found in file.');
            const n = applySessionData(list).length;
            renderSessionMenu();
            if (!n) return showToast('No sessions found in file.');
            showToast(`${n} session${n > 1 ? 's' : ''} imported.`, 'success');
        } catch (err) {
            showToast('Invalid TracePoint session file.');
        }
    };
    reader.readAsText(file);
}

/* ============================================================
   AUTOSAVE
   The work is kept in IndexedDB (database "tracepoint") so a refresh does not lose it:
   key "session" holds the same JSON the export writes (all sessions, plus each session's
   id and the active index), key "img:<session id>" holds the image file of a session.
   Nothing leaves the browser. A hard reload does not clear it; the Autosave switch and
   the Clear button in the session menu do.
   ============================================================ */
const AUTOSAVE_STORE = 'autosave';
let autosaveDb = null;        // Promise<IDBDatabase>, opened on first use
let autosaveWarned = false;

/* The store is shared by every tab of this site, and a write removes the images it does not know.
   So only one tab writes: the one holding the Web Lock. A second tab still restores the saved work
   but keeps its changes to itself until the first tab is closed, then takes over. */
const AUTOSAVE_LOCK = 'tracepoint-autosave';

function claimAutosave() {
    if (!navigator.locks) return Promise.resolve();
    const hold = () => new Promise(() => {});   // never settles: the lock lasts as long as the tab
    return new Promise(resolve => {
        navigator.locks.request(AUTOSAVE_LOCK, { ifAvailable: true }, (lock) => {
            if (!lock) { resolve(); return; }
            autosaveOwner = true;
            resolve();
            return hold();
        }).catch(() => { autosaveOwner = true; resolve(); });
    }).then(() => {
        if (autosaveOwner) return;
        if (autosaveOn) showToast('TracePoint is open in another tab. Autosave is paused here until that tab is closed.');
        navigator.locks.request(AUTOSAVE_LOCK, () => {
            autosaveOwner = true;
            if (autosaveOn && autosaveReady) { sessions.forEach(autosavePutImage); autosaveWrite(); }
            return hold();
        }).catch(() => {});
    });
}

function openAutosaveDb() {
    if (!autosaveDb) autosaveDb = new Promise((resolve, reject) => {
        const req = indexedDB.open('tracepoint', 1);
        req.onupgradeneeded = () => req.result.createObjectStore(AUTOSAVE_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
    return autosaveDb;
}

/* One transaction on the store; resolves with the result of the request fn returns (if any) */
function autosaveTx(mode, fn) {
    return openAutosaveDb().then(db => new Promise((resolve, reject) => {
        const tx  = db.transaction(AUTOSAVE_STORE, mode);
        const req = fn(tx.objectStore(AUTOSAVE_STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
    }));
}

function autosaveFailed() {
    if (autosaveWarned) return;
    autosaveWarned = true;
    showToast('Autosave failed: browser storage is full or blocked.');
}

function sessionsHaveWork() {
    return sessions.some(s => s.imgElement || s.lines.length > 0 || s.pendingImageFilename);
}

function scheduleAutosave() {
    if (!autosaveOn || !autosaveReady || !autosaveOwner) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveWrite, 400);
}

function autosaveWrite() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (!autosaveOn || !autosaveReady || !autosaveOwner) return;
    if (sessions[activeSessionIndex]) sessions[activeSessionIndex].mapView = getMapView();
    const json = sessionsHaveWork()
        ? JSON.stringify({ json_version: JSON_VERSION, exported: new Date().toISOString(), active: activeSessionIndex,
                           sessions: sessions.map(s => ({ ...sessionToData(s), id: s.id })) })
        : null;
    const keep = new Set(sessions.map(s => 'img:' + s.id));
    autosaveTx('readwrite', store => {
        if (json) store.put(json, 'session'); else store.delete('session');
        store.getAllKeys().onsuccess = (e) => {
            const have = new Set(e.target.result);
            // images of removed sessions go too
            have.forEach(k => { if (k !== 'session' && !keep.has(k)) store.delete(k); });
            // and a photo missing from the store (deleted from another tab) is put back
            sessions.forEach(s => { if (s.imageFile && !have.has('img:' + s.id)) store.put(s.imageFile, 'img:' + s.id); });
        };
    }).catch(autosaveFailed);
}

function autosavePutImage(s) {
    if (!autosaveOn || !autosaveOwner || !s.imageFile) return;
    autosaveTx('readwrite', store => { store.put(s.imageFile, 'img:' + s.id); }).catch(autosaveFailed);
}

function autosaveClearStore() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    return autosaveTx('readwrite', store => { store.clear(); }).catch(() => {});
}

/* Back to one empty session. The map keeps its view unless resetMap is set. */
function resetWorkspace(resetMap) {
    sessions.forEach(s => {
        removeSessionMarkers(s);
        if (s.currentObjectURL) URL.revokeObjectURL(s.currentObjectURL);
    });
    sessions = [createSession('Image 1')];
    activeSessionIndex = sessions.length;   // out of range → switchToSession skips its save step
    switchToSession(0);
    rebuildWorkSource();
    if (resetMap) applyMapView(WORLD_VIEW);
}

/* Runs once, at the end of this script. A view in the URL hash wins over the saved map view. */
async function autosaveRestore() {
    await claimAutosave();
    if (!autosaveOn) { if (autosaveOwner) await autosaveClearStore(); autosaveReady = true; return; }
    let json = null;
    try { json = await autosaveTx('readonly', store => store.get('session')); }
    catch (err) { autosaveReady = true; return; }   // no IndexedDB here: work without autosave
    if (json != null) {
        try {
            const data = JSON.parse(json);
            if (!Array.isArray(data.sessions) || data.sessions.length === 0) throw new Error('no sessions');
            const hashView = parseViewHash(location.hash);
            const saved    = data.sessions.filter(sd => sd && typeof sd === 'object');   // same filter as applySessionData
            const restored = applySessionData(saved, true);
            restored.forEach((s, i) => {
                const id = saved[i].id;
                if (typeof id === 'string' && id) s.id = id;
            });
            for (const s of restored) {
                const file = await autosaveTx('readonly', store => store.get('img:' + s.id));
                if (file instanceof Blob) loadImage(file, s, true);
            }
            switchToSession(Number.isInteger(data.active) && sessions[data.active] ? data.active : 0);
            if (hashView) applyMapView(hashView);
        } catch (err) {
            if (autosaveOwner) await autosaveClearStore();
            resetWorkspace(false);
            showToast('Saved session could not be restored. Starting fresh.');
        }
    }
    autosaveReady = true;
}

function setAutosave(on) {
    autosaveOn = on;
    localStorage.setItem(AUTOSAVE_KEY, on ? '1' : '0');
    if (on) {
        autosaveWarned = false;
        sessions.forEach(autosavePutImage);
        autosaveWrite();
        showToast(autosaveOwner ? 'Autosave on. Work is kept in this browser.'
                                : 'Autosave on. The other TracePoint tab saves its work; this tab saves once that one is closed.', 'success');
    } else {
        autosaveClearStore();
        showToast('Autosave off. Saved copy deleted.', 'success');
    }
}

/* The switch is shared by all tabs (localStorage). Switched in another tab, it holds here too:
   off stops this tab's writes at once (that tab has deleted the saved copy already), on lets the
   tab that holds the store write it again. */
window.addEventListener('storage', (e) => {
    if (e.key !== AUTOSAVE_KEY) return;
    const on = e.newValue !== '0';
    if (on === autosaveOn) return;
    autosaveOn = on;
    if (!on) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    else if (autosaveOwner && autosaveReady) { autosaveWarned = false; sessions.forEach(autosavePutImage); autosaveWrite(); }
    renderSessionMenu();
});

function clearSavedSession() {
    // The saved copy belongs to the tab that writes it; deleting it from here would only lose its photos
    if (!autosaveOwner) return showToast('TracePoint is open in another tab. Clear the saved session there.');
    if (!confirm('Delete the saved session and start empty? This cannot be undone.')) return;
    autosaveClearStore().then(() => {
        resetWorkspace(true);
        showToast('Saved session cleared.', 'success');
    });
}

/* Every edit ends with a mouse or key release; the debounce folds them into one write.
   Leaving or hiding the tab writes what is still pending. */
window.addEventListener('mouseup', scheduleAutosave);
window.addEventListener('keyup',   scheduleAutosave);
document.addEventListener('visibilitychange', () => { if (document.hidden && autosaveTimer) autosaveWrite(); });
window.addEventListener('pagehide', () => { if (autosaveTimer) autosaveWrite(); });

/* ============================================================
   ZOOM  (wheel on container)
   ============================================================ */
container.addEventListener('wheel', (e) => {
    if (!sess().imgElement) return;
    e.preventDefault();
    if (!e.deltaY) return;   // a sideways scroll is not a zoom
    const v = sess().view;
    const rect   = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // One wheel notch (about 100 px) zooms 12 %; a trackpad's many small steps add up to the same
    const px     = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
    const factor = Math.pow(1.12, -Math.max(-1, Math.min(1, px / 100)));
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    v.tx = mouseX - (mouseX - v.tx) * (newScale / v.scale);
    v.ty = mouseY - (mouseY - v.ty) * (newScale / v.scale);
    v.scale = newScale;
    applyTransform();   // also redraws the lines: their widths and labels follow the zoom
}, { passive: false });

/* ============================================================
   PAN  (middle-click drag  OR  space + left-drag)
   ============================================================ */
let spaceDown = false;
const CLICK_SLOP = 4;   // screen px the mouse may move between press and release and still count as a click
document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    // Not on a focused button or link: Space presses those
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag)) {
        spaceDown = true; e.preventDefault();
    }
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
/* A key or button released while the window is not focused never reports back */
window.addEventListener('blur', () => {
    spaceDown = false;
    panPress = null;
    if (isPanning) { isPanning = false; container.style.cursor = ''; }
});

let panPress = null;   // a left press on empty photo: becomes a pan once the mouse travels, else stays a click
container.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
        isPanning = true;
        panStart  = { x: e.clientX, y: e.clientY };
        panOrigin = { tx: sess().view.tx, ty: sess().view.ty };
        container.style.cursor = 'grabbing';
        e.preventDefault();
        return;
    }
    // The photo's own handler runs first: a press on a line or point is its business. The level tool needs its clicks.
    if (e.button !== 0 || !sess().imgElement || state.mode === 'horizon') return;
    if (e.target !== container && !(e.target === canvas && !state.press && !state.pointDrag)) return;
    panPress = { x: e.clientX, y: e.clientY };
    e.preventDefault();   // no text selection while dragging
});
window.addEventListener('mousemove', (e) => {
    if (!panPress) return;
    if (e.buttons !== 1) { panPress = null; return; }   // released outside the window
    if (Math.hypot(e.clientX - panPress.x, e.clientY - panPress.y) <= CLICK_SLOP) return;
    isPanning = true;
    panStart  = panPress;   // from where the press began, so the photo stays under the mouse
    panOrigin = { tx: sess().view.tx, ty: sess().view.ty };
    container.style.cursor = 'grabbing';
    panPress = null;
});
window.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; container.style.cursor = ''; }
    panPress = null;
    const wasLineDrag = state.isDragging, press = state.press;
    state.isDragging = false;
    state.press = null;
    if (state.pointDrag) { state.pointDrag = null; updateUI(); }
    else if (wasLineDrag) updateUI();   // one undo step, and the guide moves on from "drag the line"
    else if (press && press.wasActive) addPhotoPoint(press.lineIndex, press.imgY);   // a click on the active line
});
window.addEventListener('mousemove', (e) => {
    if (isPanning && e.buttons === 0) { isPanning = false; container.style.cursor = ''; }   // released outside the window
    if (isPanning) {
        sess().view.tx = panOrigin.tx + (e.clientX - panStart.x);
        sess().view.ty = panOrigin.ty + (e.clientY - panStart.y);
        applyTransform();
    }
    if (state.pointDrag) {
        state.pointDrag.pt.y = Math.max(0, Math.min(canvas.height, clientToImage(e).y));
        render();
        return;
    }
    // A press on a line becomes a drag once the mouse has travelled a little; until then it may still be a click
    if (state.press && Math.hypot(e.clientX - state.press.x, e.clientY - state.press.y) > CLICK_SLOP) {
        const line = sess().lines[state.press.lineIndex];
        state.press = null;
        if (line) { state.isDragging = true; line.pristine = false; }
    }
    if (state.isDragging && state.activeLineIndex !== -1) {
        sess().lines[state.activeLineIndex].x = Math.max(0, Math.min(canvas.width, clientToImage(e).x));   // stays on the image
        render();
    }
});

/* ============================================================
   CANVAS DRAWING
   ============================================================ */
function render() {
    const s = sess();
    if (s.imgElement) drawPhoto(s);
    drawLines();
}

/* The line canvas covers the photo panel at the screen's own resolution */
function sizeLineCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(container.clientWidth * dpr));
    const h = Math.max(1, Math.round(container.clientHeight * dpr));
    if (lineCanvas.width !== w || lineCanvas.height !== h) { lineCanvas.width = w; lineCanvas.height = h; }
    return dpr;
}
new ResizeObserver(() => drawLines()).observe(container);

function stopPulse() {
    if (pulseFrameId !== null) { cancelAnimationFrame(pulseFrameId); pulseFrameId = null; }
}

/* Lines, points and the level tool's guide line. Drawn in image pixels through the photo's view
   transform, onto a canvas the size of the panel: cheap enough for every animation frame. */
function drawLines() {
    const s = sess();
    const dpr = sizeLineCanvas();
    const ctx = lctx;   // everything below draws on the line canvas, never on the photo
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
    if (!s || !s.imgElement) { stopPulse(); return; }
    const v = s.view;
    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.tx * dpr, v.ty * dpr);

    /* Lines live in image pixels. Zoomed out, a 1.5 px line on a 12 MP photo would be a fraction of a
       screen pixel, so every size is multiplied by k to keep it constant on screen. Zoomed in past
       100 % the sizes stay in image pixels and grow with the photo. */
    const k = Math.max(1, 1 / v.scale);
    const blurScale = v.scale * dpr;   // shadowBlur ignores the transform: it is in canvas pixels

    let needsRerender = false;
    ctx.font = `bold ${11 * k}px monospace`;
    const sel    = state.selectedPoint;
    const target = state.mode === 'map-point' ? state.mapPointTarget : null;

    s.lines.forEach((line, idx) => {
        const active    = idx === state.activeLineIndex;
        const colour    = line.colour || lineColour(idx, activeSessionIndex);
        const alpha = (active || line.pristine) ? 1.0 : 0.5;

        if (line.pristine) needsRerender = true;

        ctx.globalAlpha = alpha;

        // Pulsing glow for untouched lines — persists until the user grabs and drags
        if (line.pristine) {
            const pulse = Math.sin(Date.now() / 250);   // -1 … +1
            ctx.shadowColor = colour;
            // 10 … 34 screen px when zoomed out; zoomed in it grows with the photo, up to a limit
            // (a blur hundreds of pixels wide costs more than the whole rest of the frame)
            ctx.shadowBlur  = Math.min((22 + 12 * pulse) * k * blurScale, 80 * dpr);
        }

        // The line stops at each point's ring, so the pixel under the point stays visible
        const RING = 7 * k;
        ctx.beginPath();
        let from = 0;
        line.points.map(pt => pt.y).sort((a, b) => a - b).forEach(y => {
            if (y - RING > from) { ctx.moveTo(line.x, from); ctx.lineTo(line.x, y - RING); }
            from = Math.max(from, y + RING);
        });
        if (from < canvas.height) { ctx.moveTo(line.x, from); ctx.lineTo(line.x, canvas.height); }
        ctx.strokeStyle = colour;
        ctx.lineWidth   = (line.pristine ? 3.5 : (active ? 2.5 : 1.5)) * k;
        ctx.setLineDash(active || line.pristine ? [] : [6 * k, 4 * k]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur  = 0;

        line.points.forEach((pt, pIdx) => {
            const hasGeo = !!(pt.geo);

            const isSel    = !!sel && sel.lineIndex === idx && sel.pointIndex === pIdx;
            const isTarget = !!target && target.lineIndex === idx && target.pointIndex === pIdx;
            if (isSel || isTarget) ctx.globalAlpha = 1;

            // Waiting for its map click: the ring breathes (filled, fading in and out) and sends out
            // a second ring that grows and fades, once every 1.2 s
            if (isTarget) {
                needsRerender = true;
                const phase = (Date.now() % 1200) / 1200;   // 0 … 1
                ctx.beginPath();
                ctx.arc(line.x, pt.y, RING, 0, Math.PI * 2);
                ctx.fillStyle   = colour;
                ctx.globalAlpha = 0.25 + 0.25 * Math.sin(phase * 2 * Math.PI);   // 0 … 0.5
                ctx.fill();
                ctx.beginPath();
                ctx.arc(line.x, pt.y, RING + 14 * k * phase, 0, Math.PI * 2);
                ctx.strokeStyle = colour;
                ctx.lineWidth   = 2.5 * k;
                ctx.globalAlpha = 0.9 * (1 - phase);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Open ring; a point that is placed on the map gets two side arms
            ctx.beginPath();
            ctx.arc(line.x, pt.y, RING, 0, Math.PI * 2);
            if (hasGeo) {
                ctx.moveTo(line.x - 15 * k, pt.y); ctx.lineTo(line.x - RING, pt.y);
                ctx.moveTo(line.x + RING, pt.y);   ctx.lineTo(line.x + 15 * k, pt.y);
            }
            ctx.strokeStyle = colour;
            ctx.lineWidth   = (isSel ? 3.5 : 2) * k;
            ctx.stroke();

            // Selected (here or on the map): a faint second ring around it
            if (isSel) {
                ctx.beginPath();
                ctx.arc(line.x, pt.y, RING + 5 * k, 0, Math.PI * 2);
                ctx.globalAlpha = 0.45;
                ctx.lineWidth   = 1.5 * k;
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            ctx.fillStyle   = '#fff';
            ctx.fillText(`P${pIdx + 1}`, line.x + (hasGeo ? 19 : 12) * k, pt.y + 4 * k);
            ctx.globalAlpha = alpha;
        });

        ctx.globalAlpha = 1;
    });

    if (needsRerender) {
        if (pulseFrameId === null)
            pulseFrameId = requestAnimationFrame(() => { pulseFrameId = null; drawLines(); });
    } else {
        stopPulse();
    }

    if (state.mode === 'horizon' && s.horizonPoints.length > 0) {
        const p1 = s.horizonPoints[0];
        const p2 = s.horizonPoints[1] || state._horizonMouse;
        ctx.save();
        ctx.strokeStyle = '#ffdc32';
        ctx.lineWidth   = 1.5 * k;
        ctx.setLineDash([5 * k, 4 * k]);
        if (p2) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 5 * k, 0, Math.PI * 2);
        ctx.fillStyle = '#ffdc32';
        ctx.fill();
        ctx.restore();
    }
}

/* ============================================================
   CANVAS INTERACTIONS  (all coords go through clientToImage)
   ============================================================ */
canvas.addEventListener('mousedown', (e) => {
    if (isPanning || spaceDown || e.button !== 0) return;
    if (state.mode === 'horizon') return;
    const { x: mx, y: my } = clientToImage(e);
    const THRESH = 12 / sess().view.scale;

    // A point's ring selects the point and grabs it (slide along its line); otherwise the line itself
    let ptHit = null;
    const PT_THRESH = Math.max(THRESH, 8);   // zoomed in, the ring is 7 image px and larger than the 12 screen px
    sess().lines.forEach((line, idx) => line.points.forEach((pt, pIdx) => {
        if (Math.hypot(line.x - mx, pt.y - my) < PT_THRESH) ptHit = { line, pt, idx, pIdx };
    }));
    if (ptHit) {
        keepPlacement(ptHit.idx);
        state.activeLineIndex = ptHit.idx;
        state.selectedPoint = { lineIndex: ptHit.idx, pointIndex: ptHit.pIdx };
        if (state.mode !== 'map-point') state.mode = 'drag-line';
        state.pointDrag = { line: ptHit.line, pt: ptHit.pt, origY: ptHit.pt.y };
        ptHit.line.pristine = false;
        render(); updateUI();
        return;
    }

    // A line: the active one wins where two lie close together. Whether this press moves the line or,
    // on the active line, places a point is decided by the mouse travel (see mousemove and mouseup).
    let hit = -1;
    sess().lines.forEach((line, idx) => { if (Math.abs(line.x - mx) < THRESH) hit = idx; });
    const active = sess().lines[state.activeLineIndex];
    if (active && Math.abs(active.x - mx) < THRESH) hit = state.activeLineIndex;
    if (hit !== -1) {
        state.press = { lineIndex: hit, wasActive: hit === state.activeLineIndex, x: e.clientX, y: e.clientY, imgY: my };
        selectLine(hit);
    } else {
        // Next to the lines: nothing is selected, and a point waiting for its map click stops waiting
        state.mapPointTarget = null;
        state.selectedPoint = null;
        state.activeLineIndex = -1;
        state.mode = 'idle';
        render(); updateUI();
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (state.mode === 'horizon') {
        state._horizonMouse = clientToImage(e);
        render();
    }
});

canvas.addEventListener('click', (e) => {
    if (isPanning || spaceDown) return;

    if (state.mode === 'horizon') {
        const pt = clientToImage(e);
        sess().horizonPoints.push(pt);
        if (sess().horizonPoints.length === 2) {
            const [p1, p2] = sess().horizonPoints;
            let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
            // Clicked right to left the angle is near ±180°; the horizon is the same line, so the photo
            // must not turn upside down
            if (angle > 90) angle -= 180;
            else if (angle < -90) angle += 180;
            sess().view.rotation = -angle;
            state.mode = 'idle';
            sess().horizonPoints = [];
            state._horizonMouse = null;
        }
        render(); updateUI();
    }
});

/* Copy coordinates button inside intersection popup */
document.getElementById('map-container').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="copy-coords"]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.coords)
        .then(() => showToast('Coordinates copied.', 'success'))
        .catch(() => showToast('Could not copy to clipboard.'));
});

/* ============================================================
   MAP CONTEXT MENU – right-click: copy coordinates, open in other maps
   MapLibre fires 'contextmenu' only for a right-click without drag (right-drag rotates).
   Links are plain hrefs: nothing is requested until one is clicked.
   ============================================================ */
const ctxMenu = el('div', 'map-ctx-menu', document.getElementById('map-container'));
ctxMenu.style.display = 'none';

/* The other services count zoom in 256px tiles, MapLibre in 512px: one level apart */
const CTX_LINKS = [
    ['Google Maps',  (la, ln, z) => `https://www.google.com/maps/search/?api=1&query=${la},${ln}`],
    ['Street View',  (la, ln, z) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${la},${ln}`],
    ['Google Earth', (la, ln, z) => `https://earth.google.com/web/@${la},${ln},0a,2000d,35y,0h,0t,0r`],
    ['OpenStreetMap', (la, ln, z) => `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=${z}/${la}/${ln}`]
];
/* The "Open in…" submenu. Formats after briatlon's mapLocationMenu.js. Yandex wants longitude first;
   Baidu is given WGS84 and converts on its side; Mapillary and Lookmap count zoom like MapLibre. */
const CTX_MORE_LINKS = [
    ['Apple Maps',   (la, ln, z) => `https://maps.apple.com/?ll=${la},${ln}&q=${la},${ln}&z=${z}`],
    ['Lookmap',      (la, ln, z) => `https://lookmap.skzk.dev/#c=${z - 1}/${la}/${ln}`],
    ['Bing Maps',    (la, ln, z) => `https://www.bing.com/maps?cp=${la}~${ln}&lvl=${z}&sp=point.${la}_${ln}_Pin`],
    ['Mapillary',    (la, ln, z) => `https://www.mapillary.com/app/?lat=${la}&lng=${ln}&z=${z - 1}`],
    ['Yandex Maps',  (la, ln, z) => `https://yandex.com/maps/?ll=${ln},${la}&z=${z}&pt=${ln},${la}`],
    ['Baidu Maps',   (la, ln, z) => `https://api.map.baidu.com/marker?location=${la},${ln}&coord_type=wgs84&title=TracePoint&content=${la},${ln}&output=html&src=webapp.tracepoint`]
];

/* The submenu is an element of its own next to the menu (the menu clips what it contains) */
const ctxSub = el('div', 'map-ctx-menu map-ctx-sub', document.getElementById('map-container'));
ctxSub.style.display = 'none';
let ctxSubTimer = null;

function hideCtxSub()  { clearTimeout(ctxSubTimer); ctxSub.style.display = 'none'; }
function hideCtxMenu() { ctxMenu.style.display = 'none'; hideCtxSub(); }

/* Right of the menu, level with its "Open in…" row; left of it when the map ends there */
function showCtxSub(trigger) {
    clearTimeout(ctxSubTimer);
    const box = map.getContainer().getBoundingClientRect();
    const m = ctxMenu.getBoundingClientRect(), t = trigger.getBoundingClientRect();
    ctxSub.style.display = 'block';
    const w = ctxSub.offsetWidth, h = ctxSub.offsetHeight;
    const left = m.right - box.left + w > box.width ? m.left - box.left - w + 1 : m.right - box.left - 1;
    ctxSub.style.left = `${Math.max(0, left)}px`;
    ctxSub.style.top  = `${Math.max(0, Math.min(t.top - box.top, box.height - h))}px`;
}
/* Leaving towards the submenu must not close it on the way: closing waits a moment */
function leaveCtxSub() { clearTimeout(ctxSubTimer); ctxSubTimer = setTimeout(hideCtxSub, 250); }
ctxSub.addEventListener('mouseenter', () => clearTimeout(ctxSubTimer));
ctxSub.addEventListener('mouseleave', leaveCtxSub);

map.on('contextmenu', (e) => {
    e.preventDefault();
    const la = e.lngLat.lat.toFixed(6);
    const ln = e.lngLat.lng.toFixed(6);
    const z  = Math.round(map.getZoom()) + 1;

    ctxMenu.innerHTML = '';
    const head = el('div', 'map-ctx-head', ctxMenu);
    head.textContent = `${la}, ${ln}`;

    const copy = el('button', 'map-ctx-item', ctxMenu);
    copy.type = 'button';
    copy.textContent = 'Copy coordinates';
    copy.onclick = () => {
        hideCtxMenu();
        navigator.clipboard.writeText(`${la}, ${ln}`)
            .then(() => showToast('Coordinates copied.', 'success'))
            .catch(() => showToast('Could not copy to clipboard.'));
    };

    const measureItem = el('button', 'map-ctx-item', ctxMenu);
    measureItem.type = 'button';
    measureItem.textContent = 'Measure distance from here';
    measureItem.onclick = () => { hideCtxMenu(); startMeasure({ lat: e.lngLat.lat, lng: e.lngLat.lng }); };

    const streetItem = el('button', 'map-ctx-item', ctxMenu);
    streetItem.type = 'button';
    streetItem.textContent = 'Street-level imagery here';
    streetItem.onclick = () => {
        hideCtxMenu();
        const spot = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        if (street.open) streetLookAt(spot); else setStreetOpen(true, spot);
    };

    el('div', 'map-ctx-divider', ctxMenu);
    const addLink = (parent, text, href) => {
        const a = el('a', 'map-ctx-item', parent);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = text;
        a.onclick = hideCtxMenu;
        return a;
    };
    CTX_LINKS.forEach(([label, url]) => addLink(ctxMenu, `Open in ${label}`, url(la, ln, z))
        .addEventListener('mouseenter', leaveCtxSub));

    // "Open in…" opens the submenu on hover and on click
    const more = el('button', 'map-ctx-item map-ctx-more', ctxMenu);
    more.type = 'button';
    more.textContent = 'Open in…';
    more.setAttribute('aria-haspopup', 'true');
    more.addEventListener('mouseenter', () => showCtxSub(more));
    more.addEventListener('mouseleave', leaveCtxSub);
    more.onclick = () => { if (ctxSub.style.display === 'none') showCtxSub(more); else hideCtxSub(); };
    hideCtxSub();
    ctxSub.innerHTML = '';
    CTX_MORE_LINKS.forEach(([label, url]) => addLink(ctxSub, label, url(la, ln, z)));

    // Place at the click, flipped so it stays inside the map
    const box = map.getContainer().getBoundingClientRect();
    ctxMenu.style.display = 'block';
    const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    const x = e.point.x + w > box.width  ? e.point.x - w : e.point.x;
    const y = e.point.y + h > box.height ? e.point.y - h : e.point.y;
    ctxMenu.style.left = `${Math.max(0, x)}px`;
    ctxMenu.style.top  = `${Math.max(0, y)}px`;
});

map.on('click',     hideCtxMenu);
map.on('movestart', hideCtxMenu);
document.addEventListener('keydown',   (e) => { if (e.key === 'Escape') hideCtxMenu(); });
document.addEventListener('mousedown', (e) => { if (!ctxMenu.contains(e.target) && !ctxSub.contains(e.target)) hideCtxMenu(); });

/* ============================================================
   MAP INTERACTION – place geo points
   ============================================================ */
map.on('click', (e) => {
    if (measure.active) { measureClick(e.lngLat); return; }   // a map click never both measures and places
    if (state.mode !== 'map-point' || !state.mapPointTarget) return;
    if (e.originalEvent?.target?.closest?.('.geo-point')) return;   // clicking an existing marker never places a point
    const { lineIndex, pointIndex } = state.mapPointTarget;
    const line = sess().lines[lineIndex];
    if (!line || !line.points[pointIndex]) return;

    line.points[pointIndex].geo = { lat: e.lngLat.lat, lng: e.lngLat.lng };

    rebuildMapForLine(lineIndex);
    recomputeIntersection();

    const nextUnplaced = line.points.findIndex((pt, i) => i > pointIndex && !pt.geo);
    if (nextUnplaced !== -1) {
        state.mapPointTarget = { lineIndex, pointIndex: nextUnplaced };
    } else {
        state.mode = 'drag-line';
        state.mapPointTarget = null;
    }

    render(); updateUI();
});

/* ============================================================
   MAP OBJECTS – markers & rays
   ============================================================ */
/* Rays and ellipses of all sessions share one GeoJSON source; markers are DOM elements.
   Everything is visible at once, as before (sessions used to each have a layer group on the map). */
map.on('load', () => {
    map.addSource('work', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'ellipse', type: 'fill', source: 'work', filter: ['==', ['get', 'kind'], 'ellipse'],
        paint: { 'fill-color': '#ffdc32', 'fill-opacity': 0.08 }
    });
    map.addLayer({
        id: 'ellipse-line', type: 'line', source: 'work', filter: ['==', ['get', 'kind'], 'ellipse'],
        paint: { 'line-color': '#ffdc32', 'line-width': 1.5, 'line-dasharray': [2, 2] }
    });
    map.addLayer({
        id: 'rays', type: 'line', source: 'work', filter: ['==', ['get', 'kind'], 'ray'],
        paint: { 'line-color': ['get', 'colour'], 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [3, 2] }
    });
    // Distance measurement: on top of everything else drawn on the map
    map.addSource('measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [3, 3] }
    });
    map.addLayer({
        id: 'measure-points', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 1.5 }
    });
    map.addSource('dem', {
        type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrarium</a> via AWS'
    });
    /* Hillshade gets a DEM source of its own (same tiles): sharing one with the 3D terrain makes
       MapLibre render both from a lower-resolution copy. Hidden layers request nothing. */
    map.addSource('dem-shade', {
        type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrarium</a> via AWS'
    });
    map.addLayer({
        id: 'hillshade', type: 'hillshade', source: 'dem-shade', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff', 'hillshade-accent-color': '#000' }
    }, 'ellipse');   // above the basemap, below rays and ellipse
    mapReady = true;
    setTileSet(activeTileSetId);
    applyMapSettings();
    rebuildWorkSource();
});

function rayFeature(line, colour) {
    const placed = line.points.filter(p => p.geo);
    if (placed.length < 2) return null;
    const p1 = placed[0].geo;
    const p2 = placed[1].geo;
    const bearing = bearingDeg(p1, p2);
    const RAY_KM  = 50;
    const fwd     = destinationPoint(p1, bearing,       RAY_KM);
    const bwd     = destinationPoint(p1, bearing + 180, RAY_KM);
    return {
        type: 'Feature', properties: { kind: 'ray', colour },
        geometry: { type: 'LineString', coordinates: [[bwd.lng, bwd.lat], [p1.lng, p1.lat], [p2.lng, p2.lat], [fwd.lng, fwd.lat]] }
    };
}

function rebuildWorkSource() {
    updateGisButton();       // the export follows the rays
    if (!mapReady) return;   // run again from the map's load handler
    const features = [];
    sessions.forEach((s, sIdx) => {
        s.lines.forEach((line, lIdx) => {
            const f = rayFeature(line, line.colour || lineColour(lIdx, sIdx));
            if (f) features.push(f);
        });
        if (s.mapObjects.ellipseRing) {
            features.push({ type: 'Feature', properties: { kind: 'ellipse' },
                            geometry: { type: 'Polygon', coordinates: [s.mapObjects.ellipseRing] } });
        }
    });
    map.getSource('work').setData({ type: 'FeatureCollection', features });
}

function removeSessionMarkers(s) {
    const mo = s.mapObjects;
    mo.geoMarkers.forEach(list => (list || []).forEach(m => m.remove()));
    mo.geoMarkers = [];
    if (mo.intersectionMarker) { mo.intersectionMarker.remove(); mo.intersectionMarker = null; }
    if (s.exifGpsMarker)       { s.exifGpsMarker.remove();       s.exifGpsMarker = null; }
}

function clearMapObjectsForLine(lIdx) {
    const mo = sess().mapObjects;
    if (mo.geoMarkers[lIdx]) {
        mo.geoMarkers[lIdx].forEach(m => m.remove());
        mo.geoMarkers[lIdx] = [];
    }
}

function rebuildMapForLine(lIdx) {
    clearMapObjectsForLine(lIdx);
    const s      = sess();
    const line   = s.lines[lIdx];
    const colour = line.colour || lineColour(lIdx, activeSessionIndex);
    const mo     = s.mapObjects;

    if (!mo.geoMarkers[lIdx]) mo.geoMarkers[lIdx] = [];

    line.points.forEach((pt, pIdx) => {
        if (!pt.geo) return;
        const node = el('div', 'geo-point');
        const dot  = el('div', 'geo-point-dot', node);
        dot.style.background  = colour + 'e6';   // 90% fill, solid stroke, as the Leaflet marker had
        dot.style.borderColor = colour;
        dot.style.color       = colour;   // hover halo uses currentColor
        node.title = `L${lIdx + 1} P${pIdx + 1}`;
        node.dataset.line  = lIdx;
        node.dataset.point = pIdx;
        // Pressing a marker selects its point, here and on the photo (another image's markers are fixed)
        node.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || s !== sess() || state.mode === 'horizon') return;
            keepPlacement(lIdx);
            state.activeLineIndex = lIdx;
            state.selectedPoint = { lineIndex: lIdx, pointIndex: pIdx };
            if (state.mode !== 'map-point') state.mode = 'drag-line';
            render(); updateUI();
        });
        const marker = new maplibregl.Marker({ element: node, draggable: true })
            .setLngLat([pt.geo.lng, pt.geo.lat]).addTo(map);
        attachMarkerDrag(marker, pt);
        mo.geoMarkers[lIdx].push(marker);
    });
    // Markers only. The rays are redrawn by recomputeIntersection(), which every caller runs next:
    // once for all lines instead of once per line.
}

/* The selected point's marker gets a halo */
function syncMarkerSelection() {
    const sel = state.selectedPoint;
    sess().mapObjects.geoMarkers.forEach(list => (list || []).forEach(m => {
        const d = m.getElement().dataset;
        m.getElement().classList.toggle('geo-point-selected',
            !!sel && +d.line === sel.lineIndex && +d.point === sel.pointIndex);
    }));
}

/* ---- PLACING TAG ----
   A small tag next to the mouse while a point waits for its map click, so it is obvious that the
   next click on the map places it. After briatlon's placingCursor.js. */
const mapBox     = document.getElementById('map-container');
const placingTag = el('div', '', mapBox);
placingTag.id = 'placing-tag';
placingTag.hidden = true;
const placingMouse = { x: 0, y: 0, inside: false };

function updatePlacingTag() {
    const t = state.mode === 'map-point' ? state.mapPointTarget : null;
    placingTag.hidden = !(t && placingMouse.inside);
    if (placingTag.hidden) return;
    const text = `Place L${t.lineIndex + 1} · P${t.pointIndex + 1}`;
    if (placingTag.textContent !== text) placingTag.textContent = text;
    placingTag.style.borderColor = activeLineColour(t.lineIndex);
    // Level with the pointer, to its right; flips to the left near the right edge
    const box = mapBox.getBoundingClientRect();
    const w = placingTag.offsetWidth, h = placingTag.offsetHeight;
    const left = placingMouse.x + 18 + w > box.width ? placingMouse.x - 14 - w : placingMouse.x + 18;
    const top  = Math.max(0, Math.min(box.height - h, placingMouse.y - h / 2));
    placingTag.style.transform = `translate(${Math.max(0, left)}px, ${top}px)`;
}

mapBox.addEventListener('pointermove', (e) => {
    const box = mapBox.getBoundingClientRect();
    placingMouse.x = e.clientX - box.left;
    placingMouse.y = e.clientY - box.top;
    // Not over the map's own controls, menus or markers
    placingMouse.inside = !e.target.closest?.('button, a, input, label, .maplibregl-ctrl, .map-ctx-menu, .geo-point');
    updatePlacingTag();
}, true);
mapBox.addEventListener('pointerleave', () => { placingMouse.inside = false; updatePlacingTag(); });

/* Dragging a geo marker: the ray follows live, intersection and ellipse recompute on release.
   Esc while dragging snaps the point back (see the keyboard handler). Only the active session's
   markers are draggable (setMarkersDraggable on session switch). */
function attachMarkerDrag(marker, pt) {
    marker.on('dragstart', () => {
        markerDrag = { marker, pt, origin: { ...pt.geo }, cancelled: false };
        hideCtxMenu();
    });
    marker.on('drag', () => {
        if (!markerDrag) return;
        if (markerDrag.cancelled) { marker.setLngLat([markerDrag.origin.lng, markerDrag.origin.lat]); return; }
        const ll = marker.getLngLat();
        pt.geo = { lat: ll.lat, lng: ll.lng };
        rebuildWorkSource();
    });
    marker.on('dragend', () => {
        if (!markerDrag) return;
        if (markerDrag.cancelled) marker.setLngLat([markerDrag.origin.lng, markerDrag.origin.lat]);
        markerDrag = null;
        recomputeIntersection();
        updateUI();
    });
}

function cancelMarkerDrag() {
    if (!markerDrag) return false;
    markerDrag.cancelled = true;
    markerDrag.pt.geo = { ...markerDrag.origin };
    markerDrag.marker.setLngLat([markerDrag.origin.lng, markerDrag.origin.lat]);
    rebuildWorkSource();
    return true;
}

function setMarkersDraggable(s, on) {
    s.mapObjects.geoMarkers.forEach(list => (list || []).forEach(m => {
        m.setDraggable(on);
        m.getElement().classList.toggle('geo-point-fixed', !on);
    }));
}

/* ============================================================
   INTERSECTION
   ============================================================ */
function recomputeIntersection() {
    const s  = sess();
    const mo = s.mapObjects;
    if (mo.intersectionMarker) {
        mo.intersectionMarker.remove();
        mo.intersectionMarker = null;
        mo.intersectionLatLng = null;
    }
    mo.ellipseRing = null;

    const rays = [];
    sess().lines.forEach((line) => {
        if (line.source === 'exif') return;
        const placed = line.points.filter(p => p.geo);
        if (placed.length < 2) return;
        rays.push({ p1: placed[0].geo, p2: placed[1].geo });
    });

    if (rays.length < 2) { rebuildWorkSource(); return; }

    const hits = [];
    for (let i = 0; i < rays.length; i++) {
        for (let j = i + 1; j < rays.length; j++) {
            const pt = intersectLines(rays[i].p1, rays[i].p2, rays[j].p1, rays[j].p2);
            if (pt) hits.push(pt);
        }
    }
    if (hits.length === 0) { rebuildWorkSource(); return; }

    const avgLat = hits.reduce((acc, p) => acc + p.lat, 0) / hits.length;
    const avgLng = hits.reduce((acc, p) => acc + p.lng, 0) / hits.length;

    mo.intersectionLatLng = { lat: avgLat, lng: avgLng };

    mo.intersectionMarker = new maplibregl.Marker({ element: el('div', 'intersection-marker') })
        .setLngLat([avgLng, avgLat])
        .setPopup(coordPopup('Estimated Position', `${avgLat.toFixed(6)}, ${avgLng.toFixed(6)}`, 'tp-popup', 14))
        .addTo(map);

    mo.intersectionMarker.togglePopup();

    if (hits.length >= 3) {
        const center = { lat: avgLat, lng: avgLng };
        const n = hits.length;
        const diffs = hits.map(p => ({ dx: p.lng - center.lng, dy: p.lat - center.lat }));
        const Cxx = diffs.reduce((acc, d) => acc + d.dx * d.dx, 0) / n;
        const Cyy = diffs.reduce((acc, d) => acc + d.dy * d.dy, 0) / n;
        const Cxy = diffs.reduce((acc, d) => acc + d.dx * d.dy, 0) / n;
        const trace = Cxx + Cyy;
        const disc  = Math.sqrt(Math.max(0, (trace / 2) ** 2 - (Cxx * Cyy - Cxy * Cxy)));
        const l1 = trace / 2 + disc;
        const l2 = trace / 2 - disc;
        // Direction of the major axis; also right when the spread is exactly along x or y (Cxy = 0)
        const angle = 0.5 * Math.atan2(2 * Cxy, Cxx - Cyy);
        const a = Math.sqrt(Math.max(0, l1)) * 2;
        const b = Math.sqrt(Math.max(0, l2)) * 2;
        const steps = 64;
        const ring = [];
        for (let i = 0; i <= steps; i++) {   // closed ring: last point repeats the first
            const t  = (2 * Math.PI * i) / steps;
            const rx = a * Math.cos(t) * Math.cos(angle) - b * Math.sin(t) * Math.sin(angle);
            const ry = a * Math.cos(t) * Math.sin(angle) + b * Math.sin(t) * Math.cos(angle);
            ring.push([center.lng + rx, center.lat + ry]);
        }
        mo.ellipseRing = ring;
    }
    rebuildWorkSource();

    if (!s.hasAutoZoomed) {
        const allPointsMapped = s.lines.every(l => l.points.length >= 2 && l.points.every(p => p.geo));
        if (allPointsMapped) {
            jumpTo({ lat: avgLat, lng: avgLng }, Math.max(map.getZoom(), 12));
            s.hasAutoZoomed = true;
        }
    }
}

/* ============================================================
   GEO MATHS  (constants DEG, RAD, R: top of the file)
   ============================================================ */

function bearingDeg(p1, p2) {
    const dLng = (p2.lng - p1.lng) * DEG;
    const lat1 = p1.lat * DEG, lat2 = p2.lat * DEG;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * RAD + 360) % 360;
}

function destinationPoint(origin, bearingDegrees, distKm) {
    const d  = distKm / R;
    const br = bearingDegrees * DEG;
    const lat1 = origin.lat * DEG;
    const lng1 = origin.lng * DEG;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * RAD, lng: lng2 * RAD };
}

/* Infinite-line intersection (treating lat/lng as flat 2-D – fine for <10 km) */
function intersectLines(p1, p2, p3, p4) {
    if (!p1 || !p2 || !p3 || !p4) return null;
    const x1 = p1.lng, y1 = p1.lat;
    const x2 = p2.lng, y2 = p2.lat;
    const x3 = p3.lng, y3 = p3.lat;
    const x4 = p4.lng, y4 = p4.lat;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    // Parallel: denom is |a|·|b|·sin(angle), so the test is relative to the lengths. A fixed limit
    // took two lines whose points lie a metre apart for parallel, whatever their angle.
    const lengths = Math.hypot(x1 - x2, y1 - y2) * Math.hypot(x3 - x4, y3 - y4);
    if (lengths === 0 || Math.abs(denom) < 1e-9 * lengths) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
        lat: y1 + t * (y2 - y1),
        lng: x1 + t * (x2 - x1)
    };
}

/* ============================================================
   DISTANCE MEASUREMENT – two clicks on the map, straight-line ground distance
   After briatlon's distanceMeasure.js. Starts from the ruler button next to the compass, the M key
   or the right-click menu; Esc or M clears it. A third click starts a new measurement. While a
   measurement waits for a click, map clicks belong to it; starting a point placement ends it and
   the other way round. Nothing of it is saved, exported or undone.
   ============================================================ */
const measure = { active: false, points: [], hover: null, label: null, button: null };

/* Waiting for a map click (the first or the second point) */
function measuring() { return measure.active && measure.points.length < 2; }

function formatDistance(metres) {
    return metres >= 1000
        ? `${(metres / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
        : `${metres.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
}

/* Great-circle distance in metres */
function distanceMetres(a, b) {
    const lat1 = a.lat * DEG, lat2 = b.lat * DEG, dLat = lat2 - lat1, dLng = (b.lng - a.lng) * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * 1000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function drawMeasure() {
    if (measure.button) measure.button.classList.toggle('active', measure.active);
    if (!mapReady) return;
    const [a, b] = measure.points;
    const end = b || (a ? measure.hover : null);   // the second point, or the mouse while it is still open
    const features = measure.points.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
    if (a && end) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [end.lng, end.lat]] } });
    map.getSource('measure').setData({ type: 'FeatureCollection', features });

    // The distance sits at the middle of the line
    if (a && end) {
        if (!measure.label) measure.label = new maplibregl.Marker({ element: el('div', 'measure-label') });
        measure.label.getElement().textContent = formatDistance(distanceMetres(a, end));
        measure.label.setLngLat([(a.lng + end.lng) / 2, (a.lat + end.lat) / 2]).addTo(map);
    } else if (measure.label) {
        measure.label.remove();
    }
}

function startMeasure(first = null) {
    // A point waiting for its map click stops waiting: the next click is the measurement's
    if (state.mode === 'map-point') {
        state.mode = state.activeLineIndex !== -1 ? 'drag-line' : 'idle';
        state.mapPointTarget = null;
    }
    measure.active = true;
    measure.points = first ? [first] : [];
    measure.hover = null;
    drawMeasure();
    render(); updateUI();
}

function clearMeasure() {
    if (!measure.active) return;
    measure.active = false;
    measure.points = [];
    measure.hover = null;
    drawMeasure();
    updateUI();
}

function measureClick(lngLat) {
    if (measure.points.length >= 2) measure.points = [];   // a third click starts a new measurement
    measure.points.push({ lat: lngLat.lat, lng: lngLat.lng });
    measure.hover = null;
    drawMeasure();
    updateUI();
}

/* After the first click the line and the distance follow the mouse */
map.on('mousemove', (e) => {
    if (!measure.active || measure.points.length !== 1) return;
    measure.hover = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    drawMeasure();
});

/* The ruler button sits right of the compass, bottom-left on the map */
map.addControl({
    onAdd() {
        const box = el('div', 'maplibregl-ctrl maplibregl-ctrl-group measure-ctrl');
        const btn = el('button', 'measure-btn', box);
        btn.type = 'button';
        btn.title = 'Measure distance (M)';
        btn.setAttribute('aria-label', 'Measure distance');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 17 17 3l4 4L7 21z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/></svg>`;
        btn.onclick = () => { if (measure.active) clearMeasure(); else startMeasure(); };
        measure.button = btn;
        return box;
    },
    onRemove() { measure.button = null; }
}, 'bottom-left');

/* ============================================================
   DIVIDER – drag the handle between two panes to resize them
   After briatlon's paneSplitter.js. The first pane's share is a percentage in a CSS variable on
   `box`, so it scales with the window; each pane keeps `min` pixels. axis 'x': panes side by side,
   'y': one above the other. The share is kept in localStorage under `key`.
   ============================================================ */
function makeSplitter(handle, box, { axis = 'x', cssVar, key, min = 320, start = 50, enabled = () => true }) {
    let pct = start;
    const size  = () => (axis === 'x' ? box.clientWidth : box.clientHeight) || 1;
    const clamp = (p) => {
        const lo = Math.min(50, min / size() * 100);   // a window too small for both minimums splits in half
        return Math.max(lo, Math.min(100 - lo, p));
    };
    function set(p, save) {
        pct = clamp(p);
        box.style.setProperty(cssVar, `${pct.toFixed(2)}%`);
        handle.setAttribute('aria-valuenow', Math.round(pct));
        if (save) localStorage.setItem(key, pct.toFixed(2));
    }

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button') || !enabled()) return;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('dragging');
        document.body.classList.add('pane-resizing');
        if (axis === 'y') document.body.classList.add('pane-resizing-y');
        e.preventDefault();
        handle.focus();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!handle.classList.contains('dragging')) return;
        const r = box.getBoundingClientRect();
        set(axis === 'x' ? (e.clientX - r.left) / r.width * 100 : (e.clientY - r.top) / r.height * 100, false);
    });
    const end = () => {
        if (!handle.classList.contains('dragging')) return;
        handle.classList.remove('dragging');
        document.body.classList.remove('pane-resizing', 'pane-resizing-y');
        set(pct, true);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && enabled()) set(start, true); });
    handle.addEventListener('keydown', (e) => {
        if (e.target !== handle || !enabled()) return;
        const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp', fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault();
        set(pct + (e.key === fwd ? 1 : -1) * (e.shiftKey ? 10 : 1), true);
    });
    window.addEventListener('resize', () => set(pct, false));   // the pixel minimums follow the window

    const saved = parseFloat(localStorage.getItem(key));
    set(Number.isFinite(saved) ? saved : start, false);
    return { set, get: () => pct };
}

/* Photo | map. The chevron on the handle folds the photo side away; that is not remembered, since the
   logo, the line tools and the drop zone live there and a page loading without them would look broken. */
const appEl = document.getElementById('app');
const btnPaneCollapse = document.getElementById('btn-pane-collapse');
const photoCollapsed = () => appEl.classList.contains('photo-collapsed');

makeSplitter(document.getElementById('pane-splitter'), appEl,
    { cssVar: '--split', key: 'tp-split', enabled: () => !photoCollapsed() });

btnPaneCollapse.addEventListener('click', () => {
    const on = appEl.classList.toggle('photo-collapsed');
    const label = on ? 'Show the photo side' : 'Hide the photo side';
    btnPaneCollapse.title = label;
    btnPaneCollapse.setAttribute('aria-label', label);
    btnPaneCollapse.blur();   // focus stays out of the way of the keyboard shortcuts
});

/* ============================================================
   STREET-LEVEL IMAGERY – a panel above the map (button in the map bar)
   Shows the photo nearest to a spot: the map centre, or the place picked with
   right-click → "Street-level imagery here"; the map follows to where the photo was taken.
   A click or the arrow keys walk to the next photo. 360° photos can be looked around in,
   ordinary photos are shown flat; a marker on the map shows where the photo was
   taken and which way the view points.
   Sources: Panoramax (no key) and Mapillary (the user's own free token, kept in
   this browser only). Their servers are contacted only while the panel is open;
   the panel always starts closed. Idea: the Street View split in briatlon's build.
   ============================================================ */
const STREET_SOURCE_KEY = 'tp-street-source';
const STREET_TOKEN_KEY  = 'tp-street-token';    // Mapillary token: localStorage only, never exported or autosaved
const STREET_RADII      = [60, 300, 1500];      // metres: the search widens until it finds something
const STREET_FOV        = 75;                   // vertical field of view of the 360° view, degrees
const STREET_STEP       = 40;                   // metres: how far one step of walking may reach

const streetUi = {
    button:   document.getElementById('btn-street'),
    panel:    document.getElementById('street-panel'),
    splitter: document.getElementById('street-splitter'),
    source:   document.getElementById('street-source'),
    token:    document.getElementById('street-token'),
    info:     document.getElementById('street-info'),
    here:     document.getElementById('btn-street-here'),
    hd:       document.getElementById('btn-street-hd'),
    cover:    document.getElementById('btn-street-cover'),
    close:    document.getElementById('btn-street-close'),
    view:     document.getElementById('street-view'),
    canvas:   document.getElementById('street-canvas'),
    flat:     document.getElementById('street-flat'),
    status:   document.getElementById('street-status')
};

const street = {
    open:   false,
    source: localStorage.getItem(STREET_SOURCE_KEY) === 'mapillary' ? 'mapillary' : 'panoramax',
    token:  localStorage.getItem(STREET_TOKEN_KEY) || '',
    cover:  localStorage.getItem('tp-street-cover') !== '0',   // coverage overlay on the map, on unless switched off
    target: null,     // { lat, lng } last looked up
    item:   null,     // the image on screen
    hd:     false,
    req:    0,        // counts lookups and image loads: an answer to an older one is dropped
    moveReq: 0,       // the same for walking
    marker: null,
    yaw: 0, pitch: 0, fov: STREET_FOV,   // 360° view, degrees; yaw 0 = centre of the image
    zoom: 1, tx: 0, ty: 0                // flat photo
};

/* ---- sources: each turns its API answer into
        { id, lat, lng, heading, date, pano, url, hd, credit, license } ---- */
function httpsUrl(v) {
    if (typeof v !== 'string') return null;
    try { const u = new URL(v); return u.protocol === 'https:' ? u.href : null; } catch (err) { return null; }
}

function streetBbox(p, metres) {
    const dLat = metres / 111320;
    const dLng = metres / (111320 * Math.max(0.01, Math.cos(p.lat * DEG)));
    return [p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat].map(v => v.toFixed(6)).join(',');
}

async function streetJson(url, headers = {}) {
    const res = await fetch(url, { headers, referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
    return res.json();
}

function panoramaxItem(f) {
    const c = f?.geometry?.coordinates;
    const url = httpsUrl(f?.assets?.sd?.href);
    if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1]) || !url) return null;
    const p = f.properties || {};
    return {
        id: String(f.id), lat: c[1], lng: c[0],
        heading: finite(p['view:azimuth']) ? p['view:azimuth'] : null,
        date:    typeof p.datetime === 'string' ? p.datetime.slice(0, 10) : '',
        pano:    p['pers:interior_orientation']?.field_of_view === 360,
        url, hd: httpsUrl(f.assets?.hd?.href),
        credit:  typeof f.providers?.[0]?.name === 'string' ? f.providers[0].name : '',
        license: typeof p.license === 'string' ? p.license : ''
    };
}

function mapillaryItem(d) {
    const c = d?.computed_geometry?.coordinates || d?.geometry?.coordinates;
    const url = httpsUrl(d?.thumb_2048_url);
    if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1]) || !url) return null;
    const heading = finite(d.computed_compass_angle) ? d.computed_compass_angle : d.compass_angle;
    return {
        id: String(d.id), lat: c[1], lng: c[0],
        heading: finite(heading) ? heading : null,
        date:    finite(d.captured_at) ? new Date(d.captured_at).toISOString().slice(0, 10) : '',
        pano:    d.is_pano === true,
        url, hd: httpsUrl(d.thumb_original_url),
        credit:  typeof d.creator?.username === 'string' ? d.creator.username : '',
        license: 'CC-BY-SA-4.0'
    };
}

const STREET_SOURCES = {
    panoramax: {
        label: 'Panoramax',
        async near(p, metres) {
            const data = await streetJson(`https://api.panoramax.xyz/api/search?bbox=${streetBbox(p, metres)}&limit=100`);
            return (Array.isArray(data.features) ? data.features : []).map(panoramaxItem);
        }
    },
    mapillary: {
        label: 'Mapillary',
        needsToken: true,
        async near(p, metres) {
            const fields = 'id,thumb_2048_url,thumb_original_url,computed_geometry,geometry,computed_compass_angle,compass_angle,is_pano,captured_at,creator';
            const data = await streetJson(
                `https://graph.mapillary.com/images?fields=${fields}&bbox=${streetBbox(p, metres)}&limit=100`,
                { Authorization: 'OAuth ' + street.token });
            return (Array.isArray(data.data) ? data.data : []).map(mapillaryItem);
        }
    }
};

/* ---- 360° view: the equirectangular photo on a full-canvas triangle, one draw per change ---- */
let streetGl = null;   // { gl, uni, tex } once the first 360° photo arrives; false if WebGL is not there

function streetGlInit() {
    if (streetGl !== null) return streetGl;
    const gl = streetUi.canvas.getContext('webgl2') || streetUi.canvas.getContext('webgl');
    if (!gl) return (streetGl = false);
    const shader = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER,
        'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
    // Ray through the pixel, tilted up by `pitch`, turned right by `yaw`, looked up in the photo
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D tex; uniform vec2 res; uniform float yaw, pitch, f;
        void main() {
            vec2 q = (gl_FragCoord.xy * 2.0 - res) / res.y * f;
            vec3 d = normalize(vec3(q, 1.0));
            float cp = cos(pitch), sp = sin(pitch), cy = cos(yaw), sy = sin(yaw);
            d = vec3(d.x, d.y * cp + d.z * sp, d.z * cp - d.y * sp);
            d = vec3(d.x * cy + d.z * sy, d.y, d.z * cy - d.x * sy);
            float u = atan(d.x, d.z) / 6.283185307 + 0.5;
            float v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.141592654;
            gl_FragColor = texture2D(tex, vec2(fract(u), v));
        }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return (streetGl = false);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uni = {};
    ['res', 'yaw', 'pitch', 'f'].forEach(n => { uni[n] = gl.getUniformLocation(prog, n); });
    return (streetGl = { gl, uni, tex });
}

/* The photo as the texture; one wider than the graphics card takes is scaled down first */
function streetGlImage(img) {
    const { gl } = streetGl;
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
    let src = img;
    if (img.naturalWidth > max || img.naturalHeight > max) {
        const k = max / Math.max(img.naturalWidth, img.naturalHeight);
        src = document.createElement('canvas');
        src.width  = Math.round(img.naturalWidth * k);
        src.height = Math.round(img.naturalHeight * k);
        src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);   // throws for a photo served without CORS
}

function streetDraw() {
    if (!streetGl || streetUi.canvas.hidden) return;
    const { gl, uni } = streetGl, c = streetUi.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uni.res, w, h);
    gl.uniform1f(uni.yaw, street.yaw * DEG);
    gl.uniform1f(uni.pitch, street.pitch * DEG);
    gl.uniform1f(uni.f, Math.tan(street.fov * DEG / 2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function streetFlatTransform() {
    streetUi.flat.style.transform = `translate(${street.tx}px, ${street.ty}px) scale(${street.zoom})`;
}

/* The recorded direction of a photo is that of its middle. Many photos carry no compass value; the
   service then takes the direction of travel, which is wrong for a camera mounted facing another way. */
function streetItemHeading(it) {
    return it && it.heading !== null ? it.heading : null;
}

/* ---- marker: where the photo was taken, the wedge points along the view ---- */
function streetHeading() {
    const it = street.item;
    const base = streetItemHeading(it);
    if (base === null) return null;
    return (((base + (it.pano && !streetUi.canvas.hidden ? street.yaw : 0)) % 360) + 360) % 360;
}

function streetMarkerUpdate() {
    const it = street.item;
    if (!it) { if (street.marker) { street.marker.remove(); street.marker = null; } return; }
    if (!street.marker) {
        const node = el('div', 'street-marker');
        node.innerHTML = `<svg viewBox="-22 -22 44 44"><path d="M0 0 L-11 -19 A22 22 0 0 1 11 -19 Z" fill="#ffdc32" fill-opacity="0.45" stroke="#ffdc32" stroke-width="1"/>
            <circle r="5" fill="#ffdc32" stroke="#111" stroke-width="2"/></svg>`;
        street.marker = new maplibregl.Marker({ element: node, rotationAlignment: 'map', pitchAlignment: 'map' })
            .setLngLat([it.lng, it.lat]).addTo(map);
    }
    const heading = streetHeading();
    street.marker.setLngLat([it.lng, it.lat]).setRotation(heading ?? 0);
    street.marker.getElement().querySelector('path').style.display = heading === null ? 'none' : '';
}

/* ---- panel ---- */
function streetStatus(text) { streetUi.status.textContent = text || ''; }

function streetInfo() {
    const it = street.item;
    if (!it) { streetUi.info.textContent = ''; return; }
    const dist = street.target ? Math.round(distanceMetres(street.target, it)) : null;
    streetUi.info.textContent = [
        it.credit && `© ${it.credit}`, it.license, it.date, it.pano ? '360°' : 'photo',
        dist !== null && `${dist} m from the spot`
    ].filter(Boolean).join(' · ');
    streetUi.info.title = `${STREET_SOURCES[street.source].label}: ${streetUi.info.textContent}`;
}

function streetButtons() {
    const it = street.item;
    streetUi.hd.disabled   = !it?.hd || it.hd === it.url;
    streetUi.hd.classList.toggle('active', !!it && street.hd);
    streetUi.token.hidden  = street.source !== 'mapillary';
    streetUi.cover.hidden  = street.source !== 'panoramax';
    streetUi.cover.classList.toggle('active', street.cover);
}

function streetClearView() {
    streetUi.canvas.hidden = true;
    streetUi.flat.hidden = true;
    streetUi.flat.removeAttribute('src');
}

/* Put an image on screen. compass: keep looking this way (degrees from north) if it is a 360° photo */
function streetShow(item, { hd = false, compass = null, keepView = false } = {}) {
    const req = ++street.req;
    const first = !keepView;
    street.item = item;
    street.hd = hd;
    if (first) {
        street.pitch = 0; street.fov = STREET_FOV; street.zoom = 1; street.tx = 0; street.ty = 0;
        street.yaw = compass !== null && item.heading !== null ? compass - streetItemHeading(item) : 0;
        // The map goes to where this photo was taken, close enough to see the marker's surroundings
        map.easeTo({ center: [item.lng, item.lat], zoom: Math.max(map.getZoom(), 16), duration: 400 });
    }
    streetInfo();
    streetButtons();
    streetStatus(hd ? 'Loading full resolution…' : 'Loading image…');
    const url = hd ? item.hd : item.url;

    const showFlat = () => {
        if (req !== street.req) return;
        streetUi.canvas.hidden = true;
        streetUi.flat.onload  = () => { if (req === street.req) streetStatus(''); };
        streetUi.flat.onerror = () => { if (req === street.req) { streetClearView(); streetStatus('The image could not be loaded.'); } };
        streetUi.flat.referrerPolicy = 'no-referrer';
        streetUi.flat.src = url;
        streetUi.flat.hidden = false;
        streetFlatTransform();
        streetMarkerUpdate();
    };

    if (!item.pano || !streetGlInit()) { showFlat(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
        if (req !== street.req) return;
        try { streetGlImage(img); } catch (err) { showFlat(); return; }
        streetUi.flat.hidden = true;
        streetUi.flat.removeAttribute('src');
        streetUi.canvas.hidden = false;
        streetStatus('');
        streetDraw();
        streetMarkerUpdate();
    };
    img.onerror = showFlat;   // no CORS on this server: the photo is still shown, unrolled
    img.src = url;
    streetMarkerUpdate();
}

function streetFail(err) {
    street.item = null;
    streetClearView();
    streetInfo(); streetButtons(); streetMarkerUpdate();
    const name = STREET_SOURCES[street.source].label;
    if (street.source === 'mapillary' && err && [400, 401, 403].includes(err.status)) {
        streetStatus('Mapillary did not accept the token. Check it in the field above.');
    } else if (err && err.status >= 500) {
        streetStatus(`${name} has a problem on its side (error ${err.status}). Try again later.`);
    } else {
        streetStatus(`${name} could not be reached.`);
    }
}

/* Find and show the image nearest to p */
async function streetLookAt(p) {
    const src = STREET_SOURCES[street.source];
    street.target = { lat: p.lat, lng: p.lng };
    const req = ++street.req;
    if (src.needsToken && !street.token) {
        street.item = null;
        streetClearView(); streetInfo(); streetButtons(); streetMarkerUpdate();
        streetStatus('Mapillary needs your own (free) client token: paste it into the field above.');
        streetUi.token.focus();
        return;
    }
    streetStatus(`Searching ${src.label}…`);
    try {
        for (const metres of STREET_RADII) {
            const items = (await src.near(street.target, metres)).filter(Boolean);
            if (req !== street.req) return;
            if (!items.length) continue;
            let best = items[0], bestD = Infinity;
            for (const it of items) {
                const d = distanceMetres(street.target, it);
                if (d < bestD) { best = it; bestD = d; }
            }
            streetShow(best);
            return;
        }
        street.item = null;
        streetClearView(); streetInfo(); streetButtons(); streetMarkerUpdate();
        streetStatus(`No ${src.label} imagery within ${STREET_RADII[STREET_RADII.length - 1] / 1000} km of this spot.`);
    } catch (err) {
        if (req === street.req) streetFail(err);
    }
}

/* A short message over the view that goes away by itself */
let streetHintTimer = null;
function streetHint(text) {
    streetStatus(text);
    clearTimeout(streetHintTimer);
    streetHintTimer = setTimeout(() => { if (streetUi.status.textContent === text) streetStatus(''); }, 1600);
}

const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;   // a relative to b, -180…180

/* Walk: go to the nearest image that lies in the compass direction `compass` (degrees) from the one
   on screen. The images around the current one are asked for once and kept with it. A 360° view
   keeps looking the same way; a photo of the same kind, facing the way the view does, is preferred. */
async function streetMove(compass) {
    const from = street.item, src = STREET_SOURCES[street.source];
    if (!from) return;
    if (compass === null) return streetHint('This image has no recorded direction to walk along.');
    const move = ++street.moveReq;
    const view = streetHeading();
    try {
        if (!from.around) from.around = src.near(from, STREET_STEP);
        const items = (await from.around).filter(Boolean);
        if (move !== street.moveReq || street.item !== from) return;
        // A real step first (dense sequences have a photo every metre or two), then whatever is there
        let best = null, bestScore = Infinity;
        for (const least of [5, 1]) for (const it of items) {
            if (best && least === 1) break;
            if (it.id === from.id) continue;
            const d = distanceMetres(from, it);
            if (d < least || d > STREET_STEP) continue;
            const off = Math.abs(angleDiff(bearingDeg(from, it), compass));
            if (off > 60) continue;
            let score = d * (1 + (off / 45) ** 2);
            // Stay with the same kind of photo, and with ordinary photos that look the way the view does now
            if (it.pano !== from.pano) score += 15;
            if (!it.pano && view !== null && it.heading !== null) score += Math.abs(angleDiff(streetItemHeading(it), view)) / 180 * 40;
            if (score < bestScore) { best = it; bestScore = score; }
        }
        if (!best) return streetHint('No image in that direction.');
        streetShow(best, { compass: from.pano ? streetHeading() : null });
    } catch (err) {
        from.around = null;
        if (move === street.moveReq) streetHint(`${src.label} could not be reached.`);
    }
}

/* ---- coverage: where Panoramax has photos, drawn on the map while the panel is open ----
   Panoramax's own vector tiles: a coarse grid when zoomed far out, the sequences as lines (360° solid,
   ordinary photos dashed) and, zoomed in close, one dot per photo. A click on a line or dot loads the
   photo there. Source and layers exist only while the panel is open with Panoramax selected and the
   Coverage button on, so the tile server is not contacted otherwise. Mapillary has no overlay here. */
const STREET_COVER_COLOUR = '#3fd0e0';
const STREET_COVER_LAYERS = ['street-cover-grid', 'street-cover-flat', 'street-cover-360', 'street-cover-pics'];

function streetCoverage() {
    if (!mapReady) { map.once('load', streetCoverage); return; }   // opened before the map was ready
    if (!(street.open && street.cover && street.source === 'panoramax')) {
        STREET_COVER_LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource('street-cover')) map.removeSource('street-cover');
        map.getContainer().classList.remove('street-cover-hover');
        return;
    }
    if (map.getSource('street-cover')) return;
    map.addSource('street-cover', {
        type: 'vector', tiles: ['https://api.panoramax.xyz/api/map/{z}/{x}/{y}.mvt'], minzoom: 0, maxzoom: 15,
        attribution: 'Street-level coverage: <a href="https://panoramax.fr" target="_blank" rel="noopener">Panoramax</a>'
    });
    const below = 'ellipse';   // above basemap, hillshade and buildings; below rays, ellipse and measurement
    map.addLayer({
        id: 'street-cover-grid', type: 'circle', source: 'street-cover', 'source-layer': 'grid', maxzoom: 7,
        filter: ['>', ['get', 'coef'], 0],
        paint: {
            'circle-color': STREET_COVER_COLOUR,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 6, 6],
            'circle-opacity': ['interpolate', ['linear'], ['get', 'coef'], 0, 0.35, 1, 0.95]
        }
    }, below);
    const line = (id, filter, dash) => map.addLayer({
        id, type: 'line', source: 'street-cover', 'source-layer': 'sequences', minzoom: 6, filter,
        layout: { 'line-cap': dash ? 'butt' : 'round', 'line-join': 'round' },
        paint: {
            'line-color': STREET_COVER_COLOUR, 'line-opacity': 0.9,
            'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 14, 3, 18, 5],
            ...(dash ? { 'line-dasharray': dash } : {})
        }
    }, below);
    line('street-cover-flat', ['!=', ['get', 'type'], 'equirectangular'], [2, 1.5]);
    line('street-cover-360',  ['==', ['get', 'type'], 'equirectangular'], null);
    map.addLayer({
        id: 'street-cover-pics', type: 'circle', source: 'street-cover', 'source-layer': 'pictures', minzoom: 15,
        paint: {
            'circle-color': STREET_COVER_COLOUR,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 7],
            'circle-stroke-color': '#0c0c0c', 'circle-stroke-width': 1,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1],
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1]
        }
    }, below);
}

/* The coverage under a point of the map, a few pixels around it; a photo dot comes before a line.
   Nothing while a map click belongs to a point placement or a measurement. */
function streetCoverageAt(point) {
    if (!map.getLayer('street-cover-pics') || measure.active || state.mode === 'map-point') return null;
    const box = [[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]];
    const hits = map.queryRenderedFeatures(box, { layers: STREET_COVER_LAYERS.filter(id => id !== 'street-cover-grid') });
    return hits.find(f => f.layer.id === 'street-cover-pics') || hits[0] || null;
}

map.on('mousemove', (e) => {
    if (!street.open) return;
    map.getContainer().classList.toggle('street-cover-hover', !!streetCoverageAt(e.point));
});

map.on('click', async (e) => {
    if (!street.open) return;
    if (e.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
    const hit = streetCoverageAt(e.point);
    if (!hit) return;
    const spot = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    const id = hit.layer.id === 'street-cover-pics' && typeof hit.properties?.id === 'string' ? hit.properties.id : null;
    if (!id) { streetLookAt(spot); return; }
    // A photo dot: exactly that photo
    const req = ++street.req;
    streetStatus('Loading image…');
    try {
        const data = await streetJson(`https://api.panoramax.xyz/api/search?ids=${encodeURIComponent(id)}`);
        if (req !== street.req) return;
        const item = panoramaxItem(data.features?.[0]);
        if (!item) { streetLookAt(spot); return; }
        street.target = { lat: item.lat, lng: item.lng };
        streetShow(item);
    } catch (err) {
        if (req === street.req) streetFail(err);
    }
});

/* With the panel open and nothing chosen yet: say how to choose, instead of jumping somewhere */
function streetPrompt() {
    street.target = null;
    streetStatus(street.source === 'panoramax' && street.cover
        ? 'Click a line or dot on the map, or use Map centre.'
        : 'Right-click the map and choose Street-level imagery here, or use Map centre.');
}

function setStreetOpen(on, target = null) {
    street.open = on;
    streetUi.panel.hidden = !on;
    streetUi.splitter.hidden = !on;
    streetUi.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
        if (target) streetLookAt(target);
        else if (!street.item) streetPrompt();
    } else {
        street.req++;          // whatever is still on its way is dropped
        street.item = null;
        streetClearView(); streetInfo(); streetButtons(); streetMarkerUpdate(); streetStatus('');
    }
    streetCoverage();
    map.resize();
}

streetUi.source.value = street.source;
streetUi.token.value  = street.token;
streetButtons();

streetUi.button.addEventListener('click', () => { setStreetOpen(!street.open); streetUi.button.blur(); });
streetUi.close.addEventListener('click', () => setStreetOpen(false));
streetUi.here.addEventListener('click', () => streetLookAt(map.getCenter()));
streetUi.cover.addEventListener('click', () => {
    street.cover = !street.cover;
    localStorage.setItem('tp-street-cover', street.cover ? '1' : '0');
    streetButtons();
    streetCoverage();
    if (street.open && !street.item) streetPrompt();
});
streetUi.hd.addEventListener('click', () => {
    if (street.item) streetShow(street.item, { hd: !street.hd, keepView: true });
});
streetUi.source.addEventListener('change', () => {
    street.source = streetUi.source.value === 'mapillary' ? 'mapillary' : 'panoramax';
    localStorage.setItem(STREET_SOURCE_KEY, street.source);
    streetButtons();
    streetCoverage();
    if (street.target) streetLookAt(street.target);
    else streetPrompt();
});
streetUi.token.addEventListener('change', () => {
    street.token = streetUi.token.value.trim();
    if (street.token) localStorage.setItem(STREET_TOKEN_KEY, street.token);
    else localStorage.removeItem(STREET_TOKEN_KEY);
    if (street.open && street.source === 'mapillary' && street.target) streetLookAt(street.target);
});

/* Mouse: drag looks around (360°) or pans a zoomed flat photo, the wheel zooms, a click walks towards
   the clicked side of the view. Arrow keys, while the view has the focus: up and down walk forwards
   and backwards along the view, left and right step sideways. */
{
    let drag = null;
    const onDown = (e) => {
        if (e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, travelled: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.classList.add('dragging');
        e.preventDefault();
        streetUi.view.focus({ preventScroll: true });
    };
    const onUp = (e) => {
        const click = drag && drag.travelled < 5 && e.type === 'pointerup';
        drag = null;
        e.currentTarget.classList.remove('dragging');
        if (!click) return;
        // How far left or right of the middle the click was, as an angle
        const r = streetUi.view.getBoundingClientRect();
        const x = (e.clientX - r.left) / Math.max(1, r.width) * 2 - 1;
        const off = e.currentTarget === streetUi.canvas
            ? Math.atan(x * (r.width / Math.max(1, r.height)) * Math.tan(street.fov * DEG / 2)) * RAD
            : x * 30;
        const heading = streetHeading();
        streetMove(heading === null ? null : heading + off);
    };
    const onMove = (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag = { x: e.clientX, y: e.clientY, travelled: drag.travelled + Math.abs(dx) + Math.abs(dy) };
        if (e.currentTarget === streetUi.canvas) {
            const perPx = street.fov / Math.max(1, streetUi.canvas.clientHeight);   // degrees per pixel
            street.yaw   = (street.yaw - dx * perPx) % 360;
            street.pitch = Math.max(-89, Math.min(89, street.pitch + dy * perPx));
            streetDraw();
            streetMarkerUpdate();
        } else if (street.zoom > 1) {
            const maxX = streetUi.view.clientWidth * (street.zoom - 1) / 2, maxY = streetUi.view.clientHeight * (street.zoom - 1) / 2;
            street.tx = Math.max(-maxX, Math.min(maxX, street.tx + dx));
            street.ty = Math.max(-maxY, Math.min(maxY, street.ty + dy));
            streetFlatTransform();
        }
    };
    const onWheel = (e) => {
        e.preventDefault();
        const k = Math.exp(e.deltaY * 0.0015);
        if (e.currentTarget === streetUi.canvas) {
            street.fov = Math.max(15, Math.min(110, street.fov * k));
            streetDraw();
        } else {
            street.zoom = Math.max(1, Math.min(8, street.zoom / k));
            const maxX = streetUi.view.clientWidth * (street.zoom - 1) / 2, maxY = streetUi.view.clientHeight * (street.zoom - 1) / 2;
            street.tx = Math.max(-maxX, Math.min(maxX, street.tx));
            street.ty = Math.max(-maxY, Math.min(maxY, street.ty));
            streetFlatTransform();
        }
    };
    [streetUi.canvas, streetUi.flat].forEach(node => {
        node.addEventListener('pointerdown', onDown);
        node.addEventListener('pointermove', onMove);
        node.addEventListener('pointerup', onUp);
        node.addEventListener('pointercancel', onUp);
        node.addEventListener('wheel', onWheel, { passive: false });
    });
    const KEY_TURN = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: -90 };
    streetUi.view.addEventListener('keydown', (e) => {
        if (!(e.key in KEY_TURN) || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        const heading = streetHeading();
        streetMove(heading === null ? null : heading + KEY_TURN[e.key]);
    });
    new ResizeObserver(streetDraw).observe(streetUi.view);
}

makeSplitter(streetUi.splitter, document.getElementById('map-stack'),
    { axis: 'y', cssVar: '--street', key: 'tp-street-split', min: 120, start: 45 });

/* ============================================================
   START – bring back the autosaved work, if any
   ============================================================ */
renderSessionMenu();   // the image tabs are there from the start
updateAdjustUI();      // tools greyed out until a photo is loaded
showKeyLayout();       // help card keys, guide and tooltips of the saved key layout
autosaveRestore();
