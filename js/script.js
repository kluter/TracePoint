/* ============================================================
   TracePoint – script.js
   ============================================================ */

const canvas      = document.getElementById("image-canvas");
const ctx         = canvas.getContext("2d");
const container   = document.getElementById("image-container");
const overlay     = document.getElementById("drop-overlay");
const btnAddLine    = document.getElementById("btn-add-line");
const btnModeToggle = document.getElementById("btn-mode-toggle");
const btnHorizon    = document.getElementById("btn-horizon");
const toolbar       = document.getElementById("toolbar");
const lineBar       = document.getElementById("line-bar");

let pulseFrameId = null;
const toastCounts = new Map();
const TOAST_DURATION = 7000;
const TOAST_MAX_STACK = 3;

function showToast(msg, type = 'error') {
    const count = toastCounts.get(msg) || 0;
    if (count >= TOAST_MAX_STACK) return;
    toastCounts.set(msg, count + 1);

    const container = document.getElementById('toast-container');
    const item = document.createElement('div');
    item.className = 'toast-item' + (type === 'success' ? ' toast-success' : '');
    item.innerHTML = `<span>${escHtml(msg)}</span><button class="toast-close" aria-label="Dismiss">×</button>`;
    item.querySelector('.toast-close').onclick = () => dismissToast(item, msg);
    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add('toast-visible'));

    setTimeout(() => dismissToast(item, msg), TOAST_DURATION);
}

function dismissToast(item, msg) {
    if (!item.isConnected) return;
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

document.getElementById('session-menu').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.action === 'export-session') exportSession(+btn.dataset.idx);
    if (btn.dataset.action === 'remove-session') removeSession(+btn.dataset.idx);
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
function createSession(name) {
    return {
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
        exifGpsMarker:    null
    };
}

/* sessions and activeSessionIndex are initialised after map is created (see below) */
let sessions;
let activeSessionIndex = 0;

/* Convenience accessor – always returns the active session */
function sess() { return sessions[activeSessionIndex]; }

/* ---- INTERACTION STATE (not per-session) ---- */
const state = {
    mode: 'idle',         // 'idle' | 'drag-line' | 'add-point' | 'map-point' | 'horizon'
    activeLineIndex: -1,
    mapPointTarget:  null,  // { lineIndex, pointIndex }
    isDragging:      false,
    pointDrag:       null,  // { line, pt, origY } while a point is slid along its line on the image
    _horizonMouse:   null
};

/* ---- ZOOM / PAN helpers ---- */
let isPanning = false, panStart = { x: 0, y: 0 }, panOrigin = { tx: 0, ty: 0 };
const MIN_SCALE = 0.1, MAX_SCALE = 20;

function applyTransform() {
    const v = sess().view;
    canvas.style.transform       = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    canvas.style.transformOrigin = '0 0';
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
    maxPitch: 70,
    attributionControl: { compact: false },
    /* Ctrl+drag or right-drag rotates and tilts. aroundCenter: false = plain horizontal
       drag → bearing; the default hybrid mode wobbles when dragging slowly near the centre line. */
    aroundCenter: false,
    rotateDegreesPerPixelMoved: ROTATE_DEG_PER_PX
});
// top-left holds the coordinate search, top-right the layer switcher
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: true }), 'bottom-right');

let mapReady = false;   // sources and layers can only be added once the style has loaded

/* Middle-button drag pans the map (MapLibre ignores button 1; without this the browser autoscrolls).
   Mirrors the image panel, which also pans with middle-drag. */
(() => {
    const canvas = map.getCanvasContainer();
    let last = null;
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        last = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!last) return;
        map.panBy([last.x - e.clientX, last.y - e.clientY], { duration: 0 });
        last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', (e) => {
        if (e.button !== 1 || !last) return;
        last = null;
        canvas.style.cursor = '';
    });
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
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || zoom < 0 || zoom > 20 || Math.abs(pitch) > 70) return null;
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
        label: '🛰 Esri Satellite',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', opacity: 0.7, maxZoom: 21, maxNativeZoom: 19 } }
        ]
    },
    {
        id: 's2-2024',
        label: '🌍 Sentinel-2 2024',
        layers: [
            { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
              opts: { attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
                      maxZoom: 21, maxNativeZoom: 14 } }
        ]
    },
    {
        id: 'osm',
        label: '🗺 OpenStreetMap',
        layers: [
            { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              opts: { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 } }
        ]
    },
    {
        id: 'esri-dark',
        label: '🌑 Esri Dark Gray',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 16 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', maxZoom: 21, maxNativeZoom: 16 } }
        ]
    },
    {
        id: 'esri-topo',
        label: '🏔 Esri Topo',
        layers: [
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: 'Tiles &copy; Esri', maxZoom: 21, maxNativeZoom: 19 } }
        ]
    },
    {
        id: 'esri-streets',
        label: '🏙 Esri Streets',
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
        label: '🔗 ' + c.name,
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

        if (level === 0) return { data: await got.blob.arrayBuffer() };

        // Crop the part of the parent tile that covers this tile
        const part = size / f;
        const sx = (x - cx * f) * part, sy = (y - cy * f) * part;
        const canvas = new OffscreenCanvas(size, size);
        canvas.getContext('2d').drawImage(got.bmp, sx, sy, part, part, 0, 0, size, size);
        return { data: await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer() };
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
        }, map.getLayer('ellipse') ? 'ellipse' : undefined);   // base imagery stays below the work layers (ellipse is the lowest)
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
/* Mapzen Terrarium DEM tiles from AWS (keyless, CORS ok). The source is registered at map load but
   no tile is requested until terrain is switched on. Independent of the chosen imagery. */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
let terrainOn = localStorage.getItem('tp-terrain') === '1';

function setTerrain(on) {
    terrainOn = on;
    localStorage.setItem('tp-terrain', on ? '1' : '0');
    if (!mapReady) return;   // applied again from the map's load handler
    map.setTerrain(on ? { source: 'dem', exaggeration: 1 } : null);
}

