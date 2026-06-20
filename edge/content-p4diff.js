// content-p4diff.js — Runs on p4.natinst.com (P4FS web browser).
// Adds a directory diff viewer: pick two depot directories (browse-and-click
// or type a path / two revisions of the same folder), recursively enumerate
// both trees first-party (cookies included), and diff the file lists with
// path + extension filtering. File "modified" is inferred from a differing
// changelist on a common relative path.

(function () {
    'use strict';

    const DEBUG = false;
    function log() { if (DEBUG) console.log.apply(console, ['[P4 Diff]'].concat([].slice.call(arguments))); }

    if (window.__p4DiffLoaded) return;
    window.__p4DiffLoaded = true;

    const BROWSE_PREFIX = '/browser/perforce/';

    // --- Styles ---
    const style = document.createElement('style');
    style.textContent = `
        .p4d-launch {
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 2147483000;
            padding: 8px 14px;
            font: 600 13px "Segoe UI", Tahoma, sans-serif;
            color: #fff;
            background: #00796b;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
        .p4d-launch:hover { background: #004d40; }

        .p4d-row-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 18px;
            margin-left: 4px;
            padding: 0;
            font: 700 11px "Segoe UI", Tahoma, sans-serif;
            color: #00695c;
            background: #e0f2f1;
            border: 1px solid #80cbc4;
            border-radius: 3px;
            cursor: pointer;
            vertical-align: middle;
        }
        .p4d-row-btn:hover { background: #b2dfdb; }
        .p4d-row-btn.is-set { background: #00796b; color: #fff; border-color: #00796b; }

        .p4d-panel {
            position: fixed;
            top: 0;
            right: 0;
            width: 560px;
            max-width: 96vw;
            height: 100vh;
            background: #fff;
            box-shadow: -4px 0 24px rgba(0,0,0,0.25);
            z-index: 2147483001;
            display: flex;
            flex-direction: column;
            font: 13px "Segoe UI", Tahoma, sans-serif;
            color: #222;
        }
        .p4d-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: #00796b;
            color: #fff;
            flex-shrink: 0;
        }
        .p4d-head b { font-size: 14px; }
        .p4d-head button {
            background: rgba(255,255,255,0.15);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            cursor: pointer;
        }
        .p4d-head button:hover { background: rgba(255,255,255,0.3); }

        .p4d-config {
            padding: 12px 14px;
            border-bottom: 1px solid #e0e0e0;
            flex-shrink: 0;
        }
        .p4d-field { margin-bottom: 8px; }
        .p4d-field label {
            display: block;
            font-weight: 600;
            margin-bottom: 3px;
            color: #00695c;
        }
        .p4d-field .p4d-inputs { display: flex; gap: 6px; }
        .p4d-field input[type=text] {
            flex: 1;
            min-width: 0;
            padding: 5px 7px;
            border: 1px solid #bbb;
            border-radius: 4px;
            font: 12px "Segoe UI", monospace;
        }
        .p4d-field input.p4d-rev { flex: 0 0 110px; }
        .p4d-opts {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-wrap: wrap;
            margin: 6px 0;
            color: #444;
        }
        .p4d-opts label { font-weight: normal; display: inline-flex; align-items: center; gap: 4px; }
        .p4d-opts input[type=number] { width: 52px; padding: 3px; }
        .p4d-go {
            padding: 7px 16px;
            font-weight: 600;
            color: #fff;
            background: #00796b;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .p4d-go:hover { background: #004d40; }
        .p4d-go:disabled { background: #9e9e9e; cursor: default; }

        .p4d-filters {
            padding: 10px 14px;
            border-bottom: 1px solid #e0e0e0;
            flex-shrink: 0;
            display: none;
        }
        .p4d-filters.is-on { display: block; }
        .p4d-filters .p4d-inputs { display: flex; gap: 6px; margin-bottom: 8px; }
        .p4d-filters input[type=text] {
            flex: 1;
            min-width: 0;
            padding: 5px 7px;
            border: 1px solid #bbb;
            border-radius: 4px;
        }
        .p4d-status-toggles { display: flex; gap: 12px; flex-wrap: wrap; }
        .p4d-status-toggles label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
        .p4d-chip { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
        .p4d-chip.added { background: #2e7d32; }
        .p4d-chip.removed { background: #c62828; }
        .p4d-chip.modified { background: #ef6c00; }
        .p4d-chip.unverified { background: #6d4c41; }
        .p4d-chip.unchanged { background: #9e9e9e; }

        .p4d-status {
            padding: 6px 14px;
            font-size: 12px;
            color: #555;
            background: #f5f5f5;
            border-bottom: 1px solid #e0e0e0;
            flex-shrink: 0;
        }
        .p4d-results { flex: 1; overflow: auto; }
        .p4d-results table { width: 100%; border-collapse: collapse; }
        .p4d-results th, .p4d-results td {
            text-align: left;
            padding: 4px 8px;
            border-bottom: 1px solid #eee;
            font-size: 12px;
            vertical-align: top;
        }
        .p4d-results th {
            position: sticky;
            top: 0;
            background: #fafafa;
            border-bottom: 1px solid #ddd;
            z-index: 1;
        }
        .p4d-results td.path { font-family: "Segoe UI", monospace; word-break: break-all; }
        .p4d-results tr.added td.tag { color: #2e7d32; font-weight: 600; }
        .p4d-results tr.removed td.tag { color: #c62828; font-weight: 600; }
        .p4d-results tr.modified td.tag { color: #ef6c00; font-weight: 600; }
        .p4d-results tr.unverified td.tag { color: #6d4c41; font-weight: 600; }
        .p4d-results tr.unchanged td.tag { color: #9e9e9e; }
        .p4d-results a { color: #00695c; text-decoration: none; }
        .p4d-results a:hover { text-decoration: underline; }
        .p4d-results tr.clickable { cursor: pointer; }
        .p4d-results tr.clickable:hover td { background: #f1f8e9; }
        .p4d-empty { padding: 24px; text-align: center; color: #888; }

        .p4d-resizer {
            position: absolute;
            top: 0;
            left: -3px;
            width: 7px;
            height: 100%;
            cursor: ew-resize;
            z-index: 2147483002;
            background: transparent;
        }
        .p4d-resizer:hover, .p4d-resizer.dragging { background: rgba(0,121,107,0.25); }

        .p4d-diffview {
            position: absolute;
            inset: 0;
            background: #fff;
            display: none;
            flex-direction: column;
            z-index: 5;
        }
        .p4d-diffview.is-on { display: flex; }
        .p4d-diff-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 12px;
            background: #263238;
            color: #fff;
            flex-shrink: 0;
        }
        .p4d-diff-title { font: 600 12px "Segoe UI", monospace; word-break: break-all; }
        .p4d-diff-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .p4d-diff-actions button {
            background: rgba(255,255,255,0.15);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 4px 9px;
            cursor: pointer;
            font-size: 12px;
        }
        .p4d-diff-actions button:hover { background: rgba(255,255,255,0.3); }
        .p4d-diff-actions button.is-active { background: #00897b; }
        .p4d-diff-summary {
            padding: 5px 12px;
            font-size: 12px;
            color: #555;
            background: #eceff1;
            border-bottom: 1px solid #cfd8dc;
            flex-shrink: 0;
        }
        .p4d-diff-summary .add { color: #2e7d32; font-weight: 600; }
        .p4d-diff-summary .del { color: #c62828; font-weight: 600; }
        .p4d-diff-body {
            flex: 1;
            overflow: auto;
            background: #fbfbfb;
        }
        .p4d-diff-body table { width: 100%; border-collapse: collapse; font: 12px/1.5 Consolas, "Courier New", monospace; }
        .p4d-diff-body td { vertical-align: top; padding: 0 6px; white-space: pre-wrap; word-break: break-all; }
        .p4d-diff-body td.ln {
            width: 1%;
            text-align: right;
            color: #90a4ae;
            background: #f0f3f5;
            border-right: 1px solid #e0e0e0;
            user-select: none;
            white-space: nowrap;
        }
        .p4d-diff-body tr.add td { background: #e6f4ea; }
        .p4d-diff-body tr.add td.sign { color: #2e7d32; }
        .p4d-diff-body tr.del td { background: #fce8e6; }
        .p4d-diff-body tr.del td.sign { color: #c62828; }
        .p4d-diff-body td.sign { width: 1%; text-align: center; user-select: none; color: #9e9e9e; }
        .p4d-diff-body tr.hunk td { background: #eef2ff; color: #5c6bc0; user-select: none; }
        .p4d-diff-loading { padding: 24px; text-align: center; color: #888; }
    `;
    (document.head || document.documentElement).appendChild(style);

    // --- Path helpers ---
    function currentDepotPath() {
        let p = decodeURIComponent(window.location.pathname);
        const i = p.indexOf(BROWSE_PREFIX);
        if (i === -1) return '//';
        p = p.slice(i + BROWSE_PREFIX.length);
        p = p.replace(/^\/+/, '');
        return '//' + p;
    }

    function browserUrlToDepot(absUrl) {
        try {
            const u = new URL(absUrl, window.location.origin);
            let p = decodeURIComponent(u.pathname).replace(/^.*\/browser\/perforce\//, '');
            p = p.replace(/^\/+/, '');
            return '//' + p;
        } catch (_) { return null; }
    }

    function depotToBrowserUrl(depot) {
        let p = String(depot || '').trim().replace(/^\/+/, '');
        if (p && !p.endsWith('/')) p += '/';
        const segs = p.split('/').filter(Boolean).map(encodeURIComponent);
        return window.location.origin + BROWSE_PREFIX + segs.join('/') + (segs.length ? '/' : '');
    }

    // Browser URL for a FILE depot path (no trailing slash).
    function depotToFileUrl(depot) {
        const p = String(depot || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
        const segs = p.split('/').filter(Boolean).map(encodeURIComponent);
        return window.location.origin + BROWSE_PREFIX + segs.join('/');
    }

    // Raw-content URL for a file browser URL.
    function rawUrlFor(fileUrl) {
        try {
            const u = new URL(fileUrl);
            u.search = (u.search ? u.search + '&' : '?') + 'raw';
            return u.href;
        } catch (_) { return fileUrl + '?raw'; }
    }

    // A depot path looks like a file when its last segment has an extension
    // and it does not end with '/'.
    function looksLikeFile(depot) {
        const t = String(depot || '').trim();
        if (t.endsWith('/')) return false;
        const last = t.split('/').filter(Boolean).pop() || '';
        return /\.[A-Za-z0-9_]+$/.test(last);
    }

    function fileExt(name) {
        const m = /\.([A-Za-z0-9_]+)$/.exec(name || '');
        return m ? m[1].toLowerCase() : '';
    }

    // --- Directory parsing ---
    // Returns { dirs:[{name,url}], files:[{name,url,changelist,revision}] }.
    function parseListing(html, baseUrl) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table.listing tr.item');
        const dirs = [];
        const files = [];
        rows.forEach((row) => {
            if (row.classList.contains('parent_dir')) return;
            const cells = row.querySelectorAll('td');
            const nameCell = cells[1];
            if (!nameCell) return;
            const a = nameCell.querySelector('a');
            if (!a) return;
            const text = (a.textContent || '').trim();
            const href = a.getAttribute('href') || '';
            if (!text || text === './' || text === '../' || href === '') return; // self / parent
            let absUrl;
            try { absUrl = new URL(href, baseUrl).href; } catch (_) { return; }

            const isDir = nameCell.classList.contains('directory') || text.endsWith('/');
            if (isDir) {
                dirs.push({ name: text.replace(/\/+$/, ''), url: absUrl });
            } else {
                let changelist = null;
                let revision = null;
                const clLink = row.querySelector('a[href*="changelist="]');
                if (clLink) { const m = /changelist=(\d+)/.exec(clLink.getAttribute('href') || ''); if (m) changelist = m[1]; }
                const revLink = row.querySelector('a[href*="revision="]');
                if (revLink) { const m = /[?&]revision=(\d+)/.exec(revLink.getAttribute('href') || ''); if (m) revision = m[1]; }
                // Raw-content link ("<text>"/"<raw>") reflects the listing's revision context.
                let rawUrl = null;
                const rawLink = row.querySelector('a[href*="raw"]');
                if (rawLink) {
                    try { rawUrl = new URL(rawLink.getAttribute('href') || '', baseUrl).href; } catch (_) { rawUrl = null; }
                }
                if (!rawUrl) {
                    // Fallback: append ?raw to the file's browser URL.
                    try { const u = new URL(absUrl); u.searchParams.set('raw', ''); rawUrl = u.href.replace(/raw=$/, 'raw'); } catch (_) { rawUrl = absUrl; }
                }
                files.push({ name: text, url: absUrl, changelist: changelist, revision: revision, rawUrl: rawUrl });
            }
        });
        return { dirs: dirs, files: files };
    }

    function fetchDir(url, revisionAt) {
        let target = url;
        if (revisionAt) {
            const u = new URL(url);
            u.searchParams.set('revision_at', revisionAt);
            target = u.href;
        }
        return fetch(target, { credentials: 'include' }).then((resp) => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + target);
            return resp.text();
        }).then((html) => parseListing(html, url));
    }

    // Recursively enumerate files under rootUrl. Returns [{relPath,name,...}].
    // Uses a bounded-concurrency worker pool over a directory queue (breadth
    // first) so many directory listings are fetched in parallel.
    function walkTree(rootUrl, opts) {
        const out = [];
        const concurrency = opts.dirConcurrency || 12;
        let requests = 0;
        let capped = false;

        return new Promise((resolve) => {
            const queue = [{ url: rootUrl, relPath: '', depth: 0 }];
            let active = 0;

            function pump() {
                // Launch as many directory fetches as concurrency allows.
                while (active < concurrency && queue.length) {
                    const job = queue.shift();
                    if (requests >= opts.maxRequests) { capped = true; queue.length = 0; break; }
                    requests++;
                    active++;
                    if (opts.onProgress) opts.onProgress(requests, job.relPath || '/');

                    fetchDir(job.url, opts.revisionAt).then((res) => {
                        res.files.forEach((f) => {
                            out.push({
                                relPath: job.relPath + f.name,
                                name: f.name,
                                url: f.url,
                                changelist: f.changelist,
                                revision: f.revision,
                                rawUrl: f.rawUrl
                            });
                        });
                        if (opts.recursive && job.depth < opts.maxDepth) {
                            res.dirs.forEach((d) => {
                                queue.push({ url: d.url, relPath: job.relPath + d.name + '/', depth: job.depth + 1 });
                            });
                        }
                    }).catch(() => { /* skip unreadable directory */ }).then(() => {
                        active--;
                        if (active === 0 && queue.length === 0) {
                            resolve({ files: out, requests: requests, capped: capped });
                        } else {
                            pump();
                        }
                    });
                }
                if (active === 0 && queue.length === 0) {
                    resolve({ files: out, requests: requests, capped: capped });
                }
            }
            pump();
        });
    }

    // Structural diff: which paths exist in A, B, or both. Common files are
    // left as status 'common' until content comparison resolves them.
    function diffTrees(listA, listB) {
        const mapA = new Map(); listA.forEach((f) => mapA.set(f.relPath, f));
        const mapB = new Map(); listB.forEach((f) => mapB.set(f.relPath, f));
        const paths = new Set();
        mapA.forEach((_, k) => paths.add(k));
        mapB.forEach((_, k) => paths.add(k));
        const rows = [];
        paths.forEach((path) => {
            const a = mapA.get(path);
            const b = mapB.get(path);
            let status;
            if (a && !b) status = 'removed';
            else if (!a && b) status = 'added';
            else status = 'common'; // resolved by content compare (or metadata fallback)
            rows.push({ path: path, status: status, a: a, b: b });
        });
        rows.sort((x, y) => x.path.localeCompare(y.path));
        return rows;
    }

    // SHA-256 hex of a file's raw bytes.
    function hashUrl(url) {
        return fetch(url, { credentials: 'include' }).then((resp) => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.arrayBuffer();
        }).then((buf) => crypto.subtle.digest('SHA-256', buf).then((digest) => ({
            size: buf.byteLength,
            hash: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
        })));
    }

    // Cheap content size via HEAD (Content-Length). Returns null if unavailable.
    function headSize(url) {
        return fetch(url, { method: 'HEAD', credentials: 'include' }).then((resp) => {
            if (!resp.ok) return null;
            const len = resp.headers.get('content-length');
            return len != null ? parseInt(len, 10) : null;
        }).catch(() => null);
    }

    // Run async tasks with bounded concurrency.
    function runPool(items, worker, concurrency, onTick) {
        return new Promise((resolve) => {
            let idx = 0, active = 0, done = 0;
            const total = items.length;
            if (!total) return resolve();
            function next() {
                while (active < concurrency && idx < total) {
                    const item = items[idx++];
                    active++;
                    Promise.resolve(worker(item)).catch(() => {}).then(() => {
                        active--; done++;
                        if (onTick) onTick(done, total);
                        if (done >= total) resolve(); else next();
                    });
                }
            }
            next();
        });
    }

    // Resolve 'common' rows by comparing ACTUAL content, never changelist numbers.
    // Fast-path: if both sides share the SAME changelist/revision, Perforce
    // guarantees identical content, so mark 'unchanged' with zero network cost.
    // Only files whose changelist differs are HEAD-checked (compare byte size;
    // different size => modified, same size => unchanged unless "verify by hash"
    // is on). Files whose content can't be fetched are marked 'unverified'.
    function compareContents(rows, opts) {
        const commons = rows.filter((r) => r.status === 'common');
        if (!commons.length) return Promise.resolve({ checked: 0, unverified: 0, skipped: 0 });

        const needCheck = [];
        let skipped = 0;
        commons.forEach((r) => {
            const a = r.a, b = r.b;
            const sameCl = a && b && a.changelist && b.changelist && a.changelist === b.changelist;
            const sameRev = a && b && a.revision && b.revision && a.revision === b.revision;
            if (sameCl || sameRev) { r.status = 'unchanged'; r.byMeta = true; skipped++; }
            else needCheck.push(r);
        });

        if (!needCheck.length) return Promise.resolve({ checked: 0, unverified: 0, skipped: skipped });

        let processed = 0, unverified = 0;
        return runPool(needCheck, (r) => {
            const ua = r.a && r.a.rawUrl;
            const ub = r.b && r.b.rawUrl;
            if (!ua || !ub) { r.status = 'unverified'; unverified++; return; }

            return Promise.all([headSize(ua), headSize(ub)]).then(([sa, sb]) => {
                if (sa != null && sb != null) {
                    r.sizeA = sa; r.sizeB = sb;
                    if (sa !== sb) { r.status = 'modified'; return; }
                    if (!opts.verifyHash) { r.status = 'unchanged'; return; }
                    return Promise.all([hashUrl(ua), hashUrl(ub)]).then(([ha, hb]) => {
                        r.status = (ha.hash === hb.hash) ? 'unchanged' : 'modified';
                    });
                }
                // HEAD unavailable → fall back to full-content hash.
                return Promise.all([hashUrl(ua), hashUrl(ub)]).then(([ha, hb]) => {
                    r.status = (ha.size === hb.size && ha.hash === hb.hash) ? 'unchanged' : 'modified';
                    r.sizeA = ha.size; r.sizeB = hb.size;
                });
            }).catch(() => { r.status = 'unverified'; unverified++; });
        }, opts.concurrency || 16, (d) => {
            processed = d;
            if (opts.onProgress) opts.onProgress(d, needCheck.length);
        }).then(() => ({ checked: processed, unverified: unverified, skipped: skipped }));
    }

    // When content comparison is disabled, we genuinely don't know if common
    // files changed (changelist numbers are unreliable across branches), so
    // mark them 'unverified' rather than guessing 'modified'.
    function resolveByMetadata(rows) {
        rows.forEach((r) => { if (r.status === 'common') { r.status = 'unverified'; r.byMeta = true; } });
    }

    // --- Line diff (Myers-style LCS over lines) ---
    function splitLines(text) {
        // Normalize newlines, keep no trailing empty line from a final \n.
        const t = text.replace(/\r\n?/g, '\n');
        const lines = t.split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        return lines;
    }

    function lcsLineDiff(aLines, bLines) {
        const n = aLines.length, m = bLines.length;
        // DP table of LCS lengths. Fine for files up to a few thousand lines.
        const dp = new Array(n + 1);
        for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = (aLines[i] === bLines[j])
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const ops = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (aLines[i] === bLines[j]) {
                ops.push({ type: 'eq', a: i, b: j, text: aLines[i] }); i++; j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                ops.push({ type: 'del', a: i, text: aLines[i] }); i++;
            } else {
                ops.push({ type: 'add', b: j, text: bLines[j] }); j++;
            }
        }
        while (i < n) { ops.push({ type: 'del', a: i, text: aLines[i] }); i++; }
        while (j < m) { ops.push({ type: 'add', b: j, text: bLines[j] }); j++; }
        return ops;
    }

    // --- Panel UI ---
    let panel = null;
    let lastDiff = [];
    let lastDiffOps = null;     // ops from the most recent text diff
    let lastDiffMeta = null;    // { title, aUrl, bUrl }
    let diffContextOnly = false; // collapse unchanged regions when true

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    function buildPanel() {
        if (panel) return panel;
        panel = el('div', 'p4d-panel');

        // Restore saved width.
        const savedW = parseInt(localStorage.getItem('__p4diff_width_px'), 10);
        if (savedW && savedW >= 360) panel.style.width = Math.min(savedW, Math.round(window.innerWidth * 0.96)) + 'px';

        const resizer = el('div', 'p4d-resizer');
        panel.appendChild(resizer);

        const head = el('div', 'p4d-head', '<b>P4 Diff</b>');
        const closeBtn = el('button', null, 'Close');
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        head.appendChild(closeBtn);
        panel.appendChild(head);

        const cur = currentDepotPath();
        const config = el('div', 'p4d-config');
        config.innerHTML =
            '<div class="p4d-field"><label>Path A (folder or file)</label><div class="p4d-inputs">' +
            '<input type="text" class="p4d-a" placeholder="//depot/path/ or //depot/file.ext">' +
            '<input type="text" class="p4d-a-rev p4d-rev" placeholder="rev @ (opt)"></div></div>' +
            '<div class="p4d-field"><label>Path B (folder or file)</label><div class="p4d-inputs">' +
            '<input type="text" class="p4d-b" placeholder="//depot/path/ or //depot/file.ext">' +
            '<input type="text" class="p4d-b-rev p4d-rev" placeholder="rev @ (opt)"></div></div>' +
            '<div class="p4d-opts">' +
            '<label><input type="checkbox" class="p4d-recursive" checked> Recursive</label>' +
            '<label>Max depth <input type="number" class="p4d-depth" value="6" min="1" max="20"></label>' +
            '<label>Max requests <input type="number" class="p4d-maxreq" value="300" min="10" max="3000"></label>' +
            '</div>' +
            '<div class="p4d-opts">' +
            '<label><input type="checkbox" class="p4d-content" checked> Compare file contents</label>' +
            '<label title="Slower: also SHA-256 same-size files to be 100% certain"><input type="checkbox" class="p4d-verifyhash"> Verify by hash</label>' +
            '</div>' +
            '<button class="p4d-go">Compare</button>';
        panel.appendChild(config);

        config.querySelector('.p4d-a').value = cur;
        config.querySelector('.p4d-b').value = cur;

        const filters = el('div', 'p4d-filters');
        filters.innerHTML =
            '<div class="p4d-inputs">' +
            '<input type="text" class="p4d-fpath" placeholder="Filter by path substring\u2026">' +
            '<input type="text" class="p4d-fext" placeholder="Extensions e.g. txt,xml">' +
            '</div>' +
            '<div class="p4d-status-toggles">' +
            '<label><input type="checkbox" class="p4d-s-added" checked><span class="p4d-chip added"></span> Added</label>' +
            '<label><input type="checkbox" class="p4d-s-removed" checked><span class="p4d-chip removed"></span> Removed</label>' +
            '<label><input type="checkbox" class="p4d-s-modified" checked><span class="p4d-chip modified"></span> Modified</label>' +
            '<label><input type="checkbox" class="p4d-s-unverified"><span class="p4d-chip unverified"></span> Unverified</label>' +
            '<label><input type="checkbox" class="p4d-s-unchanged"><span class="p4d-chip unchanged"></span> Unchanged</label>' +
            '</div>';
        panel.appendChild(filters);

        const status = el('div', 'p4d-status', 'Pick two folders or two files, then press Compare. Tip: click a modified file to see line differences.');
        panel.appendChild(status);

        const results = el('div', 'p4d-results');
        panel.appendChild(results);

        // Text-diff overlay (covers the panel body when viewing a file diff).
        const diffView = el('div', 'p4d-diffview');
        diffView.innerHTML =
            '<div class="p4d-diff-head">' +
            '<span class="p4d-diff-title"></span>' +
            '<div class="p4d-diff-actions">' +
            '<button class="p4d-diff-collapse" title="Hide unchanged lines">Collapse</button>' +
            '<button class="p4d-diff-back">\u2190 Back</button>' +
            '</div></div>' +
            '<div class="p4d-diff-summary"></div>' +
            '<div class="p4d-diff-body"></div>';
        panel.appendChild(diffView);
        diffView.querySelector('.p4d-diff-back').addEventListener('click', closeDiffView);
        diffView.querySelector('.p4d-diff-collapse').addEventListener('click', (e) => {
            diffContextOnly = !diffContextOnly;
            e.currentTarget.classList.toggle('is-active', diffContextOnly);
            renderTextDiff();
        });

        document.body.appendChild(panel);
        enablePanelResize(resizer);

        // Wire filters → re-render
        ['.p4d-fpath', '.p4d-fext', '.p4d-s-added', '.p4d-s-removed', '.p4d-s-modified', '.p4d-s-unverified', '.p4d-s-unchanged']
            .forEach((sel) => {
                const node = filters.querySelector(sel);
                node.addEventListener('input', renderResults);
                node.addEventListener('change', renderResults);
            });

        config.querySelector('.p4d-go').addEventListener('click', runCompare);

        return panel;
    }

    function enablePanelResize(resizer) {
        let startX = 0, startW = 0, dragging = false;
        resizer.addEventListener('pointerdown', (e) => {
            dragging = true;
            startX = e.clientX;
            startW = panel.getBoundingClientRect().width;
            resizer.setPointerCapture(e.pointerId);
            resizer.classList.add('dragging');
            e.preventDefault();
        });
        resizer.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            // Panel is anchored right, so dragging left (smaller clientX) widens it.
            const next = Math.max(360, Math.min(startW + (startX - e.clientX), Math.round(window.innerWidth * 0.96)));
            panel.style.width = next + 'px';
        });
        const end = (e) => {
            if (!dragging) return;
            dragging = false;
            resizer.classList.remove('dragging');
            try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
            localStorage.setItem('__p4diff_width_px', String(Math.round(panel.getBoundingClientRect().width)));
        };
        resizer.addEventListener('pointerup', end);
        resizer.addEventListener('pointercancel', end);
    }

    // --- Text diff view ---
    function openDiffView() { panel.querySelector('.p4d-diffview').classList.add('is-on'); }
    function closeDiffView() { panel.querySelector('.p4d-diffview').classList.remove('is-on'); }

    function showFileDiff(aUrl, bUrl, title) {
        openDiffView();
        const body = panel.querySelector('.p4d-diff-body');
        const summary = panel.querySelector('.p4d-diff-summary');
        panel.querySelector('.p4d-diff-title').textContent = title || 'File diff';
        summary.textContent = '';
        body.innerHTML = '<div class="p4d-diff-loading">Loading both revisions\u2026</div>';
        lastDiffOps = null;
        lastDiffMeta = { title: title, aUrl: aUrl, bUrl: bUrl };

        Promise.all([fetchBytes(aUrl), fetchBytes(bUrl)]).then(([ba, bb]) => {
            const ua = new Uint8Array(ba), ub = new Uint8Array(bb);
            // Binary files (xlsx, zip, bin, images, etc.) can't be line-diffed
            // meaningfully — show a byte-level summary instead of fake line changes.
            if (isBinaryBytes(ua) || isBinaryBytes(ub) || isBinaryName(title)) {
                renderBinarySummary(ua, ub);
                return;
            }
            const dec = new TextDecoder('utf-8', { fatal: false });
            lastDiffOps = lcsLineDiff(splitLines(dec.decode(ba)), splitLines(dec.decode(bb)));
            renderTextDiff();
        }).catch((err) => {
            body.innerHTML = '<div class="p4d-diff-loading">Error loading file contents: ' +
                String(err && err.message ? err.message : err) + '</div>';
        });
    }

    function fetchBytes(url) {
        return fetch(url, { credentials: 'include' }).then((resp) => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.arrayBuffer();
        });
    }

    function isBinaryName(name) {
        return /\.(xlsx?|xlsm|docx?|pptx?|zip|rar|7z|gz|tar|bin|raw|llb|exe|dll|png|jpe?g|gif|bmp|ico|pdf|lvproj|vi|ctl|lvclass)$/i.test(String(name || ''));
    }

    function isBinaryBytes(bytes) {
        const n = Math.min(bytes.length, 8000);
        let nonText = 0;
        for (let i = 0; i < n; i++) {
            const c = bytes[i];
            if (c === 0) return true;                 // NUL → definitely binary
            if (c < 9 || (c > 13 && c < 32)) nonText++;
        }
        return n > 0 && (nonText / n) > 0.1;
    }

    function bytesEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    function fmtBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function renderBinarySummary(ua, ub) {
        const body = panel.querySelector('.p4d-diff-body');
        const summary = panel.querySelector('.p4d-diff-summary');
        const same = bytesEqual(ua, ub);
        summary.innerHTML = same
            ? 'Binary file \u2014 <span class="add">identical</span> (' + fmtBytes(ua.length) + ')'
            : 'Binary file \u2014 <span class="del">differs</span>';
        if (same) {
            body.innerHTML = '<div class="p4d-diff-loading">These two binary files are byte-for-byte identical.</div>';
        } else {
            const delta = ub.length - ua.length;
            const deltaStr = (delta === 0 ? 'same size' : (delta > 0 ? '+' : '\u2212') + fmtBytes(Math.abs(delta)));
            body.innerHTML = '<div class="p4d-diff-loading">' +
                'Binary file content differs. A line-by-line diff is not available for this file type.<br><br>' +
                'Size A: <b>' + fmtBytes(ua.length) + '</b><br>' +
                'Size B: <b>' + fmtBytes(ub.length) + '</b> (' + deltaStr + ')' +
                '</div>';
        }
    }

    function renderTextDiff() {
        const body = panel.querySelector('.p4d-diff-body');
        const summary = panel.querySelector('.p4d-diff-summary');
        if (!lastDiffOps) return;

        const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let adds = 0, dels = 0;
        lastDiffOps.forEach((o) => { if (o.type === 'add') adds++; else if (o.type === 'del') dels++; });

        if (!adds && !dels) {
            summary.innerHTML = 'Files are identical.';
            body.innerHTML = '<div class="p4d-diff-loading">No differences.</div>';
            return;
        }
        summary.innerHTML = '<span class="add">+' + adds + '</span> / <span class="del">-' + dels + '</span> lines';

        const CONTEXT = 3;
        let visible = lastDiffOps.map(() => true);
        if (diffContextOnly) {
            visible = lastDiffOps.map(() => false);
            lastDiffOps.forEach((o, i) => {
                if (o.type !== 'eq') {
                    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lastDiffOps.length - 1, i + CONTEXT); k++) visible[k] = true;
                }
            });
        }

        let html = '<table>';
        let lastWasGap = false;
        for (let i = 0; i < lastDiffOps.length; i++) {
            if (!visible[i]) {
                if (!lastWasGap) { html += '<tr class="hunk"><td class="ln">\u22EF</td><td class="ln">\u22EF</td><td class="sign"></td><td>\u22EF unchanged \u22EF</td></tr>'; lastWasGap = true; }
                continue;
            }
            lastWasGap = false;
            const o = lastDiffOps[i];
            const aN = (o.a != null) ? (o.a + 1) : '';
            const bN = (o.b != null) ? (o.b + 1) : '';
            const cls = o.type === 'add' ? 'add' : (o.type === 'del' ? 'del' : 'eq');
            const sign = o.type === 'add' ? '+' : (o.type === 'del' ? '\u2212' : '');
            html += '<tr class="' + cls + '">' +
                '<td class="ln">' + aN + '</td>' +
                '<td class="ln">' + bN + '</td>' +
                '<td class="sign">' + sign + '</td>' +
                '<td>' + esc(o.text) + '</td></tr>';
        }
        html += '</table>';
        body.innerHTML = html;
    }


    function runCompare() {
        const goBtn = panel.querySelector('.p4d-go');
        const status = panel.querySelector('.p4d-status');
        const aPath = panel.querySelector('.p4d-a').value.trim();
        const bPath = panel.querySelector('.p4d-b').value.trim();
        const aRev = panel.querySelector('.p4d-a-rev').value.trim();
        const bRev = panel.querySelector('.p4d-b-rev').value.trim();
        const recursive = panel.querySelector('.p4d-recursive').checked;
        const maxDepth = parseInt(panel.querySelector('.p4d-depth').value, 10) || 6;
        const maxRequests = parseInt(panel.querySelector('.p4d-maxreq').value, 10) || 300;
        const compareContent = panel.querySelector('.p4d-content').checked;
        const verifyHash = panel.querySelector('.p4d-verifyhash').checked;

        if (!aPath || !bPath) { status.textContent = 'Both Directory A and B are required.'; return; }

        // File-vs-file mode: both paths look like files → show a line diff directly.
        if (looksLikeFile(aPath) && looksLikeFile(bPath)) {
            let aFileUrl = depotToFileUrl(aPath);
            let bFileUrl = depotToFileUrl(bPath);
            if (aRev) { const u = new URL(aFileUrl); u.searchParams.set('revision_at', aRev); aFileUrl = u.href; }
            if (bRev) { const u = new URL(bFileUrl); u.searchParams.set('revision_at', bRev); bFileUrl = u.href; }
            const aName = aPath.split('/').filter(Boolean).pop();
            const bName = bPath.split('/').filter(Boolean).pop();
            showFileDiff(rawUrlFor(aFileUrl), rawUrlFor(bFileUrl), aName === bName ? aName : (aName + ' \u2194 ' + bName));
            return;
        }

        goBtn.disabled = true;
        lastDiff = [];
        panel.querySelector('.p4d-results').innerHTML = '';
        panel.querySelector('.p4d-filters').classList.remove('is-on');

        const aUrl = depotToBrowserUrl(aPath);
        const bUrl = depotToBrowserUrl(bPath);
        const optsBase = { recursive: recursive, maxDepth: maxDepth, maxRequests: maxRequests };

        status.textContent = 'Scanning A & B\u2026';
        let scannedA = 0, scannedB = 0;
        const updateScan = () => { status.textContent = 'Scanning A (' + scannedA + ') & B (' + scannedB + ')\u2026'; };
        Promise.all([
            walkTree(aUrl, Object.assign({}, optsBase, {
                revisionAt: aRev || null,
                onProgress: (n) => { scannedA = n; updateScan(); }
            })),
            walkTree(bUrl, Object.assign({}, optsBase, {
                revisionAt: bRev || null,
                onProgress: (n) => { scannedB = n; updateScan(); }
            }))
        ]).then(([resA, resB]) => {
            lastDiff = diffTrees(resA.files, resB.files);
            const capNote = (resA.capped || resB.capped)
                ? ' \u26A0 Request cap hit \u2014 results may be partial (raise Max requests).' : '';

            const finish = (contentNote) => {
                const counts = { added: 0, removed: 0, modified: 0, unchanged: 0, unverified: 0, common: 0 };
                lastDiff.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
                let msg = resA.files.length + ' files in A, ' + resB.files.length + ' in B \u2014 ' +
                    counts.added + ' added, ' + counts.removed + ' removed, ' +
                    counts.modified + ' modified, ' + counts.unchanged + ' unchanged';
                if (counts.unverified) msg += ', ' + counts.unverified + ' unverified';
                msg += '.' + (contentNote || '') + capNote;
                status.textContent = msg;
                panel.querySelector('.p4d-filters').classList.add('is-on');
                renderResults();
            };

            if (compareContent) {
                status.textContent = 'Comparing file contents\u2026';
                return compareContents(lastDiff, {
                    verifyHash: verifyHash,
                    concurrency: 16,
                    onProgress: (d, t) => { status.textContent = 'Comparing contents ' + d + '/' + t + '\u2026'; }
                }).then((info) => {
                    let note = '';
                    if (info.skipped) note += ' (' + info.skipped + ' matched by changelist \u2014 skipped fetch)';
                    if (info.unverified) note += ' (\u26A0 ' + info.unverified + ' files could not be content-checked \u2014 marked unverified.)';
                    finish(note);
                });
            }
            resolveByMetadata(lastDiff);
            finish(' (content not compared \u2014 common files marked unverified)');
        }).catch((err) => {
            log('compare error', err);
            status.textContent = 'Error: ' + (err && err.message ? err.message : err);
        }).then(() => { goBtn.disabled = false; });
    }

    function renderResults() {
        const results = panel.querySelector('.p4d-results');
        const fpath = (panel.querySelector('.p4d-fpath').value || '').trim().toLowerCase();
        const extRaw = (panel.querySelector('.p4d-fext').value || '').trim().toLowerCase();
        const exts = extRaw ? extRaw.split(/[,\s]+/).filter(Boolean).map((e) => e.replace(/^\./, '')) : [];
        const show = {
            added: panel.querySelector('.p4d-s-added').checked,
            removed: panel.querySelector('.p4d-s-removed').checked,
            modified: panel.querySelector('.p4d-s-modified').checked,
            unverified: panel.querySelector('.p4d-s-unverified').checked,
            unchanged: panel.querySelector('.p4d-s-unchanged').checked
        };

        const rows = lastDiff.filter((r) => {
            if (!show[r.status]) return false;
            if (fpath && r.path.toLowerCase().indexOf(fpath) === -1) return false;
            if (exts.length && exts.indexOf(fileExt(r.path)) === -1) return false;
            return true;
        });

        if (!rows.length) {
            results.innerHTML = '<div class="p4d-empty">No entries match the current filters.</div>';
            return;
        }

        const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        let html = '<table><thead><tr><th>Status</th><th>Path</th><th>A</th><th>B</th></tr></thead><tbody>';
        rows.forEach((r) => {
            const aCell = r.a
                ? '<a href="' + esc(r.a.url) + '" target="_blank" rel="noopener">' + esc(r.a.changelist ? '@' + r.a.changelist : (r.a.revision ? '#' + r.a.revision : 'view')) + '</a>'
                : '\u2014';
            const bCell = r.b
                ? '<a href="' + esc(r.b.url) + '" target="_blank" rel="noopener">' + esc(r.b.changelist ? '@' + r.b.changelist : (r.b.revision ? '#' + r.b.revision : 'view')) + '</a>'
                : '\u2014';
            const idx = lastDiff.indexOf(r);
            const clickable = !!(r.a && r.b && r.a.rawUrl && r.b.rawUrl);
            html += '<tr class="' + r.status + (clickable ? ' clickable' : '') + '"' +
                (clickable ? ' data-idx="' + idx + '" title="Click to view line differences"' : '') + '>' +
                '<td class="tag">' + r.status + (r.byMeta ? ' ~' : '') + '</td>' +
                '<td class="path">' + esc(r.path) + '</td>' +
                '<td>' + aCell + '</td>' +
                '<td>' + bCell + '</td></tr>';
        });
        html += '</tbody></table>';
        results.innerHTML = html;

        results.querySelectorAll('tr.clickable').forEach((tr) => {
            tr.addEventListener('click', (e) => {
                if (e.target.tagName === 'A') return; // let the view links work normally
                const r = lastDiff[parseInt(tr.getAttribute('data-idx'), 10)];
                if (r && r.a && r.b) showFileDiff(r.a.rawUrl, r.b.rawUrl, r.path);
            });
        });
    }

    function openPanel() {
        buildPanel();
        panel.style.display = 'flex';
    }

    function setSide(side, depotPath) {
        openPanel();
        panel.querySelector(side === 'A' ? '.p4d-a' : '.p4d-b').value = depotPath;
        const status = panel.querySelector('.p4d-status');
        status.textContent = 'Set Directory ' + side + ' = ' + depotPath;
    }

    // --- Inject A/B buttons on directory rows + launcher ---
    function injectRowButtons() {
        const cells = document.querySelectorAll('table.listing tr.item:not(.parent_dir) td.directory');
        cells.forEach((cell) => {
            if (cell.dataset.p4dProcessed) return;
            const a = cell.querySelector('a');
            if (!a) return;
            const text = (a.textContent || '').trim();
            if (!text || text === './' || text === '../') return;
            const depot = browserUrlToDepot(new URL(a.getAttribute('href') || '', window.location.href).href);
            if (!depot) return;
            cell.dataset.p4dProcessed = 'true';

            const aBtn = el('button', 'p4d-row-btn', 'A');
            aBtn.title = 'Set as Directory A to compare';
            aBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setSide('A', depot); });
            const bBtn = el('button', 'p4d-row-btn', 'B');
            bBtn.title = 'Set as Directory B to compare';
            bBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setSide('B', depot); });
            cell.appendChild(aBtn);
            cell.appendChild(bBtn);
        });
    }

    function injectLauncher() {
        if (document.querySelector('.p4d-launch')) return;
        const btn = el('button', 'p4d-launch', '\u21C4 Compare Dirs');
        btn.title = 'Open the P4 directory diff viewer';
        btn.addEventListener('click', openPanel);
        document.body.appendChild(btn);
    }

    function init() {
        if (!document.body) return;
        injectLauncher();
        injectRowButtons();
    }

    init();
    log('loaded on', window.location.href);
})();
