const canvas = document.getElementById("image-canvas");
const ctx = canvas.getContext("2d");
const container = document.getElementById("image-container");
const overlay = document.getElementById("drop-overlay");
const btnAddLine = document.getElementById("btn-add-line");
const btnModeToggle = document.getElementById("btn-mode-toggle");
const toolbar = document.getElementById("toolbar");

const state = {
    mode: 'idle', 
    lines: [],
    activeLineIndex: -1,
    isDragging: false
};
let imgElement = null;
let currentObjectURL = null;


/* --- MAP SETUP --- */
const map = L.map('map-container').setView([20, 0], 2);

// 1. The base satellite imagery (Keep at 1.0 opacity)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
}).addTo(map);

// 2. The Boundaries and Places (Set to 0.5 for 50% transparency)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Labels &copy; Esri',
    opacity: 0.7 
}).addTo(map);

// 3. The Roads/Transportation (Set to 0.5 for 50% transparency)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Roads &copy; Esri',
    opacity: 0.7
}).addTo(map);


/* --- UI HELPERS --- */
function updateUI() {
    if (state.activeLineIndex !== -1) {
        btnModeToggle.disabled = false;
        btnModeToggle.textContent = state.mode === 'drag-line' ? "Mode: Drag Line" : "Mode: Lock Point";
        btnModeToggle.className = state.mode === 'add-point' ? 'active-mode' : '';
    }
    updateLineManager();
}

function updateLineManager() {
    const items = toolbar.querySelectorAll('.line-item, .point-manager');
    items.forEach(el => el.remove());

    state.lines.forEach((line, lIdx) => {
        const item = document.createElement('div');
        item.className = 'line-item';
        if(lIdx === state.activeLineIndex) item.style.borderColor = '#00aaff';
        item.innerHTML = `<span>L${lIdx+1}</span><button class="btn-delete" onclick="event.stopPropagation(); deleteLine(${lIdx})">×</button>`;
        item.onclick = () => { state.activeLineIndex = lIdx; render(); updateUI(); };
        toolbar.appendChild(item);

        if (lIdx === state.activeLineIndex && line.points.length > 0) {
            const ptBox = document.createElement('div');
            ptBox.className = 'point-manager';
            line.points.forEach((pt, pIdx) => {
                const ptItem = document.createElement('div');
                ptItem.className = 'point-item';
                ptItem.innerHTML = `P${pIdx+1} <button class="btn-delete" onclick="event.stopPropagation(); deletePoint(${lIdx}, ${pIdx})">×</button>`;
                ptBox.appendChild(ptItem);
            });
            toolbar.appendChild(ptBox);
        }
    });
}

/* --- LOGIC --- */
window.deleteLine = (idx) => {
    state.lines.splice(idx, 1);
    state.activeLineIndex = state.lines.length - 1;
    if (state.activeLineIndex === -1) state.mode = 'idle';
    render(); updateUI();
};

window.deletePoint = (lIdx, pIdx) => {
    state.lines[lIdx].points.splice(pIdx, 1);
    render(); updateUI();
};

btnAddLine.onclick = () => {
    if (!imgElement) return alert("Drop an image first");
    state.lines.push({ x: canvas.width / 2, points: [] });
    state.activeLineIndex = state.lines.length - 1;
    state.mode = 'drag-line';
    render(); updateUI();
};

btnModeToggle.onclick = () => {
    state.mode = state.mode === 'drag-line' ? 'add-point' : 'drag-line';
    updateUI();
};

/* --- IMAGE HANDLING --- */
function loadImage(file) {
    if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = URL.createObjectURL(file);
    imgElement = new Image();
    imgElement.onload = () => {
        canvas.width = imgElement.width; canvas.height = imgElement.height;
        canvas.style.display = "block"; overlay.style.display = "none";
        render();
    };
    imgElement.src = currentObjectURL;
}

container.addEventListener("dragover", (e) => { e.preventDefault(); container.classList.add("drag-active"); });
container.addEventListener("dragleave", () => container.classList.remove("drag-active"));
container.addEventListener("drop", (e) => {
    e.preventDefault(); container.classList.remove("drag-active");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadImage(file);
});

/* --- DRAWING --- */
function render() {
    if (!imgElement) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);
    state.lines.forEach((line, idx) => {
        const active = idx === state.activeLineIndex;
        ctx.beginPath();
        ctx.moveTo(line.x, 0); ctx.lineTo(line.x, canvas.height);
        ctx.strokeStyle = active ? "#00aaff" : "#ff4444";
        ctx.lineWidth = active ? 3 : 1;
        ctx.stroke();
        line.points.forEach(pt => {
            ctx.beginPath(); ctx.arc(line.x, pt.y, 6, 0, Math.PI*2);
            ctx.fillStyle = "#fff"; ctx.fill();
            ctx.strokeStyle = active ? "#00aaff" : "#ff4444"; ctx.stroke();
        });
    });
}

canvas.onmousedown = () => { if(state.mode === 'drag-line') state.isDragging = true; };
window.onmouseup = () => state.isDragging = false;
canvas.onmousemove = (e) => {
    if (state.isDragging && state.activeLineIndex !== -1) {
        const rect = canvas.getBoundingClientRect();
        state.lines[state.activeLineIndex].x = (e.clientX - rect.left) * (canvas.width / rect.width);
        render();
    }
};
canvas.onclick = (e) => {
    if (state.mode === 'add-point' && state.activeLineIndex !== -1) {
        const rect = canvas.getBoundingClientRect();
        state.lines[state.activeLineIndex].points.push({ y: (e.clientY - rect.top) * (canvas.height / rect.height) });
        render(); updateUI();
    }
};