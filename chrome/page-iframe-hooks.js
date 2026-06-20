// MAIN-world hooks for the Agile PLM bounce page that loads inside our preview
// iframe (Chrome MV3). Mirrors the inline page script the Firefox build used in
// content-iframe.js, which Chrome's CSP blocks. Runs in every agile frame at
// document_start but only activates inside an iframe when the preview flag is
// set, then intercepts the IFS form submission and hands the fields to the
// isolated content script via a CustomEvent.
(function () {
    'use strict';

    // Only the bounce iframe, never the top page.
    if (window === window.top) return;

    var PREVIEW_FLAG = '__preview_pane_active';
    var INTERCEPT_ATTR = 'data-agile-preview-intercepted';

    if (window.__agilePreviewIframeHooks) return;
    window.__agilePreviewIframeHooks = true;

    function isPreviewActive() {
        try { return !!sessionStorage.getItem(PREVIEW_FLAG); } catch (_) { return false; }
    }

    function persistIntercept(payloadJson) {
        try {
            document.documentElement.setAttribute(INTERCEPT_ATTR, payloadJson);
        } catch (_) { }
    }

    function dispatchUrlIntercept(url, source) {
        if (!isPreviewActive()) return false;
        if (!url || url === 'about:blank' || url.indexOf('javascript:') === 0) return false;

        var payloadJson = JSON.stringify({
            url: String(url),
            method: 'GET',
            target: '',
            fields: {},
            source: source || 'url',
            locationHref: String(window.location.href || '')
        });

        console.log('[Agile PLM Ext Page] Intercepted preview URL handoff via', source || 'url', ':', String(url));

        persistIntercept(payloadJson);
        document.dispatchEvent(new CustomEvent('__agile_preview_form_intercepted', {
            detail: payloadJson
        }));

        try { sessionStorage.removeItem(PREVIEW_FLAG); } catch (_) { }
        return true;
    }

    function dispatchIntercept(form) {
        if (!form) return false;

        var action = form.action || '';
        if (!isPreviewActive()) return false;

        var method = (form.method || 'POST').toUpperCase();
        var target = form.target || '';
        var isKnownFileAction = action.indexOf('agilesvc1') !== -1 || action.indexOf('Filemgr') !== -1 || action.indexOf('AttachmentServlet') !== -1;

        if (!isKnownFileAction) {
            console.log('[Agile PLM Ext Page] Preview submit did not match known file endpoints. Intercepting anyway:', action || '(empty action)', 'target:', target || '(none)');
        }

        console.log('[Agile PLM Ext Page] Intercepted preview form submission:', action || '(empty action)', 'method:', method, 'target:', target || '(none)');

        var fields = {};
        var inputs = form.querySelectorAll('input, select, textarea');
        for (var i = 0; i < inputs.length; i++) {
            if (inputs[i].name) fields[inputs[i].name] = inputs[i].value || '';
        }
        var allInputs = form.getElementsByTagName('input');
        for (var j = 0; j < allInputs.length; j++) {
            if (allInputs[j].name && !(allInputs[j].name in fields)) {
                fields[allInputs[j].name] = allInputs[j].value || '';
            }
        }

        console.log('[Agile PLM Ext Page] Captured', Object.keys(fields).length, 'fields');

        var payloadJson = JSON.stringify({
            url: action,
            method: method,
            target: target,
            fields: fields,
            locationHref: String(window.location.href || '')
        });

        persistIntercept(payloadJson);

        document.dispatchEvent(new CustomEvent('__agile_preview_form_intercepted', {
            detail: payloadJson
        }));

        try { sessionStorage.removeItem(PREVIEW_FLAG); } catch (_) { }
        return true;
    }

    // Suppress the "please close this dialogue" popup only during preview.
    var _origOpen = window.open;
    window.open = function (url) {
        if (!isPreviewActive()) return _origOpen.apply(this, arguments);
        if (dispatchUrlIntercept(url, 'window.open')) return null;
        console.log('[Agile PLM Ext Page] Blocked window.open');
        return null;
    };

    var origSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (origSrcDesc && origSrcDesc.set) {
        var _origSrcSet = origSrcDesc.set;
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            set: function (val) {
                if (isPreviewActive() && val && val !== '' && val !== 'about:blank') {
                    try {
                        var fullUrl = new URL(val, window.location.origin).href;
                        if (dispatchUrlIntercept(fullUrl, 'iframe.src')) return;
                    } catch (_) { }
                }
                return _origSrcSet.call(this, val);
            },
            get: origSrcDesc.get
        });
    }

    var _origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (isPreviewActive() && this.href && dispatchUrlIntercept(this.href, 'anchor.click')) return;
        return _origAnchorClick.call(this);
    };

    var _origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (dispatchIntercept(this)) return;

        return _origSubmit.call(this);
    };

    if (typeof HTMLFormElement.prototype.requestSubmit === 'function') {
        var _origRequestSubmit = HTMLFormElement.prototype.requestSubmit;
        HTMLFormElement.prototype.requestSubmit = function () {
            if (dispatchIntercept(this)) return;
            return _origRequestSubmit.apply(this, arguments);
        };
    }

    document.addEventListener('submit', function (event) {
        if (dispatchIntercept(event.target)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    console.log('[Agile PLM Ext Page] MAIN-world form hooks installed. Waiting for preview handoff...');

    // --- Part Tree hidden-frame command channel ------------------------------
    // The Part Tree feature drives a hidden Agile frame to read BOM/Where-Used
    // grids. In Firefox the isolated content script injected scripts into that
    // frame to call displayObject(...); Chrome MV3 forbids that, so this MAIN-
    // world helper (running in the hidden frame) executes commands the parent
    // content script hands over via a data attribute, and proactively signals
    // readiness. Commands: { a:'displayObject', args:[...] } | { a:'clickTab', src, flags }.
    (function () {
        var rootEl = document.documentElement;
        if (!rootEl) return;

        // Proactively mark readiness once Agile's displayObject global exists.
        var readyTimer = setInterval(function () {
            try {
                if (typeof window.displayObject === 'function') {
                    rootEl.setAttribute('data-tree-ready', '1');
                    clearInterval(readyTimer);
                }
            } catch (e) { /* ignore */ }
        }, 200);
        setTimeout(function () { clearInterval(readyTimer); }, 40000);

        function runCmd(json) {
            var cmd;
            try { cmd = JSON.parse(json); } catch (e) { return; }
            try {
                if (cmd.a === 'displayObject' && typeof window.displayObject === 'function') {
                    window.displayObject.apply(window, cmd.args || []);
                } else if (cmd.a === 'clickTab') {
                    var re = new RegExp(cmd.src, cmd.flags || '');
                    var ls = document.querySelectorAll('#tabsDiv a,a,.tabConButton,.tabname,.tabConButtonSel,li a');
                    for (var i = 0; i < ls.length; i++) {
                        var t = (ls[i].textContent || '').replace(/\s+/g, ' ').trim();
                        if (t && re.test(t)) { ls[i].click(); break; }
                    }
                }
            } catch (e) { console.error('[Agile PLM Ext Page] tree frame cmd error', e); }
        }

        var obs = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                if (muts[i].attributeName === 'data-pp-frame-cmd') {
                    var v = rootEl.getAttribute('data-pp-frame-cmd');
                    if (v) { rootEl.removeAttribute('data-pp-frame-cmd'); runCmd(v); }
                }
            }
        });
        obs.observe(rootEl, { attributes: true, attributeFilter: ['data-pp-frame-cmd'] });
    })();
})();