/* ---- LAYER SWITCHER CONTROL ---- */
class LayerSwitcher {
    onAdd() {
        const wrap = el('div', 'maplibregl-ctrl layer-switcher-wrap');

        const btn = el('button', 'layer-burger', wrap);
        btn.title = 'Switch map layer';
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2"  width="16" height="2" rx="1"/>
            <rect y="7"  width="16" height="2" rx="1"/>
            <rect y="12" width="16" height="2" rx="1"/>
        </svg>`;

        const menu = el('div', 'layer-menu', wrap);
        menu.style.display = 'none';
        layerMenu = menu;
        renderLayerMenu();

        btn.onclick = () => {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        map.on('click', () => { menu.style.display = 'none'; });

        this._el = wrap;
        return wrap;
    }
    onRemove() { this._el.remove(); }
}

let layerMenu = null;

function renderLayerMenu() {
    const menu = layerMenu;
    menu.innerHTML = '';

    const addItem = (set) => {
        const item = el('div', 'layer-item', menu);
        item.dataset.id = set.id;
        if (set.id === activeTileSetId) item.classList.add('active');
        item.onclick = () => {
            setTileSet(set.id);
            renderLayerMenu();
            menu.style.display = 'none';
        };
        if (!set.custom) { item.textContent = set.label; return; }

        item.classList.add('layer-item-custom');
        const label = el('span', 'layer-label', item);
        label.textContent = set.label;
        const edit = el('button', 'layer-action', item);
        edit.title = 'Edit layer';
        edit.textContent = '✎';
        edit.onclick = (e) => { e.stopPropagation(); menu.style.display = 'none'; openLayerModal(set.id); };
        const del = el('button', 'layer-action layer-action-delete', item);
        del.title = 'Remove layer';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); removeCustomLayer(set.id); };
    };

    TILE_SETS.forEach(addItem);

    el('div', 'layer-divider', menu);
    const terrain = el('div', 'layer-item layer-terrain', menu);
    terrain.textContent = '⛰ Terrain';
    terrain.title = 'Elevation tiles from AWS. Tilt the map (Ctrl+drag) to see the relief.';
    if (terrainOn) terrain.classList.add('active');
    terrain.onclick = () => {
        setTerrain(!terrainOn);
        renderLayerMenu();
        menu.style.display = 'none';
    };

    el('div', 'layer-divider', menu);
    allTileSets().filter(s => s.custom).forEach(addItem);
    if (customLayers.length) el('div', 'layer-divider', menu);

    const add = el('div', 'layer-item layer-add', menu);
    add.textContent = '＋ Add custom layer…';
    add.onclick = () => { menu.style.display = 'none'; openLayerModal(null); };
}

function removeCustomLayer(id) {
    customLayers = customLayers.filter(c => c.id !== id);
    saveCustomLayers();
    if (activeTileSetId === id) setTileSet('esri-sat');
    renderLayerMenu();
}

map.addControl(new LayerSwitcher(), 'top-right');

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
    if (!s || s.length > 500) return null;

    if (/^https?:\/\//i.test(s)) {
        const m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
                  s.match(/[?&](?:q|ll|query|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
        return m ? validLatLng(+m[1], +m[2]) : null;
    }

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

function validLatLng(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

const fmtCoords = (p) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

let searchPins = [];          // { lat, lng, marker }
let searchList = null;
let searchInput = null;
let searchHint = null;

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

function setSearchError(on) {
    searchInput.classList.toggle('search-input-error', on);
    searchHint.style.display = on ? 'block' : 'none';
}

class CoordSearch {
    onAdd() {
        const wrap = el('div', 'maplibregl-ctrl coord-search');

        searchInput = el('input', 'coord-search-input', wrap);
        searchInput.type = 'text';
        searchInput.placeholder = 'Paste coordinates…';
        searchInput.spellcheck = false;
        searchInput.autocomplete = 'off';
        searchInput.title = 'Paste or type coordinates, then press Enter. Ctrl+V anywhere works too.';

        searchHint = el('div', 'coord-search-hint', wrap);
        searchHint.textContent = 'Not recognised — try 52.40, 13.06';
        searchHint.style.display = 'none';

        searchList = el('div', 'search-list', wrap);
        searchList.style.display = 'none';

        const submit = (text) => {
            const c = parseCoordinates(text);
            if (!c) { setSearchError(true); return false; }
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
        this._el = wrap;
        return wrap;
    }
    onRemove() { this._el.remove(); }
}
map.addControl(new CoordSearch(), 'top-left');

/* Ctrl+V anywhere on the page (outside text fields) does the same as the search box.
   Only the pasted text is read, on the paste itself — the page never reads the clipboard on its own. */
document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!text || !text.trim()) return;
    const c = parseCoordinates(text);
    if (!c) return showToast('No coordinates found in clipboard.');
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

/* Find the lowest colour slot not already claimed by an existing session */
function nextFreeColourIndex() {
    const used = new Set((sessions || []).map(s => s.colourIndex));
    let n = 0;
    while (used.has(n % LINE_COLOURS.length)) n++;
    return n % LINE_COLOURS.length;
}

function sessionColourIndex(sessionIdx) {
    return sessions[sessionIdx]?.colourIndex ?? sessionIdx % LINE_COLOURS.length;
}

function lineColour(lineIdx, sessionIdx = activeSessionIndex) {
    return LINE_COLOURS[(sessionColourIndex(sessionIdx) * 2 + lineIdx) % LINE_COLOURS.length];
}

/* Now both map and LINE_COLOURS exist — safe to create the first session */
sessions = [createSession('Image 1')];

/* ============================================================
   UI HELPERS
   ============================================================ */
function updateUI() {
    btnModeToggle.removeAttribute('style');
    if (state.activeLineIndex !== -1) {
        const c = lineColour(state.activeLineIndex, activeSessionIndex);
        btnModeToggle.disabled = false;
        if (state.mode === 'drag-line') {
            const line = sess().lines[state.activeLineIndex];
            btnModeToggle.textContent = 'Mode: Drag Line';
            btnModeToggle.title = (line && line.points.length >= 2)
                ? '2 points placed — delete one to add another' : '';
            btnModeToggle.className = '';
        }
        if (state.mode === 'add-point') {
            btnModeToggle.textContent = 'Mode: Add Point';
            btnModeToggle.className = 'active-mode';
            btnModeToggle.style.cssText = `background:${c}22; color:${c}; border-color:${c};`;
        }
        if (state.mode === 'map-point') {
            btnModeToggle.textContent = 'Mode: Map Point';
            btnModeToggle.className = 'active-mode map-mode';
            btnModeToggle.style.cssText = `background:${c}22; color:${c}; border-color:${c};`;
        }
    } else {
        btnModeToggle.disabled = true;
        btnModeToggle.textContent = 'Mode: Idle';
        btnModeToggle.className = '';
    }

    map.getCanvas().style.cursor = (state.mode === 'map-point') ? 'crosshair' : '';

    if (state.mode === 'horizon') {
        btnHorizon.classList.add('active-mode');
        btnHorizon.title = 'Click two points on the image to define the horizon. ESC to cancel.';
    } else if (sess().view.rotation !== 0) {
        btnHorizon.classList.add('horizon-active');
        btnHorizon.classList.remove('active-mode');
        btnHorizon.title = `Rotation: ${sess().view.rotation.toFixed(1)}° — click to reset`;
    } else {
        btnHorizon.classList.remove('active-mode', 'horizon-active');
        btnHorizon.title = 'Set horizon correction';
    }

    updateLineManager();
    updateGuide();
}

/* ============================================================
   STEP GUIDE – vertical icon column on the image, next step glows,
   one-line hints in both panel headers. Derived from state on every updateUI.
   ============================================================ */
const GUIDE_STEPS = [
    { title: 'Load an image',            key: '',    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>' },
    { title: 'Add a line',               key: 'E',   icon: '<line x1="12" y1="3" x2="12" y2="21"/>' },
    { title: 'Drag the line onto a feature', key: '', icon: '<line x1="12" y1="3" x2="12" y2="21"/><path d="M4 12h5M15 12h5"/><path d="M6 9l-3 3 3 3M18 9l3 3-3 3"/>' },
    { title: 'Place P1 and P2 on the line', key: 'Tab', icon: '<line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/>' },
    { title: 'Mark the points on the map', key: 'F', icon: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>' },
    { title: 'Add a second line',         key: 'E',   icon: '<line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/>' },
    { title: 'Position found',            key: '',    icon: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' }
];

const guideEl   = document.getElementById('guide');
const imageHint = document.getElementById('image-hint');

/* Which step is next, the header hint, and overall progress 0–1.
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

    if (!s.imgElement) return { idx: 0, progress, hint: 'Drop a photo here, or pick the demo from the ☰ menu' };
    if (s.lines.length === 0) return { idx: 1, progress, hint: 'Press E or click + New Line' };

    // The first line that still needs work drives the guide
    const lIdx = s.lines.findIndex(l => l.points.length < 2 || l.points.some(p => !p.geo));
    if (lIdx !== -1) {
        const line = s.lines[lIdx], L = `L${lIdx + 1}`;
        if (line.pristine) return { idx: 2, progress, hint: `Drag ${L} onto a road, shadow or edge pointing away from the camera` };
        if (line.points.length < 2) {
            const n = line.points.length + 1;
            return state.mode === 'add-point' && state.activeLineIndex === lIdx
                ? { idx: 3, progress, pressed: true, hint: `Click ${L} on a known feature to place P${n}` }
                : { idx: 3, progress, hint: `Select ${L} · press Tab or click Mode for Add Point` };
        }
        const pIdx = line.points.findIndex(p => !p.geo);
        if (state.mode === 'map-point' && state.mapPointTarget) {
            const t = state.mapPointTarget;
            return { idx: 4, progress, pressed: true, hint: `Click the map to place L${t.lineIndex + 1} P${t.pointIndex + 1} · Esc to cancel` };
        }
        return { idx: 4, progress, hint: `Press F or click 🌐 P${pIdx + 1} of ${L}, then click the map` };
    }
    if (s.lines.length < 2) return { idx: 5, progress, hint: 'Press E for a second line: two rays give the position' };
    if (s.lines.length === 2) return { idx: 6, progress, hint: 'Position found. A third line adds a confidence ellipse' };
    return { idx: 6, progress, hint: 'Done. More lines tighten the ellipse' };
}

function buildGuide() {
    guideEl.innerHTML = '';
    const rail = el('div', 'guide-rail', guideEl);
    el('div', 'guide-rail-fill', rail);
    GUIDE_STEPS.forEach((st, i) => {
        const b = el('button', 'guide-step' + (st.key ? '' : ' no-key'), guideEl);
        b.type = 'button';
        b.title = st.title + (st.key ? ` (${st.key})` : '');
        b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${st.icon}</svg>` +
                      (st.key ? `<span class="guide-key">${st.key}</span>` : '');
        b.onclick = () => guideAction(i);
    });
}

/* Clicking the current step does what its key does */
function guideAction(i) {
    const { idx } = guideStatus();
    if (i !== idx) return;
    if (i === 1 || i === 5) { btnAddLine.click(); return; }
    if (i === 3 && state.activeLineIndex !== -1 && state.mode === 'drag-line') { btnModeToggle.click(); return; }
    if (i === 4) {
        const s = sess();
        const lIdx = s.lines.findIndex(l => l.points.length >= 2 && l.points.some(p => !p.geo));
        if (lIdx === -1) return;
        state.activeLineIndex = lIdx;
        state.mode = 'map-point';
        state.mapPointTarget = { lineIndex: lIdx, pointIndex: s.lines[lIdx].points.findIndex(p => !p.geo) };
        render(); updateUI();
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
    lineBar.querySelectorAll('.line-item, .map-hint').forEach(el => el.remove());

    sess().lines.forEach((line, lIdx) => {
        const colour = line.colour || lineColour(lIdx, activeSessionIndex);
        const active = lIdx === state.activeLineIndex;

        const placedPts = line.points.filter(p => p.geo);
        const intersection = sess().mapObjects.intersectionLatLng;
        const bearingLabel = (placedPts.length >= 2 && intersection)
            ? (() => {
                const mid = {
                    lat: (placedPts[0].geo.lat + placedPts[1].geo.lat) / 2,
                    lng: (placedPts[0].geo.lng + placedPts[1].geo.lng) / 2
                };
                const deg = Math.round(bearingDeg(intersection, mid));
                return `<span class="line-bearing">${deg.toString().padStart(3, '0')}°</span>`;
            })()
            : '';

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
        header.onclick = () => {
            state.activeLineIndex = lIdx;
            if (state.mode !== 'add-point') state.mode = 'drag-line';   // from idle too, so the mode toggle works
            render(); updateUI();
        };
        item.appendChild(header);

        if (active && line.points.length > 0) {
            const ptBox = document.createElement('div');
            ptBox.className = 'point-manager';

            line.points.forEach((pt, pIdx) => {
                const hasGeo = !!(pt.geo);
                const ptItem = document.createElement('div');
                ptItem.className = 'point-item' + (hasGeo ? ' has-geo' : '');

                const isTarget = state.mode === 'map-point'
                    && state.mapPointTarget
                    && state.mapPointTarget.lineIndex === lIdx
                    && state.mapPointTarget.pointIndex === pIdx;

                ptItem.title = hasGeo ? 'Re-place on map' : 'Place on map';
                const iconStyle = isTarget ? `style="color:${colour}"` : '';
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
                ptItem.onclick = () => startMapPoint(lIdx, pIdx);
                ptBox.appendChild(ptItem);
            });

            item.appendChild(ptBox);
        }

        lineBar.insertBefore(item, document.getElementById('session-manager-wrap'));
    });

    if (state.mode === 'map-point' && state.mapPointTarget) {
        const { lineIndex, pointIndex } = state.mapPointTarget;
        const c = lineColour(lineIndex, activeSessionIndex);
        const hint = document.createElement('div');
        hint.className = 'map-hint';
        hint.style.cssText = `color:${c}; border-color:${c}55; background:${c}18;`;
        hint.textContent = `Click map → L${lineIndex + 1} P${pointIndex + 1}`;
        lineBar.insertBefore(hint, document.getElementById('session-manager-wrap'));
    }
}

/* ============================================================
   LINE / POINT LOGIC
   ============================================================ */
window.deleteLine = (idx) => {
    clearMapObjectsForLine(idx);
    sess().lines.splice(idx, 1);
    sess().mapObjects.geoMarkers.splice(idx, 1);
    state.activeLineIndex = Math.min(state.activeLineIndex, sess().lines.length - 1);
    if (sess().lines.length === 0) { state.activeLineIndex = -1; state.mode = 'idle'; }
    sess().lines.forEach((_, lIdx) => rebuildMapForLine(lIdx));
    recomputeIntersection();
    render(); updateUI();
};

window.deletePoint = (lIdx, pIdx) => {
    sess().lines[lIdx].points.splice(pIdx, 1);
    if (state.mode === 'map-point' && state.mapPointTarget &&
        state.mapPointTarget.lineIndex === lIdx) {
        state.mode = 'add-point';
        state.mapPointTarget = null;
    }
    rebuildMapForLine(lIdx);
    recomputeIntersection();
    render(); updateUI();
};

window.startMapPoint = (lIdx, pIdx) => {
    state.mode = 'map-point';
    state.mapPointTarget = { lineIndex: lIdx, pointIndex: pIdx };
    updateUI();
};

btnAddLine.onclick = () => {
    if (!sess().imgElement) return showToast("Drop an image first.");
    if (sess().lines.length >= 5) return showToast("Maximum of 5 lines per image.");
    const v  = sess().view;
    const cr = container.getBoundingClientRect();
    // Place the line at the horizontal centre of the currently visible viewport
    const viewCenterX = (cr.width / 2 - v.tx) / v.scale;
    const clampedX    = Math.max(0, Math.min(canvas.width, viewCenterX));
    sess().lines.push({ x: clampedX, points: [], pristine: true });
    state.activeLineIndex = sess().lines.length - 1;
    state.mode = 'drag-line';
    render(); updateUI();
};

btnModeToggle.onclick = () => {
    if (state.mode === 'map-point') { state.mode = 'drag-line'; state.mapPointTarget = null; }
    else {
        const line = sess().lines[state.activeLineIndex];
        const lineFull = line && line.points.length >= 2;
        state.mode = (state.mode === 'drag-line' && !lineFull) ? 'add-point' : 'drag-line';
    }
    updateUI();
};

btnHorizon.onclick = () => {
    if (!sess().imgElement) return;
    if (sess().view.rotation !== 0) {
        sess().view.rotation = 0;
        state.mode = 'idle';
        sess().horizonPoints = [];
        render(); updateUI();
    } else {
        state.mode = 'horizon';
        sess().horizonPoints = [];
        render(); updateUI();
    }
};

/* Keyboard shortcuts */
document.addEventListener('keydown', (e) => {
    // Ignore when typing in an actual text input
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Browser shortcuts (Ctrl+R reload, Ctrl+F find, ...) are not ours; Ctrl+V arrives as a paste event
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Escape — cancel / deselect
    if (e.key === 'Escape') {
        // A drag in progress snaps back instead of deselecting
        if (cancelMarkerDrag()) return;
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
            state.mode = 'idle';
        }
        render(); updateUI();
        return;
    }

    // F — activate map-point mode for the next unmapped point of the active line
    if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const s = sess();
        if (state.activeLineIndex === -1 || !s.lines[state.activeLineIndex]) return;
        const line = s.lines[state.activeLineIndex];
        const unmapped = line.points.findIndex(p => !p.geo);
        if (unmapped !== -1) {
            state.mode = 'map-point';
            state.mapPointTarget = { lineIndex: state.activeLineIndex, pointIndex: unmapped };
            render(); updateUI();
        }
        return;
    }

    // W — level tool (toggle / reset)
    if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        btnHorizon.click();
        return;
    }

    // X — toggle help card
    if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        const card = document.getElementById('help-card');
        if (card.style.display === 'none') showHelp(false); else hideHelp();
        return;
    }

    // E — new line
    if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        btnAddLine.click();
        return;
    }

    // R — remove active line
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (state.activeLineIndex !== -1) deleteLine(state.activeLineIndex);
        return;
    }

    // N — same as clicking the compass: reset bearing and tilt
    if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        map.resetNorthPitch();
        return;
    }

    // Tab — toggle Drag Line / Add Point
    if (e.key === 'Tab') {
        e.preventDefault();
        if (sess().imgElement && sess().lines.length > 0 &&
            (state.mode === 'drag-line' || state.mode === 'add-point')) {
            btnModeToggle.click();
        }
        return;
    }

    // 1–5 — jump to line
    const lineNum = parseInt(e.key);
    if (lineNum >= 1 && lineNum <= 5) {
        e.preventDefault();
        const idx = lineNum - 1;
        if (idx < sess().lines.length) {
            state.activeLineIndex = idx;
            if (state.mode === 'map-point') state.mapPointTarget = null;
            if (state.mode !== 'add-point') state.mode = 'drag-line';   // from idle too, so the mode toggle works
            render(); updateUI();
        }
    }
});

