/* ============================================================
   TracePoint – script.js
   ============================================================ */

const canvas      = document.getElementById("image-canvas");
const ctx         = canvas.getContext("2d");
const container   = document.getElementById("image-container");
const overlay     = document.getElementById("drop-overlay");
const btnAddLine  = document.getElementById("btn-add-line");
const btnModeToggle = document.getElementById("btn-mode-toggle");
const toolbar     = document.getElementById("toolbar");

/* ---- STATE ---- */
const state = {
    mode: 'idle',          // 'idle' | 'drag-line' | 'add-point' | 'map-point'
    lines: [],
    activeLineIndex: -1,
    mapPointTarget: null,  // { lineIndex, pointIndex } – which photo point we're placing on map
    isDragging: false
};
let imgElement       = null;
let currentObjectURL = null;

/* ---- ZOOM / PAN STATE ---- */
const view = { scale: 1, tx: 0, ty: 0 };
let isPanning = false, panStart = { x: 0, y: 0 }, panOrigin = { tx: 0, ty: 0 };
const MIN_SCALE = 0.1, MAX_SCALE = 20;

function applyTransform() {
    canvas.style.transform       = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    canvas.style.transformOrigin = '0 0';
}

/* Convert a mouse event's client coords → image-space coords */
function clientToImage(e) {
    const rect = container.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left - view.tx) / view.scale,
        y: (e.clientY - rect.top  - view.ty) / view.scale
    };
}

/* ---- MAP LAYERS ---- */
const map = L.map('map-container', { maxZoom: 21 }).setView([20, 0], 2);

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
    // Persist choice
    localStorage.setItem('tp-tileset', id);
}

// Init with saved or default
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

        // Mark current
        const savedId = localStorage.getItem('tp-tileset') || 'esri-sat';
        menu.querySelector(`[data-id="${savedId}"]`)?.classList.add('active');

        btn.onclick = () => {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        // Close menu when clicking elsewhere on map
        map.on('click', () => { menu.style.display = 'none'; });

        return wrap;
    }
});
new LayerSwitcher().addTo(map);

/* ---- MAP OBJECTS (rays, markers, intersection) ---- */
// Each line can have: mapMarkers[], rayPolyline
// Intersection marker lives separately
const mapObjects = { rays: [], geoMarkers: [], intersectionMarker: null };

/* ============================================================
   COLOUR PALETTE – one colour per line index
   ============================================================ */
const LINE_COLOURS = [
    '#00aaff', '#ff6b35', '#7fff6b', '#ff35c8',
    '#ffe135', '#35ffe1', '#b535ff', '#ff3535'
];
function lineColour(idx) { return LINE_COLOURS[idx % LINE_COLOURS.length]; }

/* ============================================================
   UI HELPERS
   ============================================================ */
function updateUI() {
    // Mode toggle button
    if (state.activeLineIndex !== -1) {
        btnModeToggle.disabled = false;
        if (state.mode === 'drag-line')  { btnModeToggle.textContent = 'Mode: Drag Line'; btnModeToggle.className = ''; }
        if (state.mode === 'add-point')  { btnModeToggle.textContent = 'Mode: Add Point'; btnModeToggle.className = 'active-mode'; }
        if (state.mode === 'map-point')  { btnModeToggle.textContent = 'Mode: Map Point'; btnModeToggle.className = 'active-mode map-mode'; }
    } else {
        btnModeToggle.disabled = true;
        btnModeToggle.textContent = 'Mode: Idle';
        btnModeToggle.className = '';
    }

    // Map cursor
    map.getContainer().style.cursor = (state.mode === 'map-point') ? 'crosshair' : '';

    updateLineManager();
}

