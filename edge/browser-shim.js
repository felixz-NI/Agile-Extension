// Cross-browser shim: Chrome exposes the WebExtension APIs as `chrome`,
// while this codebase was written against Firefox's promise-based `browser`.
// Chrome (MV3) already returns promises from runtime.sendMessage, so a thin
// alias is enough. Runs in both the service worker (via importScripts) and
// content scripts (declared first in manifest).
(function () {
  if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
    globalThis.browser = globalThis.chrome;
  }
})();