/* ============================================================
   SESSION MANAGEMENT
   ============================================================ */
function renderSessionMenu() {
    const menu = document.getElementById('session-menu');
    if (!menu) return;
    menu.innerHTML = '';

    // Demo entry at the top
    const demoItem = document.createElement('div');
    demoItem.className = 'session-item session-demo';
    demoItem.innerHTML = `<span>📷</span><span class="session-name">Demo — Potsdam</span>`;
    demoItem.onclick = () => { loadDemoImage(); menu.style.display = 'none'; };
    menu.appendChild(demoItem);

    const demoDivider = document.createElement('div');
    demoDivider.className = 'session-divider';
    menu.appendChild(demoDivider);

    sessions.forEach((s, idx) => {
        const item = document.createElement('div');
        item.className = 'session-item' + (idx === activeSessionIndex ? ' active-session' : '');
        item.style.setProperty('--sc', LINE_COLOURS[(sessionColourIndex(idx) * 2) % LINE_COLOURS.length]);
        const dot = document.createElement('span');
        dot.className = 'session-dot';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'session-name';
        nameSpan.textContent = s.name;
        item.appendChild(dot);
        item.appendChild(nameSpan);
        if (s.imgElement) {
            item.insertAdjacentHTML('beforeend',
                `<button class="btn-session-export" title="Export session" data-action="export-session" data-idx="${idx}">
                     <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <line x1="5" y1="1" x2="5" y2="8"/><polyline points="2,5.5 5,8.5 8,5.5"/>
                     </svg></button>`);
        }
        item.insertAdjacentHTML('beforeend',
            `<button class="btn-delete" title="Remove image" data-action="remove-session" data-idx="${idx}">×</button>`);
        item.onclick = () => {
            switchToSession(idx);
            menu.style.display = 'none';
        };
        menu.appendChild(item);
    });

    const divider = document.createElement('div');
    divider.className = 'session-divider';
    menu.appendChild(divider);

    const addBtn = document.createElement('div');
    addBtn.className = 'session-add';
    addBtn.textContent = '+ Add image';
    addBtn.onclick = () => { addSession(); menu.style.display = 'none'; };
    menu.appendChild(addBtn);

    const importBtn = document.createElement('div');
    importBtn.className = 'session-add session-import';
    importBtn.innerHTML = `<span class="export-icon">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="9" x2="5" y2="2"/><polyline points="2,4.5 5,1.5 8,4.5"/>
        </svg></span> Import session`;
    importBtn.onclick = () => { jsonPicker.click(); menu.style.display = 'none'; };
    menu.appendChild(importBtn);

    if (sessions.some(s => s.imgElement)) {
        const exportAllBtn = document.createElement('div');
        exportAllBtn.className = 'session-add session-export-all';
        exportAllBtn.innerHTML = `<span class="export-icon">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="1" x2="5" y2="8"/><polyline points="2,5.5 5,8.5 8,5.5"/>
            </svg></span> Export all sessions`;
        exportAllBtn.onclick = () => { exportAllSessions(); menu.style.display = 'none'; };
        menu.appendChild(exportAllBtn);
    }
}

function switchToSession(idx) {
    hideHelp();
    state.mode           = 'idle';
    state.activeLineIndex = -1;
    state.mapPointTarget  = null;
    state.isDragging      = false;
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

    const exifWrap = document.getElementById('exif-wrap');
    const exifCard = document.getElementById('exif-card');
    // Show exif button if an image is loaded, or if exif data was restored from JSON
    exifWrap.style.display = (s.imgElement || s.exif) ? 'block' : 'none';
    exifCard.style.display = 'none';

    if (s.imgElement) {
        canvas.width         = s.imgElement.width;
        canvas.height        = s.imgElement.height;
        canvas.style.display = 'block';
        overlay.style.display = 'none';
        applyTransform();
        render();
    } else {
        canvas.style.display  = 'none';
        overlay.style.display = 'flex';
        updateDropOverlay();
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

window.removeSession = (idx) => {
    removeSessionMarkers(sessions[idx]);
    if (sessions[idx].currentObjectURL) URL.revokeObjectURL(sessions[idx].currentObjectURL);
    hideHelp();
    // Save active session's map view before splice shifts indices
    if (activeSessionIndex !== idx && sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].mapView = getMapView();
    }
    sessions.splice(idx, 1);
    rebuildWorkSource();   // drops the removed session's rays and ellipse
    const wasLast = sessions.length === 0;
    if (wasLast) sessions.push(createSession('Image 1'));
    activeSessionIndex = sessions.length; // out of range → switchToSession skips its save step
    switchToSession(Math.min(idx, sessions.length - 1));
    if (wasLast) applyMapView(WORLD_VIEW);
};

/* ============================================================
   HELP CARD
   ============================================================ */
function showHelp(isDemo = false) {
    document.getElementById('help-card').style.display = 'block';
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
        .then(r => r.blob())
        .then(blob => {
            const file = new File([blob], 'Potsdam_Germany.jpg', { type: 'image/jpeg' });
            if (sess().imgElement) addSession();
            loadImage(file);
            jumpTo({ lat: 52.3899735750511, lng: 13.060147762298586 }, 15);
            showHelp(true);
        });
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
            `Drop image here` +
            `<button id="btn-browse" type="button">Browse</button>`;
    }
}

