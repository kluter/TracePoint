const canvas = document.getElementById("image-canvas");
const ctx = canvas.getContext("2d");

const container = document.getElementById("image-container");
const overlay = document.getElementById("drop-overlay");

/* -----------------------------
   DRAG & DROP HANDLING
------------------------------*/

// Prevent browser default behavior
window.addEventListener("dragover", (e) => {
    e.preventDefault();
});

window.addEventListener("drop", (e) => {
    e.preventDefault();
});

// Visual feedback when dragging over panel
container.addEventListener("dragover", (e) => {
    e.preventDefault();
    container.style.background = "#222";
});

container.addEventListener("dragleave", () => {
    container.style.background = "#111";
});

// Handle file drop
container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.style.background = "#111";

    const file = e.dataTransfer.files[0];

    if (!file || !file.type.startsWith("image/")) {
        alert("Please drop an image file");
        return;
    }

    loadImage(file);
});

/* -----------------------------
   IMAGE LOADING
------------------------------*/

function loadImage(file) {
    const img = new Image();

    img.onload = () => {

        // 1. Set internal pixel space
        canvas.width = img.width;
        canvas.height = img.height;

        // 2. Draw image
        ctx.drawImage(img, 0, 0);

        // 3. Ensure canvas behaves like a block element
        canvas.style.display = "block";

        // 4. Hide overlay
        overlay.style.display = "none";
    };

    img.src = URL.createObjectURL(file);
}