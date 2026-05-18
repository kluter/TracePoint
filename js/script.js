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
        colourIndex:      nextFreeColourIndex(),
        imgElement:       null,
        currentObjectURL: null,
        lines:            [],
        horizonPoints:    [],
        view:             { scale: 1, tx: 0, ty: 0, rotation: 0 },
        mapView:          null,
        layerGroup,
        mapObjects:       { rays: [], geoMarkers: [], intersectionMarker: null, intersectionLatLng: null },
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
        const dot = document.createElement('span');
        dot.className = 'session-dot';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'session-name';
        nameSpan.textContent = s.name;
        item.appendChild(dot);
        item.appendChild(nameSpan);
        if (s.imgElement) {
            item.insertAdjacentHTML('beforeend',
                `<button class="btn-session-export" title="Export session"
                     onclick="event.stopPropagation(); exportSession(${idx})">
                     <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <line x1="5" y1="1" x2="5" y2="8"/><polyline points="2,5.5 5,8.5 8,5.5"/>
                     </svg></button>`);
        }
        item.insertAdjacentHTML('beforeend',
            `<button class="btn-delete" title="Remove image"
                 onclick="event.stopPropagation(); removeSession(${idx})">×</button>`);
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
function updateDropOverlay() {
    const s = sess();
    if (s.pendingImageFilename) {
        overlay.innerHTML =
            `<span class="drop-restored-title">Session restored</span>` +
            `<span class="drop-restore">reload <strong>${s.pendingImageFilename}</strong> to continue</span>` +
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
            ? `<button class="exif-gps-btn" onclick="goToExifGps()">${crosshair}Show on map</button>`
            : '';
        card.innerHTML =
            '<div class="exif-card-header">Image metadata</div>' +
            '<table class="exif-table">' +
            rows.map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`).join('') +
            '</table>' + gpsBtn;
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
        s.layerGroup.removeLayer(s.exifGpsMarker);
        s.exifGpsMarker = null;
    }

    const icon = L.divIcon({
        className: '',
        html: '<div class="exif-gps-marker"></div>',
        iconSize:   [20, 20],
        iconAnchor: [10, 10]
    });

    s.exifGpsMarker = L.marker([lat, lng], { icon })
        .bindPopup(`<b>EXIF GPS</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        .addTo(s.layerGroup);

    s.exifGpsMarker.openPopup();
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
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
   ============================================================ */
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
            ? { center: { lat: s.mapView.center.lat, lng: s.mapView.center.lng }, zoom: s.mapView.zoom }
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
    if (idx === activeSessionIndex) s.mapView = { center: map.getCenter(), zoom: map.getZoom() };
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    downloadJSON(
        { json_version: 1, exported: new Date().toISOString(), sessions: [sessionToData(s)] },
        `tracepoint_${s.name}_${ts}.json`
    );
};

function exportAllSessions() {
    if (sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].mapView = { center: map.getCenter(), zoom: map.getZoom() };
    }
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    downloadJSON(
        { json_version: 1, exported: new Date().toISOString(),
          sessions: sessions.filter(s => s.imgElement).map(sessionToData) },
        `tracepoint_all_${ts}.json`
    );
}

function importSessions(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const list = data.sessions;
            if (!Array.isArray(list) || list.length === 0) return alert('No sessions found in file.');

            list.forEach(sd => {
                // Reuse the current session slot if it's completely empty
                const cur = sess();
                let s;
                if (!cur.imgElement && cur.lines.length === 0) {
                    s = cur;
                    s.name = sd.name;
                } else {
                    s = createSession(sd.name);
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
                        points: (l.points || [])
                            .filter(pt => pt && typeof pt.y === 'number')
                            .map(pt => ({ y: pt.y, geo: pt.geo || null }))
                    }));
                if (sd.view) Object.assign(s.view, sd.view);

                // Switch first — switchToSession saves the outgoing session's live map
                // position; setting s.mapView before the call would get overwritten when
                // s === sessions[activeSessionIndex] (reused empty slot case).
                switchToSession(sessions.indexOf(s));

                // Restore imported mapView after the switch so it can't be clobbered
                if (sd.mapView) {
                    s.mapView = sd.mapView;
                    map.setView(sd.mapView.center, sd.mapView.zoom);
                }

                s.lines.forEach((_, lIdx) => rebuildMapForLine(lIdx));
                recomputeIntersection();
                if (sd.mapView) map.setZoom(sd.mapView.zoom);
                updateUI();
            });

            renderSessionMenu();
        } catch (err) {
            alert('Invalid TracePoint session file.');
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

    let needsRerender = false;

    s.lines.forEach((line, idx) => {
        const active    = idx === state.activeLineIndex;
        const colour    = lineColour(idx, activeSessionIndex);
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
            ctx.font        = 'bold 11px monospace';
            ctx.fillStyle   = '#fff';
            ctx.fillText(`P${pIdx + 1}`, line.x + 10, pt.y + 4);
            ctx.globalAlpha = alpha;
        });

        ctx.globalAlpha = 1;
    });

    if (needsRerender) requestAnimationFrame(render);

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

    const avgLat = hits.reduce((acc, p) => acc + p.lat, 0) / hits.length;
    const avgLng = hits.reduce((acc, p) => acc + p.lng, 0) / hits.length;

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