function loadImage(file) {
    const s = sess();
    const isRestore = !!s.pendingImageFilename;
    if (s.currentObjectURL) URL.revokeObjectURL(s.currentObjectURL);
    s.currentObjectURL = URL.createObjectURL(file);
    s.imageFilename = file.name;
    s.pendingImageFilename = null;
    if (!isRestore) s.name = file.name.replace(/\.[^.]+$/, '');
    s.imgElement = new Image();
    s.imgElement.onload = () => {
        canvas.width  = s.imgElement.width;
        canvas.height = s.imgElement.height;
        canvas.style.display = 'block';
        overlay.style.display = 'none';
        if (!isRestore) {
            const cr = container.getBoundingClientRect();
            s.view.scale = Math.min(cr.width / s.imgElement.width, cr.height / s.imgElement.height, 1);
            s.view.tx = (cr.width  - s.imgElement.width  * s.view.scale) / 2;
            s.view.ty = (cr.height - s.imgElement.height * s.view.scale) / 2;
        }
        applyTransform();
        render();
        renderSessionMenu();
        updateGuide();
    };
    s.imgElement.src = s.currentObjectURL;

    // Read EXIF metadata — enable all segments so XMP/IPTC fields are included
    exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
        .then(exif => { s.exif = exif || null; })
        .catch(() => { s.exif = null; })
        .finally(() => {
            document.getElementById('exif-wrap').style.display = 'block';
            document.getElementById('exif-card').style.display = 'none';
        });
}

container.addEventListener('dragover',  (e) => { e.preventDefault(); container.classList.add('drag-active'); });
container.addEventListener('dragleave', ()  => container.classList.remove('drag-active'));
container.addEventListener('drop', (e) => {
    e.preventDefault(); container.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
});

const filePicker = document.getElementById('file-picker');
overlay.addEventListener('click', (e) => {
    if (e.target.id === 'btn-browse') filePicker.click();
});
filePicker.addEventListener('change', () => {
    const file = filePicker.files[0];
    if (file) { loadImage(file); filePicker.value = ''; }
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
        const m = val.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (m) {
            const d = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
            return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        }
        return val;
    }
    return String(val);
}

function formatExposure(val) {
    if (val == null) return null;
    if (val >= 1) return `${val}s`;
    const denom = Math.round(1 / val);
    return `1/${denom}s`;
}

function formatFlash(val) {
    if (val == null) return null;
    return (val & 0x01) ? 'Fired' : 'No flash';
}

function formatOrientation(val) {
    const map = { 1:'Normal', 2:'Mirrored', 3:'180°', 4:'Mirrored 180°',
                  5:'90° CCW mirrored', 6:'90° CW', 7:'90° CW mirrored', 8:'90° CCW' };
    return map[val] || null;
}

function formatWhiteBalance(val) {
    if (val == null) return null;
    return val === 0 ? 'Auto' : val === 1 ? 'Manual' : null;
}

function formatExposureMode(val) {
    if (val == null) return null;
    return (['Auto', 'Manual', 'Auto bracket'][val]) ?? null;
}

function formatGPSSpeed(speed, ref) {
    if (speed == null) return null;
    const unit = ref === 'M' ? 'mph' : ref === 'N' ? 'kn' : 'km/h';
    return `${speed.toFixed(1)} ${unit}`;
}