function updateLineManager() {
    toolbar.querySelectorAll('.line-item, .point-manager, .map-hint').forEach(el => el.remove());

    state.lines.forEach((line, lIdx) => {
        const colour = lineColour(lIdx);
        const active = lIdx === state.activeLineIndex;

        /* Line row */
        const item = document.createElement('div');
        item.className = 'line-item' + (active ? ' active-line' : '');
        item.style.setProperty('--lc', colour);
        item.innerHTML =
            `<span class="line-dot"></span>` +
            `<span class="line-label">L${lIdx + 1}</span>` +
            `<button class="btn-delete" title="Delete line"
                onclick="event.stopPropagation(); deleteLine(${lIdx})">×</button>`;
        item.onclick = () => {
            state.activeLineIndex = lIdx;
            if (state.mode === 'map-point') state.mode = 'drag-line';
            render(); updateUI();
        };
        toolbar.appendChild(item);

        /* Points sub-row (only for active line) */
        if (active && line.points.length > 0) {
            const ptBox = document.createElement('div');
            ptBox.className = 'point-manager';

            line.points.forEach((pt, pIdx) => {
                const hasGeo = !!(pt.geo);
                const ptItem = document.createElement('div');
                ptItem.className = 'point-item' + (hasGeo ? ' has-geo' : '');

                // Is this the point currently being placed on map?
                const isTarget = state.mode === 'map-point'
                    && state.mapPointTarget
                    && state.mapPointTarget.lineIndex === lIdx
                    && state.mapPointTarget.pointIndex === pIdx;

                ptItem.innerHTML =
                    `<span class="pt-label">P${pIdx + 1}</span>` +
                    `<button class="btn-geo ${isTarget ? 'geo-active' : ''}" title="${hasGeo ? 'Re-place on map' : 'Place on map'}"
                        onclick="event.stopPropagation(); startMapPoint(${lIdx},${pIdx})">
                        ${hasGeo ? '📍' : '🗺'}
                    </button>` +
                    `<button class="btn-delete" onclick="event.stopPropagation(); deletePoint(${lIdx},${pIdx})">×</button>`;
                ptBox.appendChild(ptItem);
            });

            toolbar.appendChild(ptBox);
        }
    });

    /* Hint when in map-point mode */
    if (state.mode === 'map-point' && state.mapPointTarget) {
        const { lineIndex, pointIndex } = state.mapPointTarget;
        const hint = document.createElement('div');
        hint.className = 'map-hint';
        hint.textContent = `Click map → L${lineIndex + 1} P${pointIndex + 1}`;
        toolbar.appendChild(hint);
    }
}

/* ============================================================
   LINE / POINT LOGIC
   ============================================================ */
window.deleteLine = (idx) => {
    // Remove map objects for this line
    clearMapObjectsForLine(idx);
    state.lines.splice(idx, 1);
    state.activeLineIndex = Math.min(state.activeLineIndex, state.lines.length - 1);
    if (state.lines.length === 0) { state.activeLineIndex = -1; state.mode = 'idle'; }
    recomputeIntersection();
    render(); updateUI();
};

window.deletePoint = (lIdx, pIdx) => {
    state.lines[lIdx].points.splice(pIdx, 1);
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
    if (!imgElement) return alert("Drop an image first.");
    state.lines.push({ x: canvas.width / 2, points: [] });
    state.activeLineIndex = state.lines.length - 1;
    state.mode = 'drag-line';
    render(); updateUI();
};

btnModeToggle.onclick = () => {
    if (state.mode === 'map-point') { state.mode = 'drag-line'; state.mapPointTarget = null; }
    else state.mode = (state.mode === 'drag-line') ? 'add-point' : 'drag-line';
    updateUI();
};

/* ESC to deselect / cancel */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (state.mode === 'map-point') {
            state.mode = 'drag-line';
            state.mapPointTarget = null;
        } else {
            state.activeLineIndex = -1;
            state.mode = 'idle';
        }
        render(); updateUI();
    }
});

/* ============================================================
   IMAGE HANDLING
   ============================================================ */
function loadImage(file) {
    if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = URL.createObjectURL(file);
    imgElement = new Image();
    imgElement.onload = () => {
        canvas.width  = imgElement.width;
        canvas.height = imgElement.height;
        canvas.style.display = 'block';
        overlay.style.display = 'none';
        // Fit image to container on load
        const cr = container.getBoundingClientRect();
        view.scale = Math.min(cr.width / imgElement.width, cr.height / imgElement.height, 1);
        view.tx = (cr.width  - imgElement.width  * view.scale) / 2;
        view.ty = (cr.height - imgElement.height * view.scale) / 2;
        applyTransform();
        render();
    };
    imgElement.src = currentObjectURL;
}

