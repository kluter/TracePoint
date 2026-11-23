/* MapLibre GL JS 6 ships as an ES module only. This loads it and hands it to script.js as the global
   `maplibregl`, as the old script build did. Module scripts run after the page is parsed, in page
   order with deferred scripts, so script.js (defer, further down) always finds it. A file rather than
   an inline script, because the Content-Security-Policy allows scripts from this site only.
   The release names its files .mjs; here they end in .js, because a browser refuses a module that a
   server does not label as JavaScript, and not every simple server knows .mjs. MapLibre would look
   for its worker under the .mjs name, so it is told the worker file explicitly. */
import * as maplibregl from './maplibre-gl.js';
maplibregl.setWorkerUrl(new URL('./maplibre-gl-worker.js', import.meta.url).href);
window.maplibregl = maplibregl;