function formatGPSTimestamp(ts, dateStamp) {
    if (ts == null) return null;
    let time;
    if (Array.isArray(ts) && ts.length === 3) {
        time = ts.map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
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
    if (Array.isArray(val) && val.length === 3) return val[0] + val[1] / 60 + val[2] / 3600;
    return null;
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
        const lat = dmsToDecimal(e.GPSLatitude);
        const lng = dmsToDecimal(e.GPSLongitude);
        const alt = dmsToDecimal(e.GPSAltitude);
        const dir = e.GPSImgDirection != null ? Number(e.GPSImgDirection) : null;
        const trk = e.GPSTrack        != null ? Number(e.GPSTrack)        : null;

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
            ['Aperture',      pick(e, 'FNumber', 'ApertureValue') != null ? `f/${e.FNumber ?? e.ApertureValue}` : null],
            ['Shutter',       formatExposure(pick(e, 'ExposureTime', 'ShutterSpeedValue'))],
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
            ['Cam direction', dir != null ? `${Math.round(dir)}° ${cardinalDir(dir)}` : null],
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
            ? `<button class="exif-gps-btn" data-action="exif-gps">${crosshair}Show on map</button>`
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

window.goToExifGps = () => {
    const s   = sess();
    const lat = dmsToDecimal(s.exif?.GPSLatitude);
    const lng = dmsToDecimal(s.exif?.GPSLongitude);
    if (lat == null || lng == null) return;

    // Remove previous EXIF GPS marker for this session
    if (s.exifGpsMarker) {
        s.exifGpsMarker.remove();
        s.exifGpsMarker = null;
    }

    const exifCoords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    s.exifGpsMarker = new maplibregl.Marker({ element: el('div', 'exif-gps-marker') })
        .setLngLat([lng, lat])
        .setPopup(coordPopup('EXIF GPS Position', exifCoords, 'tp-popup tp-popup-exif', 12))
        .addTo(map);

    jumpTo({ lat, lng }, Math.max(map.getZoom(), 15));
    s.exifGpsMarker.togglePopup();
};

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

window.addExifRay = () => {
    const s   = sess();
    const lat = dmsToDecimal(s.exif?.GPSLatitude);
    const lng = dmsToDecimal(s.exif?.GPSLongitude);
    const dir = s.exif?.GPSImgDirection != null ? Number(s.exif.GPSImgDirection) : null;
    if (lat == null || lng == null) return showToast('No GPS coordinates in image metadata.');
    if (dir == null) return showToast('No camera direction in image metadata.');
    if (!s.imgElement) return showToast('Load the image before adding a ray.');
    if (s.lines.some(l => l.source === 'exif' || l.colour === '#e03c3c')) return showToast('EXIF direction ray already added.');
    if (s.lines.length >= 5) return showToast('Maximum of 5 lines per image.');

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
};

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
        lines:             s.lines.map((l, lIdx) => {
            const placed = l.points.filter(p => p.geo);
            const intersection = s.mapObjects.intersectionLatLng;
            let bearing = null;
            if (placed.length >= 2 && intersection) {
                const mid = {
                    lat: (placed[0].geo.lat + placed[1].geo.lat) / 2,
                    lng: (placed[0].geo.lng + placed[1].geo.lng) / 2
                };
                bearing = Math.round(bearingDeg(intersection, mid));
            }
            return {
                label:   `L${lIdx + 1}`,
                x:       l.x,
                colour:  l.colour || null,
                source:  l.source || null,
                bearing: bearing,
                points:  l.points.map((pt, pIdx) => ({
                    label: `L${lIdx + 1}P${pIdx + 1}`,
                    y:     pt.y,
                    geo:   pt.geo || null
                }))
            };
        }),
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

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

window.exportSession = (idx) => {
    const s  = sessions[idx];
    if (idx === activeSessionIndex) s.mapView = getMapView();
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    downloadJSON(
        { json_version: JSON_VERSION, exported: new Date().toISOString(), sessions: [sessionToData(s)] },
        `tracepoint_${s.name}_${ts}.json`
    );
    showToast('Session exported.', 'success');
};

function exportAllSessions() {
    if (sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].mapView = getMapView();
    }
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    downloadJSON(
        { json_version: JSON_VERSION, exported: new Date().toISOString(),
          sessions: sessions.filter(s => s.imgElement).map(sessionToData) },
        `tracepoint_all_${ts}.json`
    );
    showToast('All sessions exported.', 'success');
}

function importSessions(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const list = data.sessions;
            if (!Array.isArray(list) || list.length === 0) return showToast('No sessions found in file.');

            list.forEach(sd => {
                // Reuse the current session slot if it's completely empty
                const cur = sess();
                let s;
                if (!cur.imgElement && cur.lines.length === 0) {
                    s = cur;
                    s.name = typeof sd.name === 'string' ? sd.name : 'Imported session';
                } else {
                    s = createSession(typeof sd.name === 'string' ? sd.name : 'Imported session');
                    sessions.push(s);
                }

                if (sd.colourIndex != null) s.colourIndex = sd.colourIndex;
                if ('exif' in sd) s.exif = sd.exif;
                s.imageFilename        = sd.imageFilename || null;
                s.pendingImageFilename = sd.imageFilename || null;
                s.lines = (sd.lines || [])
                    .filter(l => l && typeof l.x === 'number')
                    .map(l => ({
                        x:      l.x,
                        colour: typeof l.colour === 'string' ? l.colour : null,
                        source: typeof l.source === 'string' ? l.source : null,
                        points: (l.points || [])
                            .filter(pt => pt && typeof pt.y === 'number')
                            .map(pt => ({
                                y:   pt.y,
                                geo: (pt.geo && typeof pt.geo.lat === 'number' && typeof pt.geo.lng === 'number')
                                     ? pt.geo : null
                            }))
                    }));
                if (sd.view && typeof sd.view === 'object') {
                    const { scale, tx, ty, rotation } = sd.view;
                    const validScale = typeof scale === 'number' && isFinite(scale);
                    if (validScale) {
                        s.view.scale = scale;
                        if (typeof tx === 'number' && isFinite(tx)) s.view.tx = tx;
                        if (typeof ty === 'number' && isFinite(ty)) s.view.ty = ty;
                    }
                    if (typeof rotation === 'number' && isFinite(rotation)) s.view.rotation = rotation;
                }

                // Switch first — switchToSession saves the outgoing session's live map
                // position; setting s.mapView before the call would get overwritten when
                // s === sessions[activeSessionIndex] (reused empty slot case).
                switchToSession(sessions.indexOf(s));

                // Restore imported mapView after the switch so it can't be clobbered
                if (sd.mapView &&
                    typeof sd.mapView.center?.lat === 'number' && isFinite(sd.mapView.center.lat) &&
                    typeof sd.mapView.center?.lng === 'number' && isFinite(sd.mapView.center.lng) &&
                    typeof sd.mapView.zoom === 'number' && isFinite(sd.mapView.zoom)) {
                    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
                    s.mapView = {
                        center:  { lat: sd.mapView.center.lat, lng: sd.mapView.center.lng },
                        zoom:    sd.mapView.zoom,
                        bearing: num(sd.mapView.bearing),
                        pitch:   num(sd.mapView.pitch)
                    };
                    applyMapView(s.mapView);
                }

                s.lines.forEach((_, lIdx) => rebuildMapForLine(lIdx));
                recomputeIntersection();
                updateUI();
            });

            renderSessionMenu();
            showToast(`${list.length} session${list.length > 1 ? 's' : ''} imported.`, 'success');
        } catch (err) {
            showToast('Invalid TracePoint session file.');
        }
    };
    reader.readAsText(file);
}

/* ============================================================
   ZOOM  (wheel on container)
   ============================================================ */
container.addEventListener('wheel', (e) => {
    if (!sess().imgElement) return;
    e.preventDefault();
    const v = sess().view;
    const rect   = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    v.tx = mouseX - (mouseX - v.tx) * (newScale / v.scale);
    v.ty = mouseY - (mouseY - v.ty) * (newScale / v.scale);
    v.scale = newScale;
    applyTransform();
}, { passive: false });

/* ============================================================
   PAN  (middle-click drag  OR  space + left-drag)
   ============================================================ */
let spaceDown = false;
document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        spaceDown = true; e.preventDefault();
    }
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

container.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
        isPanning = true;
        panStart  = { x: e.clientX, y: e.clientY };
        panOrigin = { tx: sess().view.tx, ty: sess().view.ty };
        container.style.cursor = 'grabbing';
        e.preventDefault();
    }
});
window.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; container.style.cursor = ''; }
    state.isDragging = false;
    if (state.pointDrag) { state.pointDrag = null; updateUI(); }
});
window.addEventListener('mousemove', (e) => {
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
    if (state.isDragging && state.activeLineIndex !== -1) {
        sess().lines[state.activeLineIndex].x = clientToImage(e).x;
        render();
    }
});

/* ============================================================
   CANVAS DRAWING
   ============================================================ */
