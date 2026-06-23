// content-main.js — Runs on top-level agile.natinst.com pages at document_idle.
// Adds Preview buttons next to PDF/DOCX links, opens a sidebar panel,
// and submits the form to an iframe where content-iframe.js handles the rest.

(function () {
    'use strict';

    const DEBUG = true;
    function log(...args) {
        if (DEBUG) console.log('[Preview Pane]', ...args);
    }

    const PREVIEW_FLAG = '__preview_pane_active';
    const PREVIEW_FLAG_FALLBACK_CLEAR_MS = 15000;
    const BRIDGE_ATTR = 'data-preview-bridge-id';
    let bridgeCounter = 0;

    log('Script loaded on:', window.location.href);

    // --- Styles ---
    const style = document.createElement('style');
    style.textContent = `
        .preview-btn {
            display: inline-flex;
            align-items: center;
            margin-left: 6px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            color: #fff;
            background: #566873;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            vertical-align: middle;
            text-decoration: none;
        }
        .preview-btn:hover {
            background: #455560;
        }
        .partnum-copy-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: 8px;
            padding: 3px;
            background: transparent;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            vertical-align: middle;
            color: #566873;
            line-height: 0;
            opacity: 0.75;
            transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
        }
        .partnum-copy-btn:hover {
            opacity: 1;
            background: rgba(86, 104, 115, 0.12);
        }
        .partnum-copy-btn:active {
            background: rgba(86, 104, 115, 0.22);
        }
        .partnum-copy-btn svg {
            width: 18px;
            height: 18px;
            display: block;
        }
        .partnum-copy-btn.copied {
            color: #2e7d32;
            opacity: 1;
        }
        .partnum-echo-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 6px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #14334d;
            background: #86B5D9;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            vertical-align: middle;
            text-decoration: none;
            line-height: 1.4;
        }
        .partnum-echo-btn:hover {
            background: #6fa3cd;
        }
        .partnum-echo-btn[disabled] {
            opacity: 0.6;
            cursor: default;
        }
        .partnum-echo-btn.not-found {
            background: #9e9e9e;
            cursor: default;
        }
        .partnum-mvdb-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 6px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #2f4029;
            background: #CDDCC8;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            vertical-align: middle;
            text-decoration: none;
            line-height: 1.4;
        }
        .partnum-mvdb-btn:hover {
            background: #bccdb6;
        }
        .partnum-bluenite-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 6px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            background: #2C699F;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            vertical-align: middle;
            text-decoration: none;
            line-height: 1.4;
        }
        .partnum-bluenite-btn:hover {
            background: #23547f;
        }
        .partnum-azure-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 6px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            background: #0078D4;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            vertical-align: middle;
            text-decoration: none;
            line-height: 1.4;
        }
        .partnum-azure-btn:hover {
            background: #106ebe;
        }
        .p4-open-btn {
            display: inline-block;
            margin-top: 0;
            margin-left: 6px;
            color: #fff;
            background: #03A378;
        }
        .p4-open-btn:hover {
            background: #028a66;
        }
        .p4v-open-btn {
            display: inline-block;
            margin-top: 0;
            margin-left: 0;
            color: #fff;
            background: #00BCF2;
        }
        .p4v-open-btn:hover {
            background: #00a3d1;
        }
        .ref-pdf-btn {
            position: fixed;
            right: 18px;
            top: 14px;
            z-index: 1000001;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 9px;
            font-size: 11px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            background: #566873;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            box-shadow: 0 1px 5px rgba(0,0,0,0.22);
            transition: background 0.15s ease, transform 0.1s ease;
            white-space: nowrap;
        }
        .ref-pdf-btn:hover {
            background: #455560;
        }
        .ref-pdf-btn:active {
            transform: translateY(1px);
        }
        .ref-pdf-btn svg {
            width: 13px;
            height: 13px;
            display: block;
        }
        /* Hide the Fireman Manual button while a preview panel is open */
        body:has(.preview-panel) .ref-pdf-btn {
            display: none !important;
        }
        .preview-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.3);
            z-index: 999999;
        }
        .preview-panel {
            position: fixed;
            top: 0;
            right: 0;
            width: 45vw;
            min-width: 400px;
            height: 100vh;
            background: #fff;
            box-shadow: -4px 0 24px rgba(0,0,0,0.2);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 1000000;
            animation: slideInRight 0.2s ease-out;
        }
        .preview-resize-handle {
            position: absolute;
            left: 0;
            top: 0;
            width: 8px;
            height: 100%;
            cursor: ew-resize;
            z-index: 2;
            touch-action: none;
            background: linear-gradient(to right, rgba(86, 104, 115, 0.15), rgba(86, 104, 115, 0));
        }
        .preview-resize-handle:hover {
            background: linear-gradient(to right, rgba(86, 104, 115, 0.25), rgba(86, 104, 115, 0));
        }
        body.preview-resizing,
        body.preview-resizing * {
            cursor: ew-resize !important;
            user-select: none !important;
        }
        @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
        }
        .preview-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: #f3f3f3;
            border-bottom: 1px solid #ddd;
            flex-shrink: 0;
        }
        .preview-header-title {
            font-size: 14px;
            font-weight: 600;
            color: #333;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 60%;
        }
        .preview-header-actions {
            display: flex;
            gap: 8px;
        }
        .preview-header-actions button {
            padding: 6px 14px;
            font-size: 12px;
            border-radius: 4px;
            border: 1px solid #ccc;
            cursor: pointer;
            background: #fff;
        }
        .preview-header-actions button:hover {
            background: #e8e8e8;
        }
        .preview-header-actions .download-btn {
            background: #566873;
            color: #fff;
            border-color: #566873;
        }
        .preview-header-actions .download-btn:hover {
            background: #455560;
        }
        .preview-header-actions .pin-btn.pinned {
            background: #566873;
            color: #fff;
            border-color: #566873;
        }
        .preview-body {
            flex: 1;
            overflow: auto;
            padding: 0;
        }
        .preview-body iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
        .preview-signin-note {
            flex-shrink: 0;
            display: none;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #fff8e1;
            border-top: 1px solid #ffe082;
            font-size: 12px;
            color: #5d4037;
        }
        .preview-signin-note.is-visible {
            display: flex;
        }
        .preview-signin-text {
            flex: 1;
            min-width: 0;
        }
        .preview-signin-btn {
            flex-shrink: 0;
            padding: 5px 10px;
            font-size: 12px;
            font-weight: 600;
            color: #fff;
            background: #566873;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            white-space: nowrap;
        }
        .preview-signin-btn:hover {
            background: #455560;
        }
        .preview-signin-btn--ghost {
            background: #fff;
            color: #566873;
            border: 1px solid #b0bec5;
        }
        .preview-signin-btn--ghost:hover {
            background: #eceff1;
        }
        .preview-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            font-size: 16px;
            color: #666;
        }
        .preview-iframe-wrap {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
        }
        .preview-iframe-loader {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 14px;
            background: #fff;
            z-index: 3;
            font-size: 14px;
            color: #566873;
        }
        .preview-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(86, 104, 115, 0.2);
            border-top-color: #566873;
            border-radius: 50%;
            animation: preview-spin 0.8s linear infinite;
        }
        @keyframes preview-spin {
            to { transform: rotate(360deg); }
        }
        .preview-error {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            font-size: 14px;
            color: #c00;
            padding: 20px;
            text-align: center;
        }
    `;
    document.head.appendChild(style);

    // --- Button visibility settings (controlled from the toolbar popup) ---
    // The popup writes a settings object to storage.local; each key
    // enables/disables one injected button. We translate disabled buttons into
    // CSS that hides them, so we don't have to touch every injection site. The
    // rules update live when the user toggles a switch in the popup.
    const storageApi = (typeof browser !== 'undefined' && browser.storage)
        ? browser
        : ((typeof chrome !== 'undefined' && chrome.storage) ? chrome : null);
    const BTN_SETTINGS_KEY = 'previewButtonSettings';
    // Maps a setting key to the CSS selector(s) to hide when it is disabled.
    // ECHO shares .partnum-echo-btn with p4v/P4 Browser, so exclude those.
    const BTN_SELECTORS = {
        showCopy:      '.partnum-copy-btn',
        showEcho:      '.partnum-echo-btn:not(.p4v-open-btn):not(.p4-open-btn)',
        showMvdb:      '.partnum-mvdb-btn',
        showBlueNITE:  '.partnum-bluenite-btn',
        showAzure:     '.partnum-azure-btn',
        showP4v:       '.p4v-open-btn',
        showP4Browser: '.p4-open-btn',
        showFireman:   '.ref-pdf-btn'
    };

    const settingsStyle = document.createElement('style');
    settingsStyle.id = 'preview-button-settings';
    document.head.appendChild(settingsStyle);

    function applyButtonSettings(settings) {
        const s = settings || {};
        const hidden = [];
        Object.keys(BTN_SELECTORS).forEach((key) => {
            // Default is enabled; only an explicit `false` hides the button.
            if (s[key] === false) hidden.push(BTN_SELECTORS[key]);
        });
        settingsStyle.textContent = hidden.length
            ? hidden.join(',\n') + ' { display: none !important; }'
            : '';
    }

    if (storageApi) {
        storageApi.storage.local.get(BTN_SETTINGS_KEY).then((res) => {
            applyButtonSettings(res && res[BTN_SETTINGS_KEY]);
        }).catch(() => { /* storage unavailable; show all buttons */ });

        if (storageApi.storage.onChanged) {
            storageApi.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes[BTN_SETTINGS_KEY]) {
                    applyButtonSettings(changes[BTN_SETTINGS_KEY].newValue);
                }
            });
        }
    }

    // --- Helpers ---
    function getFileExtFromName(fileName) {
        const name = fileName.toLowerCase().trim();
        if (name.endsWith('.pdf')) return 'pdf';
        if (name.endsWith('.docx')) return 'docx';
        if (name.endsWith('.doc')) return 'doc';
        if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
        if (name.endsWith('.txt')) return 'txt';
        if (name.endsWith('.json')) return 'json';
        if (name.endsWith('.xml')) return 'xml';
        if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
        if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image';
        if (name.endsWith('.png')) return 'image';
        if (name.endsWith('.xlsm') || name.endsWith('.xlsx')) return 'xlsm';
        if (name.endsWith('.pptx')) return 'pptx';
        if (name.endsWith('.ppt')) return 'ppt';
        if (name.endsWith('.zip')) return 'zip';
        if (name.endsWith('.stl')) return 'stl';
        if (name.endsWith('.gbx')) return 'gbx';
        return null;
    }

    function parseOpenFileParams(onclickStr) {
        const match = onclickStr.match(/openFile\s*\(([\s\S]*)\)/);
        if (!match) return null;

        const argsStr = match[1];
        const args = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < argsStr.length; i++) {
            const ch = argsStr[i];
            if (inQuote) {
                if (ch === quoteChar) {
                    inQuote = false;
                    args.push(current);
                    current = '';
                } else {
                    current += ch;
                }
            } else if (ch === "'" || ch === '"') {
                inQuote = true;
                quoteChar = ch;
                current = '';
            } else if (ch === ',') {
                if (current.trim() !== '') {
                    args.push(current.trim());
                    current = '';
                } else {
                    current = '';
                }
            } else {
                current += ch;
            }
        }
        if (current.trim()) args.push(current.trim());

        const fileName = args[6] || null;
        return { args, fileName, classId: args[1], objId: args[2], fileId: args[5] };
    }

    // --- Page-context bridge (MAIN-world hooks live in page-hooks.js) ---
    // Chrome blocks inline-script injection and eval via the page CSP, so the
    // openFile hooks run in the MAIN world (page-hooks.js). Here we just send
    // commands and receive results over document-level CustomEvents.
    function sendPageCmd(msg) {
        document.dispatchEvent(new CustomEvent('__pp_cmd', { detail: JSON.stringify(msg) }));
    }

    function ensureBridgeId(link) {
        if (!link) return null;
        let id = link.getAttribute(BRIDGE_ATTR);
        if (!id) {
            bridgeCounter += 1;
            id = 'pp_' + Date.now() + '_' + bridgeCounter;
            link.setAttribute(BRIDGE_ATTR, id);
        }
        return id;
    }

    // Extract the page function name + parsed argument list from a link's
    // onclick (e.g. openFile('a','b',...)), so the MAIN world can call it
    // directly without eval.
    // parseOpenFileParams returns EVERY argument as a string, but openFile's
    // trailing flags are real booleans (..., ' ', false, false, false). Sending
    // the string "false" (which is truthy) makes the MAIN-world openFile build a
    // different request than the page's own onclick would, which Agile rejects
    // with "Application Error" for some attachments (notably ECO affected-item
    // files). coerceCallArgs restores the JS literal types so the call matches.
    function coerceCallArgs(args) {
        return args.map(function (v) {
            if (v === 'true') return true;
            if (v === 'false') return false;
            if (v === 'null') return null;
            return v;
        });
    }
    function getOpenFileCall(link) {
        const onclickStr = link.getAttribute('onclick') || '';
        const parsed = parseOpenFileParams(onclickStr);
        return { fn: 'openFile', args: parsed ? coerceCallArgs(parsed.args) : [] };
    }

    // Trigger a normal download by invoking the page's openFile in the MAIN
    // world without arming a capture.
    function triggerDownload(link) {
        try {
            const linkAttrValue = ensureBridgeId(link);
            const call = getOpenFileCall(link);
            sendPageCmd({ cmd: 'invoke', fn: call.fn, args: call.args, linkAttrValue });
        } catch (err) {
            log('Download trigger error:', err);
        }
    }

    function captureFileUrl(link) {
        return new Promise((resolve) => {
            const captureId = 'cap_' + Date.now() + '_' + Math.random().toString(36).slice(2);

            const handler = (e) => {
                let data;
                try { data = JSON.parse(e.detail); } catch (_) { return; }
                if (!data || data.id !== captureId) return;
                document.removeEventListener('__pp_result', handler);
                log('Captured result:', data.result);
                resolve(data.result);
            };
            document.addEventListener('__pp_result', handler);

            const linkAttrValue = ensureBridgeId(link);
            const call = getOpenFileCall(link);
            sendPageCmd({ cmd: 'capture', id: captureId, fn: call.fn, args: call.args, linkAttrValue });

            setTimeout(() => {
                document.removeEventListener('__pp_result', handler);
                resolve(null);
            }, 4000);
        });
    }

    // --- Preview Sidebar ---
    let isPinned = false;
    // The currently open external preview's hidden "sign in" footer (if any).
    // The background script reveals it when an embedded sub-frame is blocked.
    let activeSignInNote = null;
    const PREVIEW_WIDTH_KEY = '__preview_panel_width_px';
    const PREVIEW_MIN_WIDTH = 400;

    function clampPreviewWidth(width) {
        const maxWidth = Math.max(PREVIEW_MIN_WIDTH, Math.floor(window.innerWidth * 0.85));
        const px = Math.round(width || 0);
        return Math.min(maxWidth, Math.max(PREVIEW_MIN_WIDTH, px));
    }

    function applyPanelWidth(panel, width) {
        const nextWidth = clampPreviewWidth(width);
        panel.style.width = nextWidth + 'px';
        return nextWidth;
    }

    // Reflow the underlying page so its content sits to the LEFT of the panel
    // instead of being hidden behind it.
    //
    // IMPORTANT: an earlier version set box-sizing:border-box + padding-right +
    // overflow-x:hidden (all !important) on <html>, which made Agile's layout
    // blank out to all-white. We now ONLY set margin-right on the root element.
    // Margin shrinks the root box width within the viewport without touching
    // the box-sizing model or clipping overflow, so the page reflows safely.
    function applyPageInset(px) {
        const inset = Math.max(0, Math.round(px || 0));
        const html = document.documentElement;
        if (inset > 0) {
            html.style.setProperty('margin-right', inset + 'px', 'important');
        } else {
            clearPageInset();
        }
    }

    function clearPageInset() {
        const html = document.documentElement;
        html.style.removeProperty('margin-right');
        // Defensive cleanup in case an older build left these behind.
        html.style.removeProperty('padding-right');
        html.style.removeProperty('overflow-x');
        html.style.removeProperty('box-sizing');
    }

    function getSavedPanelWidth() {
        try {
            const raw = localStorage.getItem(PREVIEW_WIDTH_KEY);
            if (!raw) return null;
            const parsed = parseInt(raw, 10);
            if (!Number.isFinite(parsed)) return null;
            return clampPreviewWidth(parsed);
        } catch (_) {
            return null;
        }
    }

    function persistPanelWidth(width) {
        try {
            localStorage.setItem(PREVIEW_WIDTH_KEY, String(clampPreviewWidth(width)));
        } catch (_) {
            // Ignore storage errors in restrictive browser/privacy modes.
        }
    }

    function enablePanelResize(panel) {
        if (!panel || panel.querySelector('.preview-resize-handle')) return;

        const handle = document.createElement('div');
        handle.className = 'preview-resize-handle';
        handle.title = 'Drag to resize preview pane';
        panel.appendChild(handle);

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        let activePointerId = null;
        let rafId = 0;
        let pendingWidth = 0;

        const flushResize = () => {
            rafId = 0;
            const applied = applyPanelWidth(panel, pendingWidth);
            // When pinned, keep the page reflowed to the left of the panel so
            // its content stays visible as the panel grows/shrinks.
            if (isPinned) applyPageInset(applied);
        };

        const onPointerMove = (e) => {
            if (!isResizing) return;
            if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
            const delta = startX - e.clientX;
            pendingWidth = startWidth + delta;
            // Throttle layout work to one update per animation frame so the
            // drag stays smooth even while the page reflows.
            if (!rafId) rafId = requestAnimationFrame(flushResize);
        };

        const stopResize = () => {
            if (!isResizing) return;
            isResizing = false;
            activePointerId = null;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            // Apply the final width once and sync the page inset.
            const finalWidth = applyPanelWidth(panel, pendingWidth || panel.getBoundingClientRect().width);
            if (isPinned) applyPageInset(finalWidth);
            document.body.classList.remove('preview-resizing');
            handle.classList.remove('is-resizing');
            handle.removeEventListener('pointermove', onPointerMove);
            handle.removeEventListener('pointerup', stopResize);
            handle.removeEventListener('pointercancel', stopResize);
            handle.removeEventListener('lostpointercapture', stopResize);
            window.removeEventListener('blur', stopResize);
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('mouseup', stopResize);
            persistPanelWidth(panel.getBoundingClientRect().width);
        };

        const startResize = (e) => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.getBoundingClientRect().width;
            pendingWidth = startWidth;
            document.body.classList.add('preview-resizing');
            handle.classList.add('is-resizing');

            if (e.pointerId !== undefined && handle.setPointerCapture) {
                activePointerId = e.pointerId;
                try {
                    handle.setPointerCapture(activePointerId);
                } catch (_) {
                    activePointerId = null;
                }
            }

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', stopResize);
            handle.addEventListener('pointercancel', stopResize);
            handle.addEventListener('lostpointercapture', stopResize);
            window.addEventListener('blur', stopResize);

            // Fallback listeners if pointer capture is unavailable or fails.
            document.addEventListener('mousemove', onPointerMove);
            document.addEventListener('mouseup', stopResize);
        };

        handle.addEventListener('pointerdown', startResize);
        handle.addEventListener('mousedown', function (e) {
            if (!window.PointerEvent) startResize(e);
        });
    }

    function createOverlay() {
        const existing = document.querySelector('.preview-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'preview-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && !isPinned) {
                clearPageInset();
                overlay.remove();
                const panel = document.querySelector('.preview-panel');
                if (panel) panel.remove();
            }
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    function showPreview(params, fileType, link) {
        const fileName = params.fileName;

        // If pinned, reuse existing panel — just update content
        const existingPanel = document.querySelector('.preview-panel');
        const existingOverlay = document.querySelector('.preview-overlay');
        if (isPinned && existingPanel) {
            const title = existingPanel.querySelector('.preview-header-title');
            if (title) title.textContent = fileName;
            const body = existingPanel.querySelector('.preview-body');
            if (body) {
                body.innerHTML = '<div class="preview-loading">Capturing file URL\u2026</div>';
                // Update download button
                const dlBtn = existingPanel.querySelector('.download-btn');
                if (dlBtn) {
                    dlBtn.onclick = () => triggerDownload(link);
                }
                captureFileUrl(link).then((captured) => {
                    if (!captured) {
                        body.innerHTML = '<div class="preview-error">Could not capture download URL.</div>';
                        return;
                    }
                    body.innerHTML = '<div class="preview-loading">Loading preview\u2026</div>';
                    openInSidebar(captured, body, fileType);
                });
            }
            return;
        }

        // Not pinned or no existing panel — create fresh
        if (existingPanel) existingPanel.remove();
        if (existingOverlay) existingOverlay.remove();

        const overlay = createOverlay();
        const panel = document.createElement('div');
        panel.className = 'preview-panel';
        const savedPanelWidth = getSavedPanelWidth();
        if (savedPanelWidth) applyPanelWidth(panel, savedPanelWidth);
        enablePanelResize(panel);

        // Header
        const header = document.createElement('div');
        header.className = 'preview-header';

        const title = document.createElement('span');
        title.className = 'preview-header-title';
        title.textContent = fileName;

        const actions = document.createElement('div');
        actions.className = 'preview-header-actions';

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pin-btn';
        pinBtn.textContent = '\uD83D\uDCCC Pin';
        pinBtn.title = 'Keep panel open when previewing other files';
        pinBtn.addEventListener('click', () => {
            isPinned = !isPinned;
            pinBtn.classList.toggle('pinned', isPinned);
            pinBtn.textContent = isPinned ? '\uD83D\uDCCC Pinned' : '\uD83D\uDCCC Pin';
            if (isPinned) {
                overlay.style.display = 'none';
                // Shrink page content to make room for the panel (margin-right
                // inset on <html> only — see applyPageInset).
                applyPageInset(panel.getBoundingClientRect().width);
            } else {
                overlay.style.display = '';
                clearPageInset();
            }
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'download-btn';
        downloadBtn.textContent = '\u2B07 Download';
        downloadBtn.title = 'Download file normally';
        downloadBtn.addEventListener('click', () => triggerDownload(link));

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715 Close';
        closeBtn.addEventListener('click', () => {
            isPinned = false;
            clearPageInset();
            overlay.remove();
            panel.remove();
        });

        actions.appendChild(pinBtn);
        actions.appendChild(downloadBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        // Body
        const body = document.createElement('div');
        body.className = 'preview-body';
        body.innerHTML = '<div class="preview-loading">Capturing file URL\u2026</div>';

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        // Keep the pinned reflow correct when the browser window is resized:
        // re-clamp the panel width to the new viewport and re-apply the inset.
        const onWindowResize = () => {
            if (!document.body.contains(panel)) {
                window.removeEventListener('resize', onWindowResize);
                return;
            }
            const clamped = applyPanelWidth(panel, panel.getBoundingClientRect().width);
            if (isPinned) applyPageInset(clamped);
        };
        window.addEventListener('resize', onWindowResize);

        const teardown = () => {
            isPinned = false;
            clearPageInset();
            window.removeEventListener('resize', onWindowResize);
            overlay.remove();
            panel.remove();
        };

        // ESC to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                teardown();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        captureFileUrl(link).then((captured) => {
            if (!captured) {
                body.innerHTML = '<div class="preview-error">Could not capture download URL.<br>The openFile mechanism was not intercepted.<br>Check console for [Preview Pane] logs.</div>';
                return;
            }

            body.innerHTML = '<div class="preview-loading">Loading preview\u2026</div>';
            log('Rendering file, captured:', captured);
            openInSidebar(captured, body, fileType);
        });
    }

    // ========== IFRAME PREVIEW ==========
    function openInSidebar(captured, container, fileType) {
        if (captured.type !== 'form') {
            container.innerHTML = '<div class="preview-error">Unexpected capture type: ' + captured.type + '</div>';
            return;
        }

        // Set flag so content-iframe.js knows to activate in the iframe
        sessionStorage.setItem(PREVIEW_FLAG, fileType);

        // Create the iframe in the sidebar
        const iframeName = '__preview_iframe_' + Date.now();
        const iframe = document.createElement('iframe');
        iframe.name = iframeName;
        iframe.style.cssText = 'width:100%;height:100%;border:none;';
        container.innerHTML = '';
        container.appendChild(iframe);

        // Create a hidden form targeting our iframe and submit it
        const form = document.createElement('form');
        form.method = captured.method || 'POST';
        form.action = captured.action || 'https://agile.natinst.com/Agile/PCMServlet';
        form.target = iframeName;
        form.style.display = 'none';
        form.id = '__preview_submit_form';

        if (captured.fields) {
            Object.keys(captured.fields).forEach(name => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = name;
                input.value = captured.fields[name];
                form.appendChild(input);
            });
        }

        document.body.appendChild(form);

        // Submit the form. This runs from the isolated world, whose
        // HTMLFormElement.prototype.submit is NOT hooked, so it performs a
        // normal submission targeting our named iframe (cookies included).
        form.submit();
        form.remove();

        // Keep the flag available long enough for Edge to load the bounce iframe
        // and run the MAIN-world interception hooks at document_start.
        setTimeout(() => sessionStorage.removeItem(PREVIEW_FLAG), PREVIEW_FLAG_FALLBACK_CLEAR_MS);
        log('Form submitted to iframe. Bounce page loading...');
    }

    // --- Bundled reference PDF (lives inside the extension, not the website) ---
    // Drop your PDF at: docs/reference.pdf inside the extension folder.
    const REFERENCE_PDF_PATH = 'docs/reference.pdf';
    const REFERENCE_PDF_LABEL = 'Fireman Manual';
    const PDF_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M14 3v5h5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
        '</svg>';

    function getExtensionUrl(path) {
        try {
            if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL) {
                return browser.runtime.getURL(path);
            }
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
                return chrome.runtime.getURL(path);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    // True only for the login page and the post-login success page (the one
    // that says "We recommend closing this browser window or browser tab...").
    function isAuthGatewayPage() {
        if (/login-cms\.jsp/i.test(location.href)) return true;
        const text = (document.body && document.body.textContent) || '';
        if (/we recommend closing this browser/i.test(text)) return true;
        return false;
    }

    function injectReferencePdfButton() {
        // Do not show on the login page or the post-login forwarding page
        // (only after sign-in and on later pages).
        if (isAuthGatewayPage()) {
            const existing = document.querySelector('.ref-pdf-btn');
            if (existing) existing.remove();
            return;
        }
        if (document.querySelector('.ref-pdf-btn')) return;
        if (!document.body) return;

        const url = getExtensionUrl(REFERENCE_PDF_PATH);
        if (!url) return;

        const btn = document.createElement('button');
        btn.className = 'ref-pdf-btn';
        btn.type = 'button';
        btn.title = 'Open the ' + REFERENCE_PDF_LABEL + ' in the preview panel';
        btn.innerHTML = PDF_ICON_SVG + '<span>' + REFERENCE_PDF_LABEL + '</span>';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openUrlInSidebar(url, REFERENCE_PDF_LABEL);
        });

        document.body.appendChild(btn);

        // Anchor it directly under the parametric-search toolbar button.
        const anchor = document.getElementById('top_paramSearch');
        if (anchor) {
            const reposition = () => {
                const rect = anchor.getBoundingClientRect();
                btn.style.right = 'auto';
                btn.style.left = (rect.left - (btn.offsetWidth / 2)) + 'px';
                btn.style.top = (rect.bottom + 16) + 'px';
            };
            reposition();
            window.addEventListener('resize', reposition);
            window.addEventListener('scroll', reposition, true);
        }

        log('Reference PDF button injected:', url);
    }

    // Build an iframe wrapped with a spinner overlay that hides once the frame
    // finishes loading. A minimum visible time keeps the spinner from flashing
    // away when a page (e.g. the Oracle APEX/MVDB shell) fires `load` almost
    // immediately while its real content is still loading.
    function buildIframeWithLoader(url, loaderText) {
        const wrap = document.createElement('div');
        wrap.className = 'preview-iframe-wrap';

        const loader = document.createElement('div');
        loader.className = 'preview-iframe-loader';
        loader.innerHTML = '<div class="preview-spinner"></div><div>' +
            (loaderText || 'Loading\u2026') + '</div>';
        wrap.appendChild(loader);

        const iframe = document.createElement('iframe');
        iframe.className = 'preview-iframe';
        iframe.style.cssText = 'width:100%;border:none;flex:1;';

        const MIN_LOADER_MS = 500;
        let shownAt = Date.now();
        function hideLoader() {
            const wait = Math.max(0, MIN_LOADER_MS - (Date.now() - shownAt));
            setTimeout(() => loader.remove(), wait);
        }
        iframe.addEventListener('load', () => {
            if (iframe.src && iframe.src !== 'about:blank') hideLoader();
        });
        wrap.appendChild(iframe);

        // Live apps (ECHO, MVDB, Azure) may redirect to an SSO login that
        // refuses to be embedded (X-Frame-Options / CSP frame-ancestors). We
        // can't read that cross-origin error from JS, so the background script
        // detects the framing block (via response headers) and messages us to
        // reveal this footer. It stays hidden otherwise.
        const isExternal = /^https?:/i.test(url || '');
        if (isExternal) {
            const note = document.createElement('div');
            note.className = 'preview-signin-note';

            const text = document.createElement('span');
            text.className = 'preview-signin-text';
            text.textContent = 'This page requires sign-in. Sign in first so the session is cached, then reload.';

            const signInBtn = document.createElement('button');
            signInBtn.type = 'button';
            signInBtn.className = 'preview-signin-btn';
            signInBtn.textContent = 'Sign in (new tab)';
            signInBtn.addEventListener('click', () => window.open(url, '_blank', 'noopener'));

            const reloadBtn = document.createElement('button');
            reloadBtn.type = 'button';
            reloadBtn.className = 'preview-signin-btn preview-signin-btn--ghost';
            reloadBtn.textContent = 'Reload';
            reloadBtn.addEventListener('click', () => {
                note.classList.remove('is-visible');
                shownAt = Date.now();
                loader.style.display = 'flex';
                wrap.appendChild(loader);
                iframe.src = 'about:blank';
                iframe.src = url;
            });

            note.appendChild(text);
            note.appendChild(signInBtn);
            note.appendChild(reloadBtn);
            wrap.appendChild(note);
            // Allow the background frame-block detector to reveal this note.
            activeSignInNote = note;
        }

        if (url) iframe.src = url;
        return wrap;
    }

    // Open a direct URL (e.g. a bundled extension PDF) in the preview sidebar.
    function openUrlInSidebar(url, titleText) {
        const existingPanel = document.querySelector('.preview-panel');
        const existingOverlay = document.querySelector('.preview-overlay');

        // Reuse the panel if it already exists (e.g. pinned).
        if (existingPanel) {
            const title = existingPanel.querySelector('.preview-header-title');
            if (title) title.textContent = titleText;
            const body = existingPanel.querySelector('.preview-body');
            if (body) {
                body.innerHTML = '';
                body.appendChild(buildIframeWithLoader(url, 'Loading ' + titleText + '\u2026'));
            }
            return;
        }

        const overlay = createOverlay();
        const panel = document.createElement('div');
        panel.className = 'preview-panel';
        const savedPanelWidth = getSavedPanelWidth();
        if (savedPanelWidth) applyPanelWidth(panel, savedPanelWidth);
        enablePanelResize(panel);

        const header = document.createElement('div');
        header.className = 'preview-header';

        const title = document.createElement('span');
        title.className = 'preview-header-title';
        title.textContent = titleText;

        const actions = document.createElement('div');
        actions.className = 'preview-header-actions';

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pin-btn';
        pinBtn.textContent = '\uD83D\uDCCC Pin';
        pinBtn.title = 'Keep panel open when previewing other files';
        pinBtn.addEventListener('click', () => {
            isPinned = !isPinned;
            pinBtn.classList.toggle('pinned', isPinned);
            pinBtn.textContent = isPinned ? '\uD83D\uDCCC Pinned' : '\uD83D\uDCCC Pin';
            if (isPinned) {
                overlay.style.display = 'none';
                applyPageInset(panel.getBoundingClientRect().width);
            } else {
                overlay.style.display = '';
                clearPageInset();
            }
        });

        const openTabBtn = document.createElement('button');
        openTabBtn.className = 'download-btn';
        openTabBtn.textContent = '\u2197 Open in tab';
        openTabBtn.title = 'Open the PDF in a new browser tab';
        openTabBtn.addEventListener('click', () => window.open(url, '_blank'));

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715 Close';
        closeBtn.addEventListener('click', () => {
            isPinned = false;
            clearPageInset();
            overlay.remove();
            panel.remove();
        });

        actions.appendChild(pinBtn);
        actions.appendChild(openTabBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'preview-body';
        body.appendChild(buildIframeWithLoader(url, 'Loading ' + titleText + '\u2026'));

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                isPinned = false;
                clearPageInset();
                overlay.remove();
                panel.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    // --- Part Number Copy Button (page-title <h2>) ---
    const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '</svg>';
    const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';

    // Returns true only for part-number-like strings: no spaces, at least one
    // digit, and only letters/digits/dashes/dots (e.g. "216113", "135491A-02L").
    function isPartNumber(text) {
        return /^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(text) && /[0-9]/.test(text);
    }

    function copyPartNumber(text, btn) {
        var plain = text;
        // Rich variant: 12pt, no bold/italic/underline so it pastes "plain" at 12pt.
        var html = '<span style="font-size:12.0pt;font-weight:normal;font-style:normal;' +
            'text-decoration:none;font-family:Calibri,Arial,sans-serif;">' +
            plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
            '</span>';

        function flash() {
            btn.classList.add('copied');
            btn.innerHTML = CHECK_ICON_SVG;
            setTimeout(function () {
                btn.classList.remove('copied');
                btn.innerHTML = COPY_ICON_SVG;
            }, 1500);
        }

        try {
            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                var item = new ClipboardItem({
                    'text/plain': new Blob([plain], { type: 'text/plain' }),
                    'text/html': new Blob([html], { type: 'text/html' })
                });
                navigator.clipboard.write([item]).then(flash).catch(function () {
                    navigator.clipboard.writeText(plain).then(flash);
                });
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(plain).then(flash);
            } else {
                // Legacy fallback
                var ta = document.createElement('textarea');
                ta.value = plain;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                flash();
            }
        } catch (err) {
            log('Copy failed:', err);
        }
    }

    function processPartNumbers() {
        // Page-title part number lives in the standard page title <h2>.
        const headings = document.querySelectorAll('.column_one h2, h2.page-title, .layout h2');
        headings.forEach((h2) => {
            if (h2.dataset.partnumProcessed) return;
            const partNum = (h2.textContent || '').trim();
            if (!partNum) return;
            // Only attach to actual part numbers (e.g. "216113", "135491A-02L"),
            // not word titles like "Welcome". Part numbers have no spaces and
            // contain at least one digit.
            if (!isPartNumber(partNum)) return;

            h2.dataset.partnumProcessed = 'true';

            const btn = document.createElement('button');
            btn.className = 'partnum-copy-btn';
            btn.type = 'button';
            btn.innerHTML = COPY_ICON_SVG;
            btn.title = 'Copy part number to clipboard';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                copyPartNumber(partNum, btn);
            });

            h2.appendChild(btn);

            // ECHO doesn't carry FCO documents, nor 6-digit part numbers
            // starting with 2 (longer numeric part numbers are kept).
            if (!/^FCO/i.test(partNum) && !/^2\d{5}$/.test(partNum)) {
                const echoBtn = document.createElement('button');
                echoBtn.className = 'partnum-echo-btn';
                echoBtn.type = 'button';
                echoBtn.textContent = 'ECHO';
                echoBtn.title = 'Open this part in ECHO';
                echoBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openPartInEcho(partNum, echoBtn);
                });

                h2.appendChild(echoBtn);
            }

            // MVDB only carries part numbers starting with 1.
            if (/^1/.test(partNum)) {
                const mvdbBtn = document.createElement('button');
                mvdbBtn.className = 'partnum-mvdb-btn';
                mvdbBtn.type = 'button';
                mvdbBtn.textContent = 'MVDB';
                mvdbBtn.title = 'Open this part in MVDB';
                mvdbBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const url = 'https://apex.natinst.com/apexp/f?p=NIMFG_MVDB_APP:1:0:::RIR:IR_ROWFILTER:' +
                        encodeURIComponent(partNum) + '&c=NIAPEX';
                    openUrlInSidebar(url, 'MVDB: ' + partNum);
                });

                h2.appendChild(mvdbBtn);
            }

            // BlueNITE Configuration Tool: launches the desktop app via the
            // custom "bluenite://" protocol (registered locally) and searches
            // this part number. Same part-number family as MVDB (starts with 1).
            if (/^1/.test(partNum)) {
                const blueniteBtn = document.createElement('button');
                blueniteBtn.className = 'partnum-bluenite-btn';
                blueniteBtn.type = 'button';
                blueniteBtn.textContent = 'BlueNITE';
                blueniteBtn.title = 'Search this part in the BlueNITE Configuration Tool';
                blueniteBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openInBlueNITE(partNum, 'Products');
                });

                h2.appendChild(blueniteBtn);
            }

            // Azure DevOps search: opens a work-item search for this part
            // number on dev.azure.com (DevCentral project) inside the preview
            // sidebar.
            {
                const azureBtn = document.createElement('button');
                azureBtn.className = 'partnum-azure-btn';
                azureBtn.type = 'button';
                azureBtn.textContent = 'Azure';
                azureBtn.title = 'Search this part in Azure DevOps (DevCentral)';
                azureBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openInAzure(partNum);
                });

                h2.appendChild(azureBtn);
            }

            // Test images: part numbers starting with 53 or 54 are test images.
            // Search them in BlueNITE and route to the Images tab.
            if (/^5[34]/.test(partNum)) {
                const blueniteImgBtn = document.createElement('button');
                blueniteImgBtn.className = 'partnum-bluenite-btn';
                blueniteImgBtn.type = 'button';
                blueniteImgBtn.textContent = 'BlueNITE';
                blueniteImgBtn.title = 'Search this test image in the BlueNITE Configuration Tool (Images tab)';
                blueniteImgBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openInBlueNITE(partNum, 'Images');
                });

                h2.appendChild(blueniteImgBtn);
            }
        });
    }

    // Open the part in ECHO inside the preview sidebar. The actual search runs
    // FIRST-PARTY inside the echo.natinst.com iframe (content-echo.js) because
    // a background fetch gets HTTP 401 — Firefox withholds ECHO's SameSite
    // session cookies on cross-site requests. We pass the part number via the
    // URL hash; content-echo.js resolves it and redirects to the BOM page.
    function openPartInEcho(partNum, btn) {
        const url = 'https://echo.natinst.com/part/search#__echo_lookup=' +
            encodeURIComponent(partNum);
        openUrlInSidebar(url, 'ECHO: ' + partNum);
    }

    // Launch the BlueNITE Configuration Tool (desktop app) and search this
    // part via the custom "bluenite://" protocol. The protocol must be
    // registered locally (see bluenite-protocol/register.ps1). We trigger it
    // with a transient hidden iframe so the current page is not navigated away.
    // An optional tab name (e.g. "Products") selects that tab before searching.
    function openInBlueNITE(partNum, tab) {
        let url = 'bluenite://search/' + encodeURIComponent(partNum);
        if (tab) {
            url += '?tab=' + encodeURIComponent(tab);
        }
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = url;
        document.body.appendChild(frame);
        setTimeout(() => frame.remove(), 1000);
    }

    // Open an Azure DevOps work-item search for this part in the preview
    // sidebar. Searches the DevCentral project on dev.azure.com.
    function openInAzure(partNum) {
        const url = 'https://dev.azure.com/ni/DevCentral/_search?text=' +
            encodeURIComponent(partNum) +
            '&type=workitem&pageSize=25&filters=' +
            encodeURIComponent('Projects{DevCentral}');
        openUrlInSidebar(url, 'Azure: ' + partNum);
    }

    // Open a Perforce depot path in the P4V desktop app via the custom
    // "p4v://" protocol (see p4v-protocol/register.ps1). Triggered with a
    // transient hidden iframe so the current page is not navigated away.
    function openInP4V(depotPath) {
        const url = 'p4v://tree/' + encodeURIComponent(depotPath);
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = url;
        document.body.appendChild(frame);
        setTimeout(() => frame.remove(), 1000);
    }

    // --- Link Detection & Button Injection ---
    function processLinks() {
        const selectors = [
            'a.image_link',
            'a[onclick*="openFile"]'
        ];

        let count = 0;
        selectors.forEach(selector => {
            const links = document.querySelectorAll(selector);
            links.forEach((link) => {
                if (link.dataset.previewProcessed) return;

                const onclickStr = link.getAttribute('onclick') || '';
                // Only openFile(...) returns raw file bytes. viewFile(...) launches
                // Oracle AutoVue via a .jnlp and cannot be previewed inline.
                if (!onclickStr.includes('openFile')) return;

                const parsed = parseOpenFileParams(onclickStr);
                if (!parsed || !parsed.fileName) return;

                const ext = getFileExtFromName(parsed.fileName);
                if (!ext) return;

                link.dataset.previewProcessed = 'true';
                count++;

                const btn = document.createElement('button');
                btn.className = 'preview-btn';
                btn.textContent = '\uD83D\uDC41 Preview';
                btn.title = 'Preview ' + parsed.fileName;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    showPreview(parsed, ext, link);
                    return false;
                });

                if (link.parentNode) {
                    link.parentNode.insertBefore(btn, link.nextSibling);
                }
            });
        });

        if (count > 0) {
            log('Added', count, 'preview buttons');
        }
    }

    // --- Perforce Path → P4 browser link ---
    // Agile shows depot paths like "//Manufacturing/BN/.../2.0.0f020/" in the
    // "Perforce Path" row. Convert them to the p4 web browser URL:
    //   //Depot/rest/  ->  https://p4.natinst.com/browser/perforce/Depot/rest/
    function perforcePathToUrl(depotPath) {
        const trimmed = String(depotPath || '').trim();
        if (!trimmed.startsWith('//')) return null;
        return 'https://p4.natinst.com/browser/perforce/' + trimmed.replace(/^\/+/, '');
    }

    function processPerforcePaths() {
        // The current ("new") value lives in <span class="new"> inside the
        // Perforce Path cell; fall back to the cell text for plain values.
        const cells = document.querySelectorAll('dd.multivalue, dd.multilist');
        cells.forEach((cell) => {
            if (cell.dataset.p4Processed) return;

            const label = cell.previousElementSibling;
            if (!label || !/perforce\s*path/i.test(label.textContent || '')) return;

            const newSpan = cell.querySelector('span.new');
            const depotPath = ((newSpan ? newSpan.textContent : cell.textContent) || '').trim();
            const url = perforcePathToUrl(depotPath);
            if (!url) return;

            cell.dataset.p4Processed = 'true';

            // Stack the buttons on their own lines below the path text. The
            // Perforce Path cell lays its children out inline (new/old value
            // spans), so a full-width block wrapper forces the buttons onto
            // their own rows regardless of the cell's layout.
            const btnWrap = document.createElement('div');
            btnWrap.style.display = 'block';
            btnWrap.style.width = '100%';
            btnWrap.style.flexBasis = '100%';
            btnWrap.style.flexShrink = '0';
            btnWrap.style.clear = 'both';
            btnWrap.style.marginTop = '6px';

            // First button: open the path in the P4V desktop app.
            const p4vBtn = document.createElement('button');
            p4vBtn.className = 'partnum-echo-btn p4v-open-btn';
            p4vBtn.type = 'button';
            p4vBtn.textContent = 'p4v';
            p4vBtn.title = 'Open this Perforce path in the P4V desktop app';
            p4vBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openInP4V(depotPath);
            });
            btnWrap.appendChild(p4vBtn);

            // Second button: open the same path in the P4 web browser.
            const btn = document.createElement('button');
            btn.className = 'partnum-echo-btn p4-open-btn';
            btn.type = 'button';
            btn.textContent = 'P4 Browser';
            btn.title = 'Open this Perforce path in the P4 web browser';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openUrlInSidebar(url, 'Perforce: ' + depotPath);
            });
            btnWrap.appendChild(btn);

            cell.appendChild(btnWrap);
        });
    }

    // --- Init ---
    log('Initializing...');
    processLinks();
    processPartNumbers();
    processPerforcePaths();
    injectReferencePdfButton();

    // The background script messages us when a preview sub-frame is blocked
    // from being embedded (SSO/X-Frame-Options). Only then do we reveal the
    // sign-in footer for the currently open external preview.
    const runtimeApi = (typeof browser !== 'undefined' && browser.runtime)
        ? browser
        : (typeof chrome !== 'undefined' ? chrome : null);
    if (runtimeApi && runtimeApi.runtime && runtimeApi.runtime.onMessage) {
        runtimeApi.runtime.onMessage.addListener((msg) => {
            if (msg && msg.type === 'preview_frame_blocked' && activeSignInNote) {
                activeSignInNote.classList.add('is-visible');
            }
        });
    }

    if (document.body) {
        const observer = new MutationObserver(() => {
            processLinks();
            processPartNumbers();
            processPerforcePaths();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        log('MutationObserver attached');
    }

    setInterval(() => { processLinks(); processPartNumbers(); processPerforcePaths(); }, 3000);
    log('Init complete');
})();
