// content-mvdb.js — Runs first-party on apex.natinst.com (MVDB / Oracle APEX).
//
// The Agile-side "Current Status" dashboard can't read MVDB directly: a
// background fetch is cross-site and the browser withholds APEX's SameSite
// session cookies (same 401 problem ECHO has). Instead the dashboard opens a
// hidden iframe to the MVDB Interactive Report, filtered to the part, with a
// marker hash:
//
//   https://apex.natinst.com/apexp/f?p=NIMFG_MVDB_APP:1:0:::RIR:IR_ROWFILTER:<part>&c=NIAPEX#__mvdb_status=<token>|<part>
//
// This script (running first-party, so cookies ARE sent) waits for the report
// grid to render, scrapes the row for the part, and postMessages the parsed
// fields back to the agile.natinst.com parent window.

(function () {
    'use strict';

    var PARENT_ORIGIN = 'https://agile.natinst.com';

    // Only act when the dashboard marker is present; otherwise this is a normal
    // APEX page visit and we do nothing.
    var m = /#__mvdb_status=([^|]+)\|(.+)$/.exec(window.location.hash || '');
    if (!m) return;

    var token = m[1];
    var partNumber = '';
    try { partNumber = decodeURIComponent(m[2]); } catch (_) { partNumber = m[2]; }
    partNumber = (partNumber || '').trim();

    function reply(payload) {
        payload.__partStatus = token;
        payload.source = 'mvdb';
        try {
            window.parent.postMessage(payload, PARENT_ORIGIN);
        } catch (_) { /* parent gone */ }
    }

    function norm(s) {
        return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // Clean a scraped cell: collapse whitespace and drop Azure-style identity
    // mention tokens such as "@<8A083FAB-EA50-...>" that leak into text.
    function cleanCell(s) {
        return String(s == null ? '' : s)
            .replace(/@<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Clean a header label: collapse whitespace and strip sort/menu glyphs.
    function cleanHeader(s) {
        return cleanCell(s)
            .replace(/[\u25B2\u25BC\u25B3\u25BD\u2191\u2193]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Find the header row (a <tr> whose <th> cells include both a "phase" and a
    // "goal run" column). APEX Interactive Reports sometimes split the header
    // and the data into two separate <table>s, so we locate the header row on
    // its own and resolve the data rows separately.
    function findHeaderRow() {
        var rows = document.querySelectorAll('tr');
        for (var i = 0; i < rows.length; i++) {
            var ths = rows[i].querySelectorAll('th');
            if (ths.length < 2) continue;
            var hasPhase = false;
            var hasGoal = false;
            for (var j = 0; j < ths.length; j++) {
                var t = norm(ths[j].textContent);
                if (t.indexOf('phase') !== -1) hasPhase = true;
                if (t.indexOf('goal run') !== -1) hasGoal = true;
            }
            if (hasPhase && hasGoal) return rows[i];
        }
        return null;
    }

    // Build header maps from the header row. APEX gives each <th> an id, and
    // each data <td> a matching `headers="<id>"` attribute — using that to
    // align cells avoids the column-offset mismapping that a positional scan
    // produces when data rows have extra/hidden cells.
    function buildHeaderMaps(headerRow) {
        var ths = headerRow.querySelectorAll('th');
        var byId = {};
        var byIndex = [];
        for (var i = 0; i < ths.length; i++) {
            var label = cleanHeader(ths[i].textContent);
            byIndex.push(label);
            if (ths[i].id) byId[ths[i].id] = label;
        }
        return { byId: byId, byIndex: byIndex, count: ths.length };
    }

    // Resolve the data rows. Prefer the header row's own table; if that table
    // has no <td> rows (split header/data layout), search the whole document
    // for rows whose <td> count is comparable to the header column count.
    function findDataRows(headerRow, colCount) {
        var table = headerRow.closest ? headerRow.closest('table') : null;
        var rows = [];
        if (table) {
            var trs = table.querySelectorAll('tbody tr, tr');
            for (var i = 0; i < trs.length; i++) {
                if (trs[i].querySelectorAll('td').length) rows.push(trs[i]);
            }
        }
        if (rows.length) return rows;

        // Split-table fallback: any row with a comparable number of <td> cells.
        var all = document.querySelectorAll('tr');
        var out = [];
        for (var r = 0; r < all.length; r++) {
            var tds = all[r].querySelectorAll('td');
            if (tds.length && tds.length >= Math.max(2, colCount - 2)) out.push(all[r]);
        }
        return out;
    }

    // Parse a data row into an ordered list of { label, value } fields, using
    // each cell's `headers` attribute to find its true column label, falling
    // back to positional index.
    function parseRowFull(rowEl, maps) {
        var cells = rowEl.querySelectorAll('td');
        var fields = [];
        for (var c = 0; c < cells.length; c++) {
            var cell = cells[c];
            var label = '';
            var hdr = cell.getAttribute && cell.getAttribute('headers');
            if (hdr) {
                var ids = hdr.split(/\s+/);
                for (var k = ids.length - 1; k >= 0; k--) {
                    if (maps.byId[ids[k]]) { label = maps.byId[ids[k]]; break; }
                }
            }
            if (!label && maps.byIndex[c]) label = maps.byIndex[c];
            var value = cleanCell(cell.textContent);
            if (label) fields.push({ label: label, value: value });
        }
        return fields;
    }

    // Pull the value of the first field whose label loosely matches an alias.
    function pick(fields, aliases) {
        for (var i = 0; i < fields.length; i++) {
            var n = norm(fields[i].label);
            for (var a = 0; a < aliases.length; a++) {
                if (n === aliases[a] || n.indexOf(aliases[a]) !== -1) return fields[i].value;
            }
        }
        return '';
    }

    // Extract the well-known fields used by the badge / summary.
    function keyFields(fields) {
        return {
            assemblyPn: pick(fields, ['assembly pn', 'assembly p/n', 'assemblypn', 'part number', 'part no']),
            assemblyDescription: pick(fields, ['assembly description', 'description']),
            entryStatus: pick(fields, ['entry status']),
            phase: pick(fields, ['phase']),
            goalRunDate: pick(fields, ['goal run date', 'goal run']),
            jobQty: pick(fields, ['job qty', 'job quantity']),
            daysSinceHandoff: pick(fields, ['days since handoff', 'days since']),
            docId: pick(fields, ['doc id', 'document id']),
            docType: pick(fields, ['doctype', 'doc type', 'doc type code', 'document type'])
        };
    }

    // Find the most relevant link for a data row so the dashboard can open the
    // MVDB document/detail. Prefer an anchor in the Doc ID cell, else the first
    // anchor with a real href in the row.
    function rowLink(rowEl) {
        var anchors = rowEl.querySelectorAll('a[href]');
        for (var i = 0; i < anchors.length; i++) {
            if (isRealHref(anchors[i].getAttribute('href'))) return anchors[i].href;
        }
        return '';
    }

    function isRealHref(href) {
        if (!href) return false;
        var h = href.trim().toLowerCase();
        return h.indexOf('javascript:') !== 0 && h !== '#' && h.indexOf('#') !== 0;
    }

    function fieldsHaveData(fields) {
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].value) return true;
        }
        return false;
    }

    // Only these columns are worth sending to the dashboard (matched loosely by
    // header label). Everything else is dropped so we don't absorb the whole
    // wide MVDB report.
    var DISPLAY_ALIASES = [
        'phase', 'entry status', 'goal run', 'days since handoff', 'days since',
        'job qty', 'job quantity', 'doctype', 'doc type', 'finish date'
    ];

    function isDisplayField(label) {
        var n = norm(label);
        for (var i = 0; i < DISPLAY_ALIASES.length; i++) {
            if (n.indexOf(DISPLAY_ALIASES[i]) !== -1) return true;
        }
        return false;
    }

    // Scrape: find header row -> header maps -> ALL data rows that have content.
    // Returns undefined while the grid hasn't rendered, null when headers exist
    // but there are no data rows, or an array of row objects otherwise.
    function scrape() {
        var headerRow = findHeaderRow();
        if (!headerRow) return undefined; // grid not rendered yet

        var maps = buildHeaderMaps(headerRow);
        if (!maps.count) return undefined;

        var dataRows = findDataRows(headerRow, maps.count);
        if (!dataRows.length) return null; // headers but no data rows

        var rows = [];
        for (var r = 0; r < dataRows.length; r++) {
            if (!dataRows[r].querySelectorAll('td').length) continue;
            var fields = parseRowFull(dataRows[r], maps);
            if (!fieldsHaveData(fields)) continue;
            // key is computed from the full row (needs assemblyPn/docId), but
            // only the necessary display fields are kept/sent.
            var key = keyFields(fields);
            var trimmed = fields.filter(function (f) {
                return f.value && isDisplayField(f.label);
            });
            rows.push({
                fields: trimmed,
                key: key,
                link: rowLink(dataRows[r])
            });
        }
        if (!rows.length) return null;

        // Put any exact part-number match first.
        if (partNumber) {
            rows.sort(function (a, b) {
                var am = a.key.assemblyPn && norm(a.key.assemblyPn) === norm(partNumber) ? 0 : 1;
                var bm = b.key.assemblyPn && norm(b.key.assemblyPn) === norm(partNumber) ? 0 : 1;
                return am - bm;
            });
        }
        return rows;
    }

    // "No data found" detection for parts that aren't in MVDB.
    function looksEmpty() {
        var txt = norm(document.body ? document.body.textContent : '');
        return txt.indexOf('no data found') !== -1 ||
            txt.indexOf('no matching') !== -1;
    }

    var DEADLINE = Date.now() + 30000; // up to 30s for the grid to render
    var poll = setInterval(function () {
        var rows = scrape();
        if (rows && rows.length) {
            clearInterval(poll);
            // Reply with all rows; keep `data` (first row) for compatibility.
            reply({ ok: true, rows: rows, data: rows[0] });
            return;
        }
        // Headers rendered but the part has no data row.
        if (rows === null && looksEmpty()) {
            clearInterval(poll);
            reply({ ok: true, rows: [], data: null, empty: true });
            return;
        }
        if (looksEmpty() && Date.now() > DEADLINE - 27000) {
            // Grid rendered but no rows for this part.
            clearInterval(poll);
            reply({ ok: true, rows: [], data: null, empty: true });
            return;
        }
        if (Date.now() > DEADLINE) {
            clearInterval(poll);
            // If we never found the header row, the page may have bounced to a
            // login, or the report markup differs from what we expect.
            var signedOut = !findHeaderRow() &&
                /sign in|log in|login|password/i.test(
                    (document.body && document.body.textContent) || '');
            reply({
                ok: false,
                error: signedOut ? 'signin' : 'timeout',
                message: signedOut
                    ? 'Not signed in to MVDB (apex.natinst.com).'
                    : 'MVDB report did not load in time.'
            });
        }
    }, 600);
})();