container.addEventListener('dragover',  (e) => { e.preventDefault(); container.classList.add('drag-active'); });
container.addEventListener('dragleave', ()  => container.classList.remove('drag-active'));
container.addEventListener('drop', (e) => {
    e.preventDefault(); container.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
});

/* ============================================================
   ZOOM  (wheel on container)
   ============================================================ */
container.addEventListener('wheel', (e) => {
    if (!imgElement) return;
    e.preventDefault();
    const rect   = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    view.tx = mouseX - (mouseX - view.tx) * (newScale / view.scale);
    view.ty = mouseY - (mouseY - view.ty) * (newScale / view.scale);
    view.scale = newScale;
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
        panOrigin = { tx: view.tx, ty: view.ty };
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
        view.tx = panOrigin.tx + (e.clientX - panStart.x);
        view.ty = panOrigin.ty + (e.clientY - panStart.y);
        applyTransform();
    }
    if (state.isDragging && state.activeLineIndex !== -1) {
        state.lines[state.activeLineIndex].x = clientToImage(e).x;
        render();
    }
});

/* ============================================================
   CANVAS DRAWING
   ============================================================ */
function render() {
    if (!imgElement) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);

    state.lines.forEach((line, idx) => {
        const active  = idx === state.activeLineIndex;
        const colour  = lineColour(idx);
        const alpha   = active ? 1.0 : 0.5;

        ctx.globalAlpha = alpha;

        /* Vertical line */
        ctx.beginPath();
        ctx.moveTo(line.x, 0);
        ctx.lineTo(line.x, canvas.height);
        ctx.strokeStyle = colour;
        ctx.lineWidth   = active ? 2.5 : 1.5;
        ctx.setLineDash(active ? [] : [6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        /* Points */
        line.points.forEach((pt, pIdx) => {
            const hasGeo = !!(pt.geo);

            // Tick mark across the line
            ctx.beginPath();
            ctx.moveTo(line.x - 8, pt.y);
            ctx.lineTo(line.x + 8, pt.y);
            ctx.strokeStyle = colour;
            ctx.lineWidth   = 2;
            ctx.stroke();

            // Circle
            ctx.beginPath();
            ctx.arc(line.x, pt.y, 6, 0, Math.PI * 2);
            ctx.fillStyle   = hasGeo ? colour : '#0a0a0a';
            ctx.strokeStyle = colour;
            ctx.lineWidth   = 2;
            ctx.fill();
            ctx.stroke();

            // Label
            ctx.globalAlpha = 1;
            ctx.font        = 'bold 11px monospace';
            ctx.fillStyle   = '#fff';
            ctx.fillText(`P${pIdx + 1}`, line.x + 10, pt.y + 4);
            ctx.globalAlpha = alpha;
        });

        ctx.globalAlpha = 1;
    });
}

/* ============================================================
   CANVAS INTERACTIONS  (all coords go through clientToImage)
   ============================================================ */
canvas.addEventListener('mousedown', (e) => {
    if (isPanning || spaceDown || e.button !== 0) return;
    const { x: mx } = clientToImage(e);
    const THRESH = 12 / view.scale;

    if (state.mode === 'add-point') {
        // Clicking away from line in add-point mode → deselect
        let hit = -1;
        state.lines.forEach((line, idx) => { if (Math.abs(line.x - mx) < THRESH) hit = idx; });
        if (hit === -1) { state.activeLineIndex = -1; state.mode = 'idle'; render(); updateUI(); }
        return;
    }

    // idle or drag-line
    let hit = -1;
    state.lines.forEach((line, idx) => { if (Math.abs(line.x - mx) < THRESH) hit = idx; });
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

canvas.addEventListener('click', (e) => {
    if (isPanning || spaceDown) return;
    if (state.mode !== 'add-point' || state.activeLineIndex === -1) return;
    const { x: mx, y: my } = clientToImage(e);
    const THRESH = 12 / view.scale;
    const line = state.lines[state.activeLineIndex];
    if (Math.abs(line.x - mx) > THRESH) {
        // Clicked away from line → deselect
        state.activeLineIndex = -1;
        state.mode = 'idle';
        render(); updateUI();
        return;
    }
    line.points.push({ y: my, geo: null });
    render(); updateUI();
});

/* ============================================================
   MAP INTERACTION – place geo points
   ============================================================ */
map.on('click', (e) => {
    if (state.mode !== 'map-point' || !state.mapPointTarget) return;
    const { lineIndex, pointIndex } = state.mapPointTarget;
    const line = state.lines[lineIndex];
    if (!line || !line.points[pointIndex]) return;

    // Store geo coord
    line.points[pointIndex].geo = { lat: e.latlng.lat, lng: e.latlng.lng };

    // Rebuild map visuals for this line
    rebuildMapForLine(lineIndex);
    recomputeIntersection();

    // Advance to next unplaced point automatically
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
    if (mapObjects.geoMarkers[lIdx]) {
        mapObjects.geoMarkers[lIdx].forEach(m => map.removeLayer(m));
        mapObjects.geoMarkers[lIdx] = [];
    }
    if (mapObjects.rays[lIdx]) {
        map.removeLayer(mapObjects.rays[lIdx]);
        mapObjects.rays[lIdx] = null;
    }
}

function rebuildMapForLine(lIdx) {
    clearMapObjectsForLine(lIdx);
    const line   = state.lines[lIdx];
    const colour = lineColour(lIdx);

    if (!mapObjects.geoMarkers[lIdx]) mapObjects.geoMarkers[lIdx] = [];

    // Place small circle markers for each geo point
    line.points.forEach((pt, pIdx) => {
        if (!pt.geo) return;
        const marker = L.circleMarker([pt.geo.lat, pt.geo.lng], {
            radius: 6, color: colour, fillColor: colour,
            fillOpacity: 0.9, weight: 2
        }).bindTooltip(`L${lIdx + 1} P${pIdx + 1}`, { permanent: false }).addTo(map);
        mapObjects.geoMarkers[lIdx].push(marker);
    });

    // Cast ray if we have ≥ 2 geo points
    const placed = line.points.filter(p => p.geo);
    if (placed.length < 2) return;

    // Use the first two placed points to define the bearing
    const p1 = placed[0].geo;
    const p2 = placed[1].geo;

    // Direction vector (simple flat-earth bearing is fine at photo-scene scales)
    const bearing = bearingDeg(p1, p2);

    // Extend ray 50 km in both forward and backward directions
    const RAY_KM = 50;
    const fwd    = destinationPoint(p1, bearing,       RAY_KM);
    const bwd    = destinationPoint(p1, bearing + 180, RAY_KM);

    mapObjects.rays[lIdx] = L.polyline(
        [[bwd.lat, bwd.lng], [p1.lat, p1.lng], [p2.lat, p2.lng], [fwd.lat, fwd.lng]],
        { color: colour, weight: 2, opacity: 0.85, dashArray: '6 4' }
    ).addTo(map);
}

/* ============================================================
   INTERSECTION
   ============================================================ */
function recomputeIntersection() {
    // Remove old marker
    if (mapObjects.intersectionMarker) {
        map.removeLayer(mapObjects.intersectionMarker);
        mapObjects.intersectionMarker = null;
    }

    // Collect all valid rays (need ≥ 2 geo points per line)
    const rays = [];
    state.lines.forEach((line) => {
        const placed = line.points.filter(p => p.geo);
        if (placed.length < 2) return;
        rays.push({ p1: placed[0].geo, p2: placed[1].geo });
    });

    if (rays.length < 2) return;

    // Intersect all pairs, collect results, average them
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

    // Pulsing intersection marker
    const icon = L.divIcon({
        className: '',
        html: `<div class="intersection-marker"></div>`,
        iconSize: [24, 24], iconAnchor: [12, 12]
    });

    mapObjects.intersectionMarker = L.marker([avgLat, avgLng], { icon })
        .bindPopup(`<b>📍 Estimated origin</b><br>${avgLat.toFixed(6)}, ${avgLng.toFixed(6)}`)
        .addTo(map);

    mapObjects.intersectionMarker.openPopup();
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
