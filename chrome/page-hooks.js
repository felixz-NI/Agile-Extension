// MAIN-world page hooks for the Agile PLM top frame (Chrome MV3).
//
// Chrome enforces the page's Content Security Policy on any inline <script>
// a content script injects, and this page's CSP forbids both inline scripts
// and eval. The Firefox build injected its page-context hooks as inline
// scripts; that is blocked in Chrome. Registering this file as a content
// script with "world": "MAIN" runs it directly in the page realm WITHOUT
// being subject to the page CSP, so we can install the hooks here and talk
// to the isolated content script (content-main.js) over CustomEvents.
//
// Bridge protocol (document-level CustomEvents, detail is a JSON string):
//   isolated -> MAIN : '__pp_cmd'    { cmd, id?, fn?, args?, formId? }
//   MAIN -> isolated : '__pp_result' { id, result }
(function () {
    'use strict';

    if (window.__agilePreviewMainHooks) return;
    window.__agilePreviewMainHooks = true;

    var _origOpen = window.open;
    var _capture = null;

    function startCapture(id) {
        return new Promise(function (resolve) {
            _capture = { resolve: resolve, id: id };
            setTimeout(function () {
                if (_capture && _capture.id === id) {
                    _capture.resolve(null);
                    _capture = null;
                }
            }, 3000);
        });
    }

    // Block window.open while we are waiting to capture a file URL.
    window.open = function (url) {
        if (_capture && url) {
            console.log('[Preview Pane] Blocked window.open (waiting for form):', url);
            return null;
        }
        return _origOpen.apply(this, arguments);
    };

    // Hook form.submit so an armed capture grabs the target/fields instead of
    // navigating. The original submit is kept for our own re-submit.
    var _origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (_capture) {
            var action = this.action || window.location.href;
            var method = (this.method || 'GET').toUpperCase();
            var fields = {};
            var inputs = this.querySelectorAll('input, select, textarea');
            for (var i = 0; i < inputs.length; i++) {
                var inp = inputs[i];
                if (inp.name) fields[inp.name] = inp.value || '';
            }
            console.log('[Preview Pane] Intercepted form submit:', action, 'method:', method);
            _capture.resolve({ type: 'form', action: action, method: method, fields: fields, target: this.target || '' });
            _capture = null;
            return;
        }
        return _origSubmit.call(this);
    };

    // Hook iframe.src assignment (some openFile variants set an iframe src).
    var origSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (origSrcDesc && origSrcDesc.set) {
        var _origSrcSet = origSrcDesc.set;
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            set: function (val) {
                if (_capture && val && val !== '' && val !== 'about:blank') {
                    var fullUrl = new URL(val, window.location.origin).href;
                    console.log('[Preview Pane] Intercepted iframe src:', fullUrl);
                    _capture.resolve({ type: 'url', url: fullUrl, method: 'GET' });
                    _capture = null;
                    return;
                }
                return _origSrcSet.call(this, val);
            },
            get: origSrcDesc.get
        });
    }

    function isPlaceholderHref(href) {
        if (!href) return true;
        var normalized = String(href).replace(/\s+/g, '').toLowerCase();
        return normalized === '' || normalized === '#' || normalized === 'about:blank' || normalized.indexOf('javascript:') === 0;
    }

    // Hook anchor.click (some variants click a generated link).
    var _origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (_capture && !isPlaceholderHref(this.href)) {
            console.log('[Preview Pane] Intercepted a.click():', this.href);
            _capture.resolve({ type: 'url', url: this.href, method: 'GET' });
            _capture = null;
            return;
        }
        return _origClick.call(this);
    };

    function dispatchResult(id, result) {
        document.dispatchEvent(new CustomEvent('__pp_result', {
            detail: JSON.stringify({ id: id, result: result })
        }));
    }

    function clickBridgeLink(attrValue) {
        if (!attrValue) return;
        var selector = 'a[data-preview-bridge-id="' + String(attrValue).replace(/"/g, '\\"') + '"]';
        var link = document.querySelector(selector);
        if (!link) {
            console.warn('[Preview Pane] bridge link not found for:', attrValue);
            return;
        }
        link.click();
    }

    // Invoke a page-global function (e.g. openFile) with parsed args. Because
    // eval is blocked by CSP, the isolated script parses the onclick into a
    // function name + argument array and we call it directly here.
    function callPageFn(fn, args) {
        try {
            if (fn && typeof window[fn] === 'function') {
                window[fn].apply(window, args || []);
            } else {
                console.warn('[Preview Pane] page function not found:', fn);
            }
        } catch (err) {
            console.error('[Preview Pane] error invoking', fn, err);
        }
    }

    // Command channel from the isolated content script.
    document.addEventListener('__pp_cmd', function (e) {
        var msg;
        try { msg = JSON.parse(e.detail); } catch (_) { return; }

        if (msg.cmd === 'capture') {
            startCapture(msg.id).then(function (result) {
                dispatchResult(msg.id, result);
            });
            if (msg.linkAttrValue) {
                clickBridgeLink(msg.linkAttrValue);
            } else {
                // Trigger the page's openFile so one of the hooks above fires.
                callPageFn(msg.fn, msg.args);
            }
        } else if (msg.cmd === 'invoke') {
            if (msg.linkAttrValue) {
                clickBridgeLink(msg.linkAttrValue);
            } else {
                // Normal download — run the page function without arming capture.
                callPageFn(msg.fn, msg.args);
            }
        } else if (msg.cmd === 'submit') {
            // Re-submit our hidden form using the original (unhooked) submit.
            var form = document.getElementById(msg.formId);
            if (form) _origSubmit.call(form);
        }
    });

    console.log('[Preview Pane] MAIN-world page hooks installed');
})();