function render() {
    const s = sess();
    if (!s.imgElement) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s.view.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
    ctx.drawImage(s.imgElement, 0, 0);
    ctx.restore();

    let needsRerender = false;
    ctx.font = 'bold 11px monospace';

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
            ctx.shadowBlur  = 22 + 12 * pulse;          // 10 … 34
        }

        ctx.beginPath();
        ctx.moveTo(line.x, 0);
        ctx.lineTo(line.x, canvas.height);
        ctx.strokeStyle = colour;
        ctx.lineWidth   = line.pristine ? 3.5 : (active ? 2.5 : 1.5);
        ctx.setLineDash(active || line.pristine ? [] : [6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur  = 0;

        line.points.forEach((pt, pIdx) => {
            const hasGeo = !!(pt.geo);

            ctx.beginPath();
            ctx.moveTo(line.x - 8, pt.y);
            ctx.lineTo(line.x + 8, pt.y);
            ctx.strokeStyle = colour;
            ctx.lineWidth   = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(line.x, pt.y, 6, 0, Math.PI * 2);
            ctx.fillStyle   = hasGeo ? colour : '#0a0a0a';
            ctx.strokeStyle = colour;
            ctx.lineWidth   = 2;
            ctx.fill();
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.fillStyle   = '#fff';
            ctx.fillText(`P${pIdx + 1}`, line.x + 10, pt.y + 4);
            ctx.globalAlpha = alpha;
        });

        ctx.globalAlpha = 1;
    });

    if (needsRerender) {
        if (pulseFrameId === null)
            pulseFrameId = requestAnimationFrame(() => { pulseFrameId = null; render(); });
    } else {
        if (pulseFrameId !== null) { cancelAnimationFrame(pulseFrameId); pulseFrameId = null; }
    }

    if (state.mode === 'horizon' && s.horizonPoints.length > 0) {
        const p1 = s.horizonPoints[0];
        const p2 = s.horizonPoints[1] || state._horizonMouse;
        ctx.save();
        ctx.strokeStyle = '#ffdc32';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 4]);
        if (p2) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
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
    const { x: mx } = clientToImage(e);
    const THRESH = 12 / sess().view.scale;

    if (state.mode === 'add-point') {
        let hit = -1;
        sess().lines.forEach((line, idx) => { if (Math.abs(line.x - mx) < THRESH) hit = idx; });
        if (hit === -1) { state.activeLineIndex = -1; state.mode = 'idle'; render(); updateUI(); }
        else sess().lines[hit].pristine = false;   // used without ever being dragged: the "grab me" glow is done
        return;
    }

    // A point's circle grabs the point (slide along its line); otherwise the line itself
    const { y: my } = clientToImage(e);
    let ptHit = null;
    sess().lines.forEach((line, idx) => line.points.forEach((pt) => {
        if (Math.hypot(line.x - mx, pt.y - my) < THRESH) ptHit = { line, pt, idx };
    }));
    if (ptHit) {
        state.activeLineIndex = ptHit.idx;
        state.mode = 'drag-line';
        state.pointDrag = { line: ptHit.line, pt: ptHit.pt, origY: ptHit.pt.y };
        ptHit.line.pristine = false;
        render(); updateUI();
        return;
    }

    let hit = -1;
    sess().lines.forEach((line, idx) => { if (Math.abs(line.x - mx) < THRESH) hit = idx; });
    if (hit !== -1) {
        state.activeLineIndex = hit;
        state.isDragging = true;
        state.mode = 'drag-line';
        sess().lines[hit].pristine = false;
        render(); updateUI();
    } else {
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
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
            sess().view.rotation = -angle;
            state.mode = 'idle';
            sess().horizonPoints = [];
            state._horizonMouse = null;
        }
        render(); updateUI();
        return;
    }

    if (state.mode !== 'add-point' || state.activeLineIndex === -1) return;
    const { x: mx, y: my } = clientToImage(e);
    const THRESH = 12 / sess().view.scale;
    const line = sess().lines[state.activeLineIndex];
    if (Math.abs(line.x - mx) > THRESH) {
        state.activeLineIndex = -1;
        state.mode = 'idle';
        render(); updateUI();
        return;
    }
    if (line.points.length >= 2) return;
    line.points.push({ y: my, geo: null });
    line.pristine = false;
    if (line.points.length === 2) state.mode = 'drag-line';
    render(); updateUI();
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
    ['Apple Maps',   (la, ln, z) => `https://maps.apple.com/?ll=${la},${ln}&q=${la},${ln}&z=${z}`],
    ['Bing Maps',    (la, ln, z) => `https://www.bing.com/maps?cp=${la}~${ln}&lvl=${z}&sp=point.${la}_${ln}_Pin`],
    ['Yandex Maps',  (la, ln, z) => `https://yandex.com/maps/?ll=${ln},${la}&z=${z}&pt=${ln},${la}`]
];

function hideCtxMenu() { ctxMenu.style.display = 'none'; }

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

    el('div', 'map-ctx-divider', ctxMenu);
    CTX_LINKS.forEach(([label, url]) => {
        const a = el('a', 'map-ctx-item', ctxMenu);
        a.href = url(la, ln, z);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `Open in ${label}`;
        a.onclick = hideCtxMenu;
    });

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
document.addEventListener('mousedown', (e) => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });

/* ============================================================
   MAP INTERACTION – place geo points
   ============================================================ */
map.on('click', (e) => {
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
    map.addSource('dem', {
        type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrarium</a> via AWS'
    });
    mapReady = true;
    setTileSet(activeTileSetId);
    setTerrain(terrainOn);
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
        const marker = new maplibregl.Marker({ element: node, draggable: true })
            .setLngLat([pt.geo.lng, pt.geo.lat]).addTo(map);
        attachMarkerDrag(marker, pt);
        mo.geoMarkers[lIdx].push(marker);
    });

    rebuildWorkSource();   // the ray for this line (if both points are placed)
}

/* Dragging a geo marker: the ray follows live, intersection and ellipse recompute on release.
   Esc while dragging snaps the point back (see the keyboard handler). Only the active session's
   markers are draggable (setMarkersDraggable on session switch). */
let markerDrag = null;   // { marker, pt, origin: {lat, lng}, cancelled }

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
        const angle = Math.abs(Cxy) < 1e-12 ? 0 : Math.atan2(l1 - Cxx, Cxy);
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
   GEO MATHS
   ============================================================ */
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const R   = 6371; // Earth radius km

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
    if (Math.abs(denom) < 1e-10) return null; // parallel

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
        lat: y1 + t * (y2 - y1),
        lng: x1 + t * (x2 - x1)
    };
}
