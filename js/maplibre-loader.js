/* MapLibre GL JS 6 ships as an ES module only. This loads it and hands it to script.js as the global
   `maplibregl`, as the old script build did. Module scripts run after the page is parsed, in page
   order with deferred scripts, so script.js (defer, further down) always finds it. A file rather than
   an inline script, because the Content-Security-Policy allows scripts from this site only.
   maplibre-gl.mjs loads its worker, maplibre-gl-worker.mjs, from the same folder by itself. */
import * as maplibregl from './maplibre-gl.mjs';
window.maplibregl = maplibregl;
