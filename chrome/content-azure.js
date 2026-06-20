// content-azure.js — Runs first-party on dev.azure.com (Azure DevOps).
//
// The Agile-side "Current Status" dashboard opens a hidden iframe to the
// DevCentral project with a marker hash:
//
//   https://dev.azure.com/ni/DevCentral/#__azure_status=<token>|<part>
//
// Running first-party means the Azure DevOps session cookie IS sent, so this
// script can call the documented REST APIs to find work items that reference
// the part, read their fields + discussion, and postMessage the result back
// to the agile.natinst.com parent window.
//
// Matching strategy: use the full-text Search API (almsearch) first — that is
// what the _search UI uses, so it catches a part mentioned anywhere, including
// inside a comment / discussion. If search is unavailable we fall back to a
// WIQL CONTAINS over Title / Description / Tags (which can miss comment-only
// mentions).

(function () {
    'use strict';

    var PARENT_ORIGIN = 'https://agile.natinst.com';
    var ORG = 'ni';
    var PROJECT = 'DevCentral';
    var API = '7.0';

    // States that count as "closed" / done.
    var CLOSED_STATES = ['closed', 'done', 'removed', 'resolved', 'completed'];

    var m = /#__azure_status=([^|]+)\|(.+)$/.exec(window.location.hash || '');
    if (!m) return;

    var token = m[1];
    var partNumber = '';
    try { partNumber = decodeURIComponent(m[2]); } catch (_) { partNumber = m[2]; }
    partNumber = (partNumber || '').trim();

    function reply(payload) {
        payload.__partStatus = token;
        payload.source = 'azure';
        try {
            window.parent.postMessage(payload, PARENT_ORIGIN);
        } catch (_) { /* parent gone */ }
    }

    // Escape single quotes for the WIQL string literal.
    function wiqlLiteral(s) {
        return String(s).replace(/'/g, "''");
    }

    function apiUrl(path) {
        return 'https://dev.azure.com/' + ORG + '/' + path;
    }

    // A JSON fetch that treats a login redirect / non-JSON body as a sign-in
    // failure rather than throwing an opaque parse error.
    function fetchJson(url, options) {
        options = options || {};
        options.credentials = 'include';
        options.headers = options.headers || {};
        options.headers['Accept'] = 'application/json';
        return fetch(url, options).then(function (res) {
            var ct = res.headers.get('content-type') || '';
            if (res.status === 401 || res.status === 403 || res.status === 302 ||
                res.status === 203 || ct.indexOf('application/json') === -1) {
                var err = new Error('signin');
                err.code = 'signin';
                throw err;
            }
            if (!res.ok) {
                var e2 = new Error('HTTP ' + res.status);
                e2.code = 'http';
                throw e2;
            }
            return res.json();
        });
    }

    function stripHtml(html) {
        var div = document.createElement('div');
        div.innerHTML = html || '';
        var text = (div.textContent || div.innerText || '');
        // Drop Azure identity mention tokens like "@<8A083FAB-EA50-...>".
        text = text.replace(/@<[^>]*>/g, '');
        return text.replace(/\s+/g, ' ').trim();
    }

    // --- Step 1: resolve the set of work-item IDs that reference the part. ---

    // Full-text search (catches comments / discussion). almsearch lives on its
    // own host. Returns a list of numeric IDs.
    function searchIds() {
        var url = 'https://almsearch.dev.azure.com/' + ORG + '/' + PROJECT +
            '/_apis/search/workitemsearchresults?api-version=' + API;
        var body = {
            searchText: partNumber,
            '$top': 50,
            '$skip': 0,
            filters: { 'System.TeamProject': [PROJECT] }
        };
        return fetchJson(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (data) {
            var results = (data && data.results) || [];
            var ids = results.map(function (r) {
                var f = r.fields || {};
                // Search field keys are lower-cased.
                return parseInt(f['system.id'], 10);
            }).filter(function (n) { return !isNaN(n); });
            return ids;
        });
    }

    // WIQL fallback over the structured fields.
    function wiqlIds() {
        var part = wiqlLiteral(partNumber);
        var wiql = {
            query:
                "SELECT [System.Id] FROM workitems WHERE " +
                "[System.TeamProject] = '" + wiqlLiteral(PROJECT) + "' AND (" +
                "[System.Title] CONTAINS '" + part + "' OR " +
                "[System.Description] CONTAINS '" + part + "' OR " +
                "[System.Tags] CONTAINS '" + part + "'" +
                ") ORDER BY [System.ChangedDate] DESC"
        };
        return fetchJson(
            apiUrl(PROJECT + '/_apis/wit/wiql?api-version=' + API),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wiql)
            }
        ).then(function (data) {
            return (data.workItems || []).map(function (w) { return w.id; });
        });
    }

    // Try search first; fall back to WIQL on a non-signin error. A signin
    // error propagates so the dashboard can prompt the user to log in.
    function resolveIds() {
        return searchIds().catch(function (err) {
            if (err && err.code === 'signin') throw err;
            return wiqlIds();
        });
    }

    // --- Step 2: fetch full fields for the matched items. ---

    function fetchItems(ids) {
        ids = ids.slice(0, 50);
        var fields = [
            'System.Id', 'System.Title', 'System.State', 'System.WorkItemType',
            'System.AssignedTo', 'System.ChangedDate', 'System.CreatedDate',
            'System.Tags', 'System.Description',
            'Microsoft.VSTS.Common.AcceptanceCriteria',
            'Microsoft.VSTS.TCM.ReproSteps'
        ].join(',');
        return fetchJson(
            apiUrl('_apis/wit/workitems?ids=' + ids.join(',') +
                '&fields=' + encodeURIComponent(fields) +
                '&api-version=' + API)
        ).then(function (wi) {
            return (wi.value || []).map(function (item) {
                var f = item.fields || {};
                var assigned = f['System.AssignedTo'];
                var assignedName = (assigned && (assigned.displayName || assigned.uniqueName)) || '';
                var state = f['System.State'] || '';
                return {
                    id: item.id,
                    title: f['System.Title'] || '',
                    state: state,
                    type: f['System.WorkItemType'] || '',
                    assignedTo: assignedName,
                    changedDate: f['System.ChangedDate'] || '',
                    createdDate: f['System.CreatedDate'] || '',
                    tags: f['System.Tags'] || '',
                    description: stripHtml(f['System.Description'] || ''),
                    acceptanceCriteria: stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
                    reproSteps: stripHtml(f['Microsoft.VSTS.TCM.ReproSteps'] || ''),
                    closed: CLOSED_STATES.indexOf(state.toLowerCase()) !== -1
                };
            });
        });
    }

    // --- Step 3: pull discussion comments for every matched item. ---

    function fetchComments(items) {
        // Read the discussion for each item (cap to keep request volume sane).
        var targets = items.slice(0, 15);
        var fetches = targets.map(function (it) {
            return fetchJson(
                apiUrl(PROJECT + '/_apis/wit/workItems/' + it.id +
                    '/comments?$top=20&api-version=' + API + '-preview.3')
            ).then(function (c) {
                it.comments = (c.comments || []).map(function (cm) {
                    return {
                        text: stripHtml(cm.text || ''),
                        by: (cm.createdBy && cm.createdBy.displayName) || '',
                        date: cm.createdDate || ''
                    };
                });
            }).catch(function () {
                it.comments = [];
            });
        });
        return Promise.all(fetches).then(function () { return items; });
    }

    // --- Orchestrate. ---

    resolveIds().then(function (ids) {
        if (!ids || !ids.length) {
            reply({ ok: true, items: [], openCount: 0, closedCount: 0 });
            return null;
        }
        return fetchItems(ids).then(fetchComments).then(function (items) {
            // Most-recently-changed first.
            items.sort(function (a, b) {
                return (b.changedDate || '').localeCompare(a.changedDate || '');
            });
            var open = items.filter(function (it) { return !it.closed; });
            reply({
                ok: true,
                items: items,
                openCount: open.length,
                closedCount: items.length - open.length
            });
        });
    }).catch(function (err) {
        reply({
            ok: false,
            error: (err && err.code) || 'error',
            message: (err && err.code === 'signin')
                ? 'Not signed in to Azure DevOps (dev.azure.com).'
                : 'Azure DevOps query failed: ' + (err && err.message ? err.message : err)
        });
    });
})();
