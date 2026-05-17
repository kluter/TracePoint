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

/* ============================================================
   SESSION MODEL
   Each session owns one image and all work done on it.
   ============================================================ */
function createSession(name) {
    const layerGroup = L.layerGroup().addTo(map);
    return {
        name,
        imgElement:       null,
        currentObjectURL: null,
        lines:            [],
        horizonPoints:    [],
        view:             { scale: 1, tx: 0, ty: 0, rotation: 0 },
        mapView:          null,
        layerGroup,
        mapObjects:       { rays: [], geoMarkers: [], intersectionMarker: null }
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

/* ---- MAP LAYERS ---- */
const map = L.map('map-container', { maxZoom: 21 }).setView([20, 0], 2);

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
              opts: { attribution: '', opacity: 0.7, maxZoom: 21, maxNativeZoom: 19 } },
            { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
              opts: { attribution: '', opacity: 0.7, maxZoom: 21, maxNativeZoom: 19 } }
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
        id: 'osm-hot',
        label: '❤️ OSM Humanitarian',
        layers: [
            { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
              opts: { attribution: '&copy; OpenStreetMap, HOT', maxZoom: 20 } }
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

let activeTileLayers = [];

function setTileSet(id) {
    activeTileLayers.forEach(l => map.removeLayer(l));
    activeTileLayers = [];
    const set = TILE_SETS.find(s => s.id === id) || TILE_SETS[0];
    set.layers.forEach(l => {
        const layer = L.tileLayer(l.url, l.opts).addTo(map);
        activeTileLayers.push(layer);
    });
    localStorage.setItem('tp-tileset', id);
}

setTileSet(localStorage.getItem('tp-tileset') || 'esri-sat');

/* ---- LAYER SWITCHER CONTROL ---- */
const LayerSwitcher = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
        const wrap = L.DomUtil.create('div', 'layer-switcher-wrap');
        L.DomEvent.disableClickPropagation(wrap);

        const btn = L.DomUtil.create('button', 'layer-burger', wrap);
        btn.title = 'Switch map layer';
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2"  width="16" height="2" rx="1"/>
            <rect y="7"  width="16" height="2" rx="1"/>
            <rect y="12" width="16" height="2" rx="1"/>
        </svg>`;

        const menu = L.DomUtil.create('div', 'layer-menu', wrap);
        menu.style.display = 'none';

        TILE_SETS.forEach(set => {
            const item = L.DomUtil.create('div', 'layer-item', menu);
            item.textContent = set.label;
            item.dataset.id  = set.id;
            item.onclick = () => {
                setTileSet(set.id);
                menu.querySelectorAll('.layer-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                menu.style.display = 'none';
            };
        });

        const savedId = localStorage.getItem('tp-tileset') || 'esri-sat';
        menu.querySelector(`[data-id="${savedId}"]`)?.classList.add('active');

        btn.onclick = () => {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        map.on('click', () => { menu.style.display = 'none'; });

        return wrap;
    }
});
new LayerSwitcher().addTo(map);

/* ============================================================
   COLOUR PALETTE
   Sessions each get a base colour; lines within a session step
   through the same palette offset by the session's position.
   ============================================================ */
const LINE_COLOURS = [
    '#00aaff', '#ff6b35', '#7fff6b', '#ff35c8',
    '#ffe135', '#35ffe1', '#b535ff', '#ff3535'
];

/* Derive a stable colour slot from the session name if it matches "Image N", else fall back to position */
function sessionColourIndex(sessionIdx) {
    const m = sessions[sessionIdx]?.name.match(/^Image (\d+)$/);
    return m ? parseInt(m[1]) - 1 : sessionIdx;
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

    map.getContainer().style.cursor = (state.mode === 'map-point') ? 'crosshair' : '';

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
}

function updateLineManager() {
    toolbar.querySelectorAll('.line-item, .point-manager, .map-hint').forEach(el => el.remove());

    sess().lines.forEach((line, lIdx) => {
        const colour = lineColour(lIdx, activeSessionIndex);
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
        item.innerHTML =
            `<span class="line-dot"></span>` +
            `<span class="line-label">L${lIdx + 1}</span>` +
            bearingLabel +
            `<button class="btn-delete" title="Delete line"
                onclick="event.stopPropagation(); deleteLine(${lIdx})">×</button>`;
        item.onclick = () => {
            state.activeLineIndex = lIdx;
            if (state.mode === 'map-point') state.mode = 'drag-line';
            render(); updateUI();
        };
        toolbar.appendChild(item);

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
                    `<button class="btn-delete" onclick="event.stopPropagation(); deletePoint(${lIdx},${pIdx})">×</button>`;
                ptItem.onclick = () => startMapPoint(lIdx, pIdx);
                ptBox.appendChild(ptItem);
            });

            toolbar.appendChild(ptBox);
        }
    });

    if (state.mode === 'map-point' && state.mapPointTarget) {
        const { lineIndex, pointIndex } = state.mapPointTarget;
        const c = lineColour(lineIndex, activeSessionIndex);
        const hint = document.createElement('div');
        hint.className = 'map-hint';
        hint.style.cssText = `color:${c}; border-color:${c}55; background:${c}18;`;
        hint.textContent = `Click map → L${lineIndex + 1} P${pointIndex + 1}`;
        toolbar.appendChild(hint);
    }
}

/* ============================================================
   LINE / POINT LOGIC
   ============================================================ */
window.deleteLine = (idx) => {
    clearMapObjectsForLine(idx);
    sess().lines.splice(idx, 1);
    state.activeLineIndex = Math.min(state.activeLineIndex, sess().lines.length - 1);
    if (sess().lines.length === 0) { state.activeLineIndex = -1; state.mode = 'idle'; }
    recomputeIntersection();
    render(); updateUI();
};

window.deletePoint = (lIdx, pIdx) => {
    sess().lines[lIdx].points.splice(pIdx, 1);
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
    if (!sess().imgElement) return alert("Drop an image first.");
    sess().lines.push({ x: canvas.width / 2, points: [] });
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

/* ESC to deselect / cancel */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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
        item.innerHTML =
            `<span class="session-dot"></span>` +
            `<span class="session-name">${s.name}</span>` +
            `<button class="btn-delete" title="Remove image"
                 onclick="event.stopPropagation(); removeSession(${idx})">×</button>`;
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
        sessions[activeSessionIndex].mapView = { center: map.getCenter(), zoom: map.getZoom() };
    }

    activeSessionIndex = idx;
    const s = sess();

    if (s.mapView) {
        map.setView(s.mapView.center, s.mapView.zoom);
    } else {
        const hasGeoWork = s.lines.some(l => l.points.some(p => p.geo));
        if (!hasGeoWork) map.setView([20, 0], 2);
    }

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
    map.removeLayer(sessions[idx].layerGroup);
    if (sessions[idx].currentObjectURL) URL.revokeObjectURL(sessions[idx].currentObjectURL);
    hideHelp();
    // Save active session's map view before splice shifts indices
    if (activeSessionIndex !== idx && sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].mapView = { center: map.getCenter(), zoom: map.getZoom() };
    }
    sessions.splice(idx, 1);
    const wasLast = sessions.length === 0;
    if (wasLast) sessions.push(createSession('Image 1'));
    activeSessionIndex = sessions.length; // out of range → switchToSession skips its save step
    switchToSession(Math.min(idx, sessions.length - 1));
    if (wasLast) map.setView([20, 0], 2);
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
            map.setView([52.3899735750511, 13.060147762298586], 16);
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
function loadImage(file) {
    const s = sess();
    if (s.currentObjectURL) URL.revokeObjectURL(s.currentObjectURL);
    s.currentObjectURL = URL.createObjectURL(file);
    s.name = file.name.replace(/\.[^.]+$/, ''); // use filename (no extension) as session name
    s.imgElement = new Image();
    s.imgElement.onload = () => {
        canvas.width  = s.imgElement.width;
        canvas.height = s.imgElement.height;
        canvas.style.display = 'block';
        overlay.style.display = 'none';
        const cr = container.getBoundingClientRect();
        s.view.scale = Math.min(cr.width / s.imgElement.width, cr.height / s.imgElement.height, 1);
        s.view.tx = (cr.width  - s.imgElement.width  * s.view.scale) / 2;
        s.view.ty = (cr.height - s.imgElement.height * s.view.scale) / 2;
        applyTransform();
        render();
        renderSessionMenu();
    };
    s.imgElement.src = s.currentObjectURL;
}

container.addEventListener('dragover',  (e) => { e.preventDefault(); container.classList.add('drag-active'); });
container.addEventListener('dragleave', ()  => container.classList.remove('drag-active'));
container.addEventListener('drop', (e) => {
    e.preventDefault(); container.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
});

const filePicker = document.getElementById('file-picker');
document.getElementById('btn-browse').addEventListener('click', () => filePicker.click());
filePicker.addEventListener('change', () => {
    const file = filePicker.files[0];
    if (file) { loadImage(file); filePicker.value = ''; }
});

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
    if (e.code === 'Space' && document.activeElement === document.body) {
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
});
window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        sess().view.tx = panOrigin.tx + (e.clientX - panStart.x);
        sess().view.ty = panOrigin.ty + (e.clientY - panStart.y);
        applyTransform();
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

    s.lines.forEach((line, idx) => {
        const active  = idx === state.activeLineIndex;
        const colour  = lineColour(idx, activeSessionIndex);
        const alpha   = active ? 1.0 : 0.5;

        ctx.globalAlpha = alpha;

        ctx.beginPath();
        ctx.moveTo(line.x, 0);
        ctx.lineTo(line.x, canvas.height);
        ctx.strokeStyle = colour;
        ctx.lineWidth   = active ? 2.5 : 1.5;
        ctx.setLineDash(active ? [] : [6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

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
            ctx.font        = 'bold 11px monospace';
            ctx.fillStyle   = '#fff';
            ctx.fillText(`P${pIdx + 1}`, line.x + 10, pt.y + 4);
            ctx.globalAlpha = alpha;
        });

        ctx.globalAlpha = 1;
    });

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
        return;
    }

    let hit = -1;
    sess().lines.forEach((line, idx) => { if (Math.abs(line.x - mx) < THRESH) hit = idx; });
    if (hit !== -1) {
        state.activeLineIndex = hit;
        state.isDragging = true;
        state.mode = 'drag-line';
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
    if (line.points.length === 2) state.mode = 'drag-line';
    render(); updateUI();
});

/* ============================================================
   MAP INTERACTION – place geo points
   ============================================================ */
map.on('click', (e) => {
    if (state.mode !== 'map-point' || !state.mapPointTarget) return;
    const { lineIndex, pointIndex } = state.mapPointTarget;
    const line = sess().lines[lineIndex];
    if (!line || !line.points[pointIndex]) return;

    line.points[pointIndex].geo = { lat: e.latlng.lat, lng: e.latlng.lng };

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
function clearMapObjectsForLine(lIdx) {
    const s  = sess();
    const mo = s.mapObjects;
    if (mo.geoMarkers[lIdx]) {
        mo.geoMarkers[lIdx].forEach(m => s.layerGroup.removeLayer(m));
        mo.geoMarkers[lIdx] = [];
    }
    if (mo.rays[lIdx]) {
        s.layerGroup.removeLayer(mo.rays[lIdx]);
        mo.rays[lIdx] = null;
    }
}

function rebuildMapForLine(lIdx) {
    clearMapObjectsForLine(lIdx);
    const s      = sess();
    const line   = s.lines[lIdx];
    const colour = lineColour(lIdx, activeSessionIndex);
    const mo     = s.mapObjects;

    if (!mo.geoMarkers[lIdx]) mo.geoMarkers[lIdx] = [];

    line.points.forEach((pt, pIdx) => {
        if (!pt.geo) return;
        const marker = L.circleMarker([pt.geo.lat, pt.geo.lng], {
            radius: 6, color: colour, fillColor: colour,
            fillOpacity: 0.9, weight: 2
        }).bindTooltip(`L${lIdx + 1} P${pIdx + 1}`, { permanent: false }).addTo(s.layerGroup);
        mo.geoMarkers[lIdx].push(marker);
    });

    const placed = line.points.filter(p => p.geo);
    if (placed.length < 2) return;

    const p1 = placed[0].geo;
    const p2 = placed[1].geo;
    const bearing = bearingDeg(p1, p2);
    const RAY_KM  = 50;
    const fwd     = destinationPoint(p1, bearing,       RAY_KM);
    const bwd     = destinationPoint(p1, bearing + 180, RAY_KM);

    mo.rays[lIdx] = L.polyline(
        [[bwd.lat, bwd.lng], [p1.lat, p1.lng], [p2.lat, p2.lng], [fwd.lat, fwd.lng]],
        { color: colour, weight: 2, opacity: 0.85, dashArray: '6 4' }
    ).addTo(s.layerGroup);
}

/* ============================================================
   INTERSECTION
   ============================================================ */
function recomputeIntersection() {
    const s  = sess();
    const mo = s.mapObjects;
    if (mo.intersectionMarker) {
        s.layerGroup.removeLayer(mo.intersectionMarker);
        mo.intersectionMarker = null;
        mo.intersectionLatLng = null;
    }

    const rays = [];
    sess().lines.forEach((line) => {
        const placed = line.points.filter(p => p.geo);
        if (placed.length < 2) return;
        rays.push({ p1: placed[0].geo, p2: placed[1].geo });
    });

    if (rays.length < 2) return;

    const hits = [];
    for (let i = 0; i < rays.length; i++) {
        for (let j = i + 1; j < rays.length; j++) {
            const pt = intersectLines(rays[i].p1, rays[i].p2, rays[j].p1, rays[j].p2);
            if (pt) hits.push(pt);
        }
    }
    if (hits.length === 0) return;

    const avgLat = hits.reduce((s, p) => s + p.lat, 0) / hits.length;
    const avgLng = hits.reduce((s, p) => s + p.lng, 0) / hits.length;

    const icon = L.divIcon({
        className: '',
        html: `<div class="intersection-marker"></div>`,
        iconSize: [24, 24], iconAnchor: [12, 12]
    });

    mo.intersectionLatLng = { lat: avgLat, lng: avgLng };

    mo.intersectionMarker = L.marker([avgLat, avgLng], { icon })
        .bindPopup(`<b>📍 Estimated origin</b><br>${avgLat.toFixed(6)}, ${avgLng.toFixed(6)}`)
        .addTo(sess().layerGroup);

    mo.intersectionMarker.openPopup();
    map.setView([avgLat, avgLng], Math.max(map.getZoom(), 13));
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
