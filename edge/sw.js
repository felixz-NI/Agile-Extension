// MV3 service worker entry point.
// Service workers can't use a "scripts" array like an MV2 background page,
// so we load the shim + libraries + background logic via importScripts.
// NOTE: importScripts is synchronous and runs in declaration order.
// (STEP/IGES tessellation does NOT run here — occt-import-js uses new Function(),
// which MV3 forbids in the service worker; it runs in occt-sandbox.html instead.)
importScripts('browser-shim.js', 'jszip.min.js', 'mammoth.browser.min.js', 'background.js');
