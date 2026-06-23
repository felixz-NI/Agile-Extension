// content-main.js — Runs on top-level agile.natinst.com pages at document_idle.
// Adds Preview buttons next to supported file links, opens a sidebar panel,
// and submits the form to an iframe where content-iframe.js handles the rest.

(function () {
    'use strict';

    const DEBUG = true;
    function log(...args) {
        if (DEBUG) console.log('[Preview Pane]', ...args);
    }

    const PREVIEW_FLAG = '__preview_pane_active';
    // Chrome/Edge load the bounce iframe + run MAIN-world hooks at document_start
    // a beat after we submit; keep the preview flag set this long so the hooks
    // see it. (Firefox clears it after 2s; MV3 needs a little longer.)
    const PREVIEW_FLAG_FALLBACK_CLEAR_MS = 15000;

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
        .partnum-hwt-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 6px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            background: #03b585;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            vertical-align: middle;
            text-decoration: none;
            line-height: 1.4;
        }
        .partnum-hwt-btn:hover {
            background: #029e74;
        }
        .partnum-hwt-wrap {
            position: relative;
            display: inline-block;
            vertical-align: middle;
        }
        .partnum-hwt-menu {
            display: none;
            position: fixed;
            z-index: 2147483647;
            min-width: 190px;
            padding: 4px;
            background: #ffffff;
            border: 1px solid #d0d0d0;
            border-radius: 6px;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        }
        .partnum-hwt-menu.open {
            display: block;
        }
        .partnum-hwt-menu-item {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 1px;
            width: 100%;
            padding: 6px 10px;
            background: transparent;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-align: left;
        }
        .partnum-hwt-menu-item:hover {
            background: #f0eaf9;
        }
        .partnum-hwt-menu-item .hwt-mi-label {
            font-size: 12px;
            font-weight: 600;
            color: #2a2a2a;
        }
        .partnum-hwt-menu-item .hwt-mi-desc {
            font-size: 10px;
            font-weight: 400;
            color: #7a7a7a;
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
        .p4v-diff-btn {
            display: inline-block;
            margin-top: 0;
            margin-left: 6px;
            color: #fff;
            background: #7a5cff;
        }
        .p4v-diff-btn:hover {
            background: #6344e6;
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
        .partstatus-btn {
            position: fixed;
            right: 18px;
            top: 50px;
            z-index: 1000001;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 9px;
            font-size: 11px;
            font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            background: #2e7d32;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            box-shadow: 0 1px 5px rgba(0,0,0,0.22);
            transition: background 0.15s ease, transform 0.1s ease;
            white-space: nowrap;
        }
        .partstatus-btn:hover {
            background: #25642a;
        }
        .partstatus-btn:active {
            transform: translateY(1px);
        }
        .partstatus-btn svg {
            width: 13px;
            height: 13px;
            display: block;
        }
        body:has(.preview-panel) .partstatus-btn {
            display: none !important;
        }
        /* --- Compare revisions --- */
        .revcompare-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 8px;
            padding: 2px 9px;
            font-size: 12px;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            background: #6a4c93;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            vertical-align: middle;
        }
        .revcompare-btn:hover { background: #573c7c; }
        .revdiff {
            padding: 14px 16px 28px;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #263238;
            overflow: auto;
            height: 100%;
            box-sizing: border-box;
        }
        .revdiff-pickers {
            display: flex;
            align-items: flex-end;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 14px;
        }
        .revdiff-pickers label {
            display: flex;
            flex-direction: column;
            font-size: 12px;
            font-weight: 600;
            gap: 3px;
        }
        .revdiff-pickers select {
            font-size: 13px;
            padding: 4px 6px;
            min-width: 180px;
            max-width: 280px;
        }
        .revdiff-go {
            padding: 6px 14px;
            font-size: 13px;
            font-weight: 600;
            color: #fff;
            background: #6a4c93;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .revdiff-go:hover { background: #573c7c; }
        .revdiff-toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 4px 0 12px;
            font-size: 12px;
        }
        .revdiff-toolbar label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
        .revdiff-legend { display: inline-flex; gap: 10px; margin-left: auto; }
        .revdiff-legend span { display: inline-flex; align-items: center; gap: 4px; }
        .revdiff-chip { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
        .revdiff-chip.added { background: #c8e6c9; border: 1px solid #66bb6a; }
        .revdiff-chip.removed { background: #ffcdd2; border: 1px solid #ef5350; }
        .revdiff-chip.changed { background: #fff3c4; border: 1px solid #fbc02d; }
        .revdiff table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .revdiff th {
            text-align: left;
            padding: 6px 8px;
            background: #f0eef5;
            border-bottom: 2px solid #d6cfe4;
            position: sticky;
            top: 0;
        }
        .revdiff td {
            padding: 5px 8px;
            border-bottom: 1px solid #eceff1;
            vertical-align: top;
            word-break: break-word;
        }
        .revdiff td.revdiff-field { font-weight: 600; width: 26%; }
        .revdiff tr.added { background: #e8f5e9; }
        .revdiff tr.removed { background: #ffebee; }
        .revdiff tr.changed { background: #fffdf2; }
        .revdiff tr.changed td.revdiff-b { color: #1b5e20; font-weight: 600; }
        .revdiff tr.changed td.revdiff-a { color: #b71c1c; text-decoration: line-through; opacity: 0.8; }
        .revdiff-section-row td {
            background: #ede7f6;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 0.02em;
            padding: 7px 8px;
        }
        .revdiff-empty { color: #90a4ae; font-style: italic; }
        .revdiff-status { padding: 30px 16px; text-align: center; color: #607d8b; font-size: 13px; }
        .revdiff-status .preview-spinner { margin: 0 auto 12px; }
        .revdiff-aspects {
            display: inline-flex;
            gap: 2px;
            margin-bottom: 12px;
            background: #ede7f6;
            border-radius: 6px;
            padding: 3px;
        }
        .revdiff-aspect {
            border: none;
            background: transparent;
            color: #573c7c;
            font-size: 12.5px;
            font-weight: 600;
            padding: 5px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        .revdiff-aspect.is-active { background: #6a4c93; color: #fff; }
        .revdiff-aspect:disabled { opacity: 0.55; cursor: default; }
        .revdiff td.changed-cell { background: #fffdf2; }
        .revdiff td.changed-cell .revdiff-old {
            display: block; color: #b71c1c; text-decoration: line-through; opacity: 0.8;
        }
        .revdiff td.changed-cell .revdiff-new { display: block; color: #1b5e20; font-weight: 600; }
        /* --- Current Status dashboard --- */
        .status-dash {
            padding: 14px 16px 24px;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #263238;
            overflow: auto;
            height: 100%;
            box-sizing: border-box;
        }
        .status-rollup {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border-radius: 8px;
            background: #f5f7f8;
            margin-bottom: 16px;
            font-size: 14px;
            font-weight: 600;
        }
        .status-rollup .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
            background: #b0bec5;
        }
        .status-rollup.is-clear .status-dot { background: #2e7d32; }
        .status-rollup.is-warn .status-dot { background: #f9a825; }
        .status-rollup.is-partial .status-dot { background: #b0bec5; }
        .status-section {
            border: 1px solid #e0e4e7;
            border-radius: 8px;
            margin-bottom: 14px;
            overflow: hidden;
        }
        .status-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 9px 12px;
            background: #f5f7f8;
            border-bottom: 1px solid #e0e4e7;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.02em;
        }
        .status-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 10px;
            background: #eceff1;
            color: #546e7a;
            white-space: nowrap;
        }
        .status-badge.is-ok { background: #e8f5e9; color: #2e7d32; }
        .status-badge.is-warn { background: #fff8e1; color: #b8860b; }
        .status-badge.is-bad { background: #ffebee; color: #c62828; }
        .status-section-body {
            padding: 10px 12px;
            font-size: 13px;
        }
        .status-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #607d8b;
            font-size: 13px;
        }
        .status-loading .preview-spinner {
            width: 18px;
            height: 18px;
            border-width: 3px;
        }
        .status-field {
            display: flex;
            gap: 8px;
            padding: 3px 0;
            line-height: 1.4;
        }
        .status-field .k {
            flex: 0 0 140px;
            color: #78909c;
            font-weight: 600;
        }
        .status-field .v {
            flex: 1;
            min-width: 0;
            word-break: break-word;
        }
        .status-mvdb-item {
            padding: 8px 0;
            border-top: 1px solid #eceff1;
        }
        .status-mvdb-item:first-child { border-top: none; padding-top: 0; }
        .status-mvdb-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 4px;
            font-weight: 700;
            font-size: 13px;
        }
        .status-mvdb-link, .status-mvdb-open {
            color: #1565c0;
            text-decoration: none;
        }
        .status-mvdb-link:hover, .status-mvdb-open:hover { text-decoration: underline; }
        .status-mvdb-open {
            display: inline-block;
            margin-top: 6px;
            font-size: 12px;
            font-weight: 600;
        }
        .status-error {
            color: #c62828;
            font-size: 13px;
            line-height: 1.5;
        }
        .status-signin-btn {
            margin-top: 8px;
            padding: 5px 10px;
            font-size: 12px;
            font-weight: 600;
            color: #fff;
            background: #566873;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .status-signin-btn:hover { background: #455560; }
        .status-wi {
            border-top: 1px solid #eceff1;
            padding: 8px 0;
        }
        .status-wi:first-child { border-top: none; }
        .status-wi-title {
            display: flex;
            align-items: baseline;
            gap: 6px;
            font-weight: 600;
            line-height: 1.35;
        }
        .status-wi-id { color: #1565c0; flex-shrink: 0; }
        .status-wi-meta {
            margin-top: 2px;
            font-size: 12px;
            color: #78909c;
        }
        .status-wi-state {
            display: inline-block;
            font-size: 11px;
            font-weight: 700;
            padding: 1px 7px;
            border-radius: 9px;
            background: #eceff1;
            color: #546e7a;
        }
        .status-wi-state.is-open { background: #e3f2fd; color: #1565c0; }
        .status-wi.is-closed { opacity: 0.78; }
        .status-wi-field {
            margin-top: 5px;
            font-size: 12px;
            color: #455a64;
            line-height: 1.45;
        }
        .status-wi-field .lbl,
        .status-wi-discussion .lbl {
            display: inline-block;
            font-weight: 700;
            color: #78909c;
            margin-right: 4px;
        }
        .status-wi-discussion {
            margin-top: 6px;
        }
        .status-wi-discussion .lbl { display: block; margin-bottom: 3px; }
        .status-comment {
            margin-top: 6px;
            padding: 6px 8px;
            background: #f9fafb;
            border-left: 3px solid #cfd8dc;
            border-radius: 0 4px 4px 0;
            font-size: 12px;
            color: #455a64;
            line-height: 1.4;
        }
        .status-comment .who { font-weight: 600; color: #37474f; }
        .status-muted { color: #90a4ae; font-style: italic; }
        .status-summary {
            margin-bottom: 16px;
            padding: 12px 14px;
            border: 1px solid #e0e4e7;
            border-radius: 8px;
            background: #fbfcfd;
        }
        .status-summary-head {
            font-size: 13px;
            font-weight: 700;
            color: #37474f;
            margin-bottom: 8px;
            letter-spacing: 0.02em;
        }
        .status-summary-body {
            font-size: 13px;
            line-height: 1.5;
            color: #37474f;
            border-left: 3px solid #cfd8dc;
            padding-left: 10px;
        }
        .status-summary-body.is-warn { border-left-color: #f9a825; }
        .status-summary-body.is-clear { border-left-color: #2e7d32; }
        .status-summary-body.is-partial { border-left-color: #b0bec5; }
        .status-summary-body p { margin: 0 0 6px; }
        .status-summary-body p:last-child { margin-bottom: 0; }
        .status-summary-verdict { font-weight: 600; margin-top: 8px !important; }
        .status-summary .status-muted { margin-top: 8px; font-size: 11px; }
        .preview-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.45);
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
            overflow: visible;
            z-index: 1000000;
            animation: slideInRight 0.2s ease-out;
        }
        .preview-resize-handle {
            position: absolute;
            left: 0;
            top: 0;
            width: 16px;
            height: 100%;
            transform: translateX(-50%);
            cursor: ew-resize;
            z-index: 2;
            touch-action: none;
            background: transparent;
        }
        /* No full-height divider line — just the floating grab pill centered on
           the panel's left edge, mirroring the macOS Split View resize control. */
        .preview-resize-handle::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 9px;
            height: 46px;
            border-radius: 5px;
            background:
                repeating-linear-gradient(
                    to bottom,
                    rgba(255, 255, 255, 0.85) 0,
                    rgba(255, 255, 255, 0.85) 2px,
                    transparent 2px,
                    transparent 4px
                ) calc(50% - 1.5px) center / 1px 14px no-repeat,
                repeating-linear-gradient(
                    to bottom,
                    rgba(255, 255, 255, 0.85) 0,
                    rgba(255, 255, 255, 0.85) 2px,
                    transparent 2px,
                    transparent 4px
                ) calc(50% + 1.5px) center / 1px 14px no-repeat,
                #2b2b2b;
            box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
            transition: background-color 0.12s ease, height 0.12s ease;
        }
        .preview-resize-handle:hover::after,
        body.preview-resizing .preview-resize-handle::after {
            height: 56px;
            background:
                repeating-linear-gradient(
                    to bottom,
                    rgba(255, 255, 255, 1) 0,
                    rgba(255, 255, 255, 1) 2px,
                    transparent 2px,
                    transparent 4px
                ) calc(50% - 1.5px) center / 1px 16px no-repeat,
                repeating-linear-gradient(
                    to bottom,
                    rgba(255, 255, 255, 1) 0,
                    rgba(255, 255, 255, 1) 2px,
                    transparent 2px,
                    transparent 4px
                ) calc(50% + 1.5px) center / 1px 16px no-repeat,
                #3a3a3a;
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
        .preview-revbar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: #f3f0fa;
            border-bottom: 1px solid #d9d2ec;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            color: #4a2f8a;
        }
        .preview-revbar-label { font-weight: 600; }
        .preview-revbar-select {
            font-size: 12px;
            padding: 2px 6px;
            border: 1px solid #b9a8e0;
            border-radius: 4px;
            background: #fff;
            color: #2f2150;
            max-width: 60%;
        }
        .preview-revbar-status { color: #6b6580; font-size: 11px; }
        .preview-revbar-compare {
            margin-left: auto;
            font-size: 12px;
            font-weight: 600;
            padding: 3px 10px;
            border: 1px solid #b9a8e0;
            border-radius: 4px;
            background: #fff;
            color: #4a2f8a;
            cursor: pointer;
            white-space: nowrap;
        }
        .preview-revbar-compare:hover { background: #efeafc; }
        .preview-revbar-compare.active { background: #4a2f8a; color: #fff; border-color: #4a2f8a; }
        .preview-revbar-vs { font-weight: 600; color: #6b6580; }
        .revdiff2 {
            font-family: "Consolas", "Courier New", monospace;
            font-size: 12px;
            line-height: 1.5;
            color: #222;
            padding: 0;
            height: 100%;
            overflow: auto;
            background: #fff;
            box-sizing: border-box;
        }
        .revdiff2-head {
            position: sticky;
            top: 0;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 8px 14px;
            background: #f3f0fa;
            border-bottom: 1px solid #d9d2ec;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            font-size: 11px;
            color: #4a2f8a;
        }
        .revdiff2-head .revdiff2-leg { display: inline-flex; align-items: center; gap: 5px; }
        .revdiff2-head .revdiff2-sw { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
        .revdiff2-sw.add { background: #c6f6d5; border: 1px solid #38a169; }
        .revdiff2-sw.del { background: #fed7d7; border: 1px solid #e53e3e; }
        .revdiff2-summary { margin-left: auto; color: #6b6580; }
        .revdiff2-row { display: flex; white-space: pre-wrap; word-break: break-word; padding: 0 14px; }
        .revdiff2-row .gut {
            flex: 0 0 22px;
            user-select: none;
            color: #999;
            text-align: center;
            margin-right: 8px;
        }
        .revdiff2-row .txt { flex: 1 1 auto; }
        .revdiff2-row.add { background: #f0fff4; }
        .revdiff2-row.add .gut { color: #2f855a; }
        .revdiff2-row.del { background: #fff5f5; }
        .revdiff2-row.del .gut { color: #c53030; }
        .revdiff2-row.same { color: #444; }
        .revdiff2 ins { background: #c6f6d5; text-decoration: none; border-radius: 2px; }
        .revdiff2 del { background: #fed7d7; text-decoration: none; border-radius: 2px; }
        .revdiff2-empty { padding: 24px; text-align: center; color: #666; font-family: "Segoe UI", sans-serif; font-size: 13px; }
        .preview-body iframe {
            width: 100%;
            height: 100%;
            border: none;
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
        /* ===== Dark mode =====
           We deliberately do NOT use a CSS invert filter — that turns images
           and every colored element into a photo negative. Instead a small JS
           pass (below) recolors only essentially-white backgrounds to #1A1A1A
           and near-black text to light, leaving all real colors and images
           alone. This base rule just paints the root dark immediately so there
           is no white flash before the JS pass runs, and dims the modal
           backdrop. */
        html[data-agile-dark],
        html[data-agile-dark] body {
            background-color: #141414 !important;
        }
        html[data-agile-dark] .preview-overlay {
            background: rgba(0, 0, 0, 0.6) !important;
        }
    `;
    document.head.appendChild(style);

    // --- Button visibility settings (controlled from the toolbar popup) ---
    // The popup writes a settings object to browser.storage.local; each key
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
        showHWT:       '.partnum-hwt-wrap',
        showP4v:       '.p4v-open-btn',
        showP4Browser: '.p4-open-btn',
        showFireman:   '.ref-pdf-btn',
        showStatus:    '.partstatus-btn',
        showTree:      '.parttree-btn'
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

    // --- HWT Config Creator endpoints ---
    // The Local URL is universal: http://localhost:8501 always reaches a server
    // running on THIS machine, so it works unchanged on every PC. The Network
    // and External URLs are machine-specific (this machine's LAN IP / public
    // IP). They are discovered automatically by the background script via a
    // local native host (stored under 'hwtUrlsAuto'), and can also be overridden
    // manually from the popup (stored under 'hwtUrls'). A manual value wins;
    // otherwise the auto-discovered one is used. Menu items with no URL hide.
    const HWT_PATH = '/mfg-debug-config-create';
    const HWT_LOCAL_URL = 'http://localhost:8501' + HWT_PATH;
    const HWT_URLS_KEY = 'hwtUrls';
    const HWT_AUTO_URLS_KEY = 'hwtUrlsAuto';
    const hwtManual = { network: '', external: '' };
    const hwtAuto = { network: '', external: '' };
    const hwtUrls = { local: HWT_LOCAL_URL, network: '', external: '' };
    function recomputeHwtUrls() {
        hwtUrls.network = hwtManual.network || hwtAuto.network || '';
        hwtUrls.external = hwtManual.external || hwtAuto.external || '';
    }
    function applyHwtUrls(cfg) {
        cfg = cfg || {};
        if (typeof cfg.network === 'string') hwtManual.network = cfg.network.trim();
        if (typeof cfg.external === 'string') hwtManual.external = cfg.external.trim();
        recomputeHwtUrls();
    }
    function applyHwtAutoUrls(cfg) {
        cfg = cfg || {};
        if (typeof cfg.network === 'string') hwtAuto.network = cfg.network.trim();
        if (typeof cfg.external === 'string') hwtAuto.external = cfg.external.trim();
        recomputeHwtUrls();
    }
    if (storageApi) {
        storageApi.storage.local.get([HWT_URLS_KEY, HWT_AUTO_URLS_KEY]).then((res) => {
            applyHwtUrls(res && res[HWT_URLS_KEY]);
            applyHwtAutoUrls(res && res[HWT_AUTO_URLS_KEY]);
        }).catch(() => { /* storage unavailable; Local URL still works */ });

        if (storageApi.storage.onChanged) {
            storageApi.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return;
                if (changes[HWT_URLS_KEY]) applyHwtUrls(changes[HWT_URLS_KEY].newValue);
                if (changes[HWT_AUTO_URLS_KEY]) applyHwtAutoUrls(changes[HWT_AUTO_URLS_KEY].newValue);
            });
        }

        // Ask the background script to (re)discover this machine's Network /
        // External URLs via the local native host, so the menu is populated
        // without reading them off the terminal.
        try {
            if (storageApi.runtime && storageApi.runtime.sendMessage) {
                storageApi.runtime.sendMessage({ type: 'refresh_hwt_urls' });
            }
        } catch (e) { /* background unavailable */ }
    }

    // --- Appearance / dark mode (controlled from the toolbar popup) ---
    // The popup writes 'themeMode' = 'auto' | 'light' | 'dark'. We resolve it to
    // an effective light/dark and, when dark, run a recolor pass that turns only
    // essentially-white surfaces dark and near-black text light — leaving images
    // and every genuinely-colored element untouched (no photo-negative effect).
    const THEME_KEY = 'themeMode';
    const darkMql = window.matchMedia('(prefers-color-scheme: dark)');
    let currentThemeMode = 'light';

    // The dark surface color requested for the page background.
    const DARK_BG = '#141414';
    const DARK_TEXT = '#c8c8c8';
    // Elements whose pixels are real content/media — never recolored.
    const DARK_SKIP_TAGS = {
        IMG: 1, SVG: 1, CANVAS: 1, VIDEO: 1, PICTURE: 1,
        IFRAME: 1, OBJECT: 1, EMBED: 1
    };
    // Native Agile chrome that has its own light button/tab backgrounds where the
    // black text is meant to stay black. Matching elements (and their descendants)
    // are left completely untouched so they keep their native colors.
    const DARK_KEEP_SELECTOR = 'a[onfocus*="onTabFocus"], .slideMenuHeader, .partnum-mvdb-btn, .TopPane, .action_buttons, [onfocus*="buttonFocus"], #Actionsspan, #MSG_Show_In_Navigatorspan, .formElm';

    function parseRgb(str) {
        const m = str && str.match(/rgba?\(([^)]+)\)/i);
        if (!m) return null;
        const p = m[1].split(',').map((x) => parseFloat(x));
        return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
    }
    // "Essentially white": light enough that it reads as a white/near-white
    // surface. Genuinely colored backgrounds fall below this and are left alone.
    function isNearWhite(c) {
        return c && c.a > 0.05 && c.r >= 225 && c.g >= 225 && c.b >= 225;
    }
    // "Essentially black": near-black text that would be unreadable on #1A1A1A.
    // Real colored text (blue links, red status, etc.) is left alone.
    function isNearBlack(c) {
        return c && c.a > 0.05 && c.r <= 70 && c.g <= 70 && c.b <= 70;
    }
    // "Light surface": white through light grey. Used for gradients (e.g. the
    // grey->white panel gradients) which read as a light surface even though no
    // single stop is pure white. Looser than isNearWhite so light greys count.
    function isLight(c) {
        return c && c.a > 0.05 && c.r >= 190 && c.g >= 190 && c.b >= 190;
    }
    // A background-image is a "light gradient" when it is a gradient whose every
    // color stop is a light surface (white/grey). Such gradients are recolored
    // to the flat dark surface. Gradients containing any real color are left be.
    function isLightGradient(bgImage) {
        if (!bgImage || bgImage.indexOf('gradient') === -1) return false;
        const colors = bgImage.match(/rgba?\([^)]+\)/gi);
        if (!colors || !colors.length) return false;
        for (let i = 0; i < colors.length; i++) {
            const c = parseRgb(colors[i]);
            // Fully transparent stops don't contribute visible color.
            if (c && c.a <= 0.05) continue;
            if (!isLight(c)) return false;
        }
        return true;
    }

    // Some surfaces use a light decorative PNG as background-image (e.g. Agile's
    // bgd_gradient_half.png) instead of a CSS gradient. We can't tell light from
    // dark by URL, so we sample the actual pixels on a canvas (same-origin, so
    // reading is allowed) and flatten only predominantly-light images. Real
    // photos/logos are not light enough on average and are left alone.
    const bgImageLightCache = Object.create(null);
    function extractFirstUrl(bgImage) {
        const m = bgImage && bgImage.match(/url\(["']?([^"')]+)["']?\)/i);
        return m ? m[1] : null;
    }
    function flattenBgImage(el) {
        el.style.setProperty('background-image', 'none', 'important');
        el.style.setProperty('background-color', DARK_BG, 'important');
        el.setAttribute('data-ag-dark-bgimg', '1');
        el.setAttribute('data-ag-dark-bg', '1');
    }
    function sampleImageLight(url, cb) {
        if (url in bgImageLightCache) { cb(bgImageLightCache[url]); return; }
        const img = new Image();
        img.onload = function () {
            let light = false;
            try {
                const w = Math.min(24, img.naturalWidth || 24);
                const h = Math.min(24, img.naturalHeight || 24);
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h).data;
                let sum = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] / 255 < 0.5) continue; // skip transparent
                    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    count++;
                }
                light = count > 0 && (sum / count) >= 190;
            } catch (e) { light = false; } // tainted/cross-origin -> leave alone
            bgImageLightCache[url] = light;
            cb(light);
        };
        img.onerror = function () { bgImageLightCache[url] = false; cb(false); };
        img.src = url;
    }

    function darkenElement(el) {
        if (!el || el.nodeType !== 1) return;
        if (DARK_SKIP_TAGS[el.tagName]) return;
        if (el.ownerSVGElement) return; // inside an <svg>
        if (el.getAttribute('data-ag-dark') === '1') return;
        el.setAttribute('data-ag-dark', '1');
        // Leave native tabs / slide-menu headers with their own light backgrounds
        // alone so their black text stays readable.
        if (el.closest && el.closest(DARK_KEEP_SELECTOR)) return;
        let cs;
        try { cs = getComputedStyle(el); } catch (e) { return; }
        const bg = parseRgb(cs.backgroundColor);
        if (isNearWhite(bg)) {
            el.style.setProperty('background-color', DARK_BG, 'important');
            el.setAttribute('data-ag-dark-bg', '1');
        }
        // Neutralize white/grey gradient backgrounds (the grey->white panel look)
        // by flattening them to the dark surface. Colored gradients are kept.
        const bgImg = cs.backgroundImage;
        if (isLightGradient(bgImg)) {
            flattenBgImage(el);
        } else {
            // Decorative PNG/JPG background: sample its pixels and flatten if light.
            const url = extractFirstUrl(bgImg);
            if (url) {
                sampleImageLight(url, function (light) {
                    if (light && darkActive && el.getAttribute('data-ag-dark') === '1') {
                        flattenBgImage(el);
                    }
                });
            }
        }
        const fg = parseRgb(cs.color);
        if (isNearBlack(fg)) {
            el.style.setProperty('color', DARK_TEXT, 'important');
            el.setAttribute('data-ag-dark-fg', '1');
        }
    }
    function darkenTree(root) {
        if (!root) return;
        if (root.nodeType === 1) darkenElement(root);
        const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (let i = 0; i < all.length; i++) darkenElement(all[i]);
    }
    function undarkenAll() {
        document.querySelectorAll('[data-ag-dark]').forEach((el) => {
            if (el.getAttribute('data-ag-dark-bg')) el.style.removeProperty('background-color');
            if (el.getAttribute('data-ag-dark-bgimg')) el.style.removeProperty('background-image');
            if (el.getAttribute('data-ag-dark-fg')) el.style.removeProperty('color');
            el.removeAttribute('data-ag-dark');
            el.removeAttribute('data-ag-dark-bg');
            el.removeAttribute('data-ag-dark-bgimg');
            el.removeAttribute('data-ag-dark-fg');
        });
    }

    // Incremental recolor of nodes added after the initial pass, batched so we
    // don't call getComputedStyle on every single mutation.
    let darkActive = false;
    let darkQueue = [];
    let darkScheduled = false;
    const darkSchedule = window.requestIdleCallback
        ? (cb) => window.requestIdleCallback(cb, { timeout: 200 })
        : (cb) => setTimeout(cb, 16);
    function flushDarkQueue() {
        darkScheduled = false;
        const items = darkQueue;
        darkQueue = [];
        if (!darkActive) return;
        items.forEach((node) => darkenTree(node));
    }
    function scheduleDarken(node) {
        if (!darkActive || !node) return;
        darkQueue.push(node);
        if (!darkScheduled) { darkScheduled = true; darkSchedule(flushDarkQueue); }
    }
    function setDarkActive(on) {
        if (on === darkActive) return;
        darkActive = on;
        if (on) darkenTree(document.body || document.documentElement);
        else undarkenAll();
    }

    function resolveDark(mode) {
        return mode === 'dark' || (mode === 'auto' && darkMql.matches);
    }
    function applyTheme(mode) {
        currentThemeMode = mode || 'light';
        const dark = resolveDark(currentThemeMode);
        if (dark) {
            document.documentElement.setAttribute('data-agile-dark', '');
        } else {
            document.documentElement.removeAttribute('data-agile-dark');
        }
        setDarkActive(dark);
    }

    if (storageApi) {
        storageApi.storage.local.get(THEME_KEY).then((res) => {
            applyTheme(res && res[THEME_KEY]);
        }).catch(() => { /* storage unavailable; stay light */ });

        if (storageApi.storage.onChanged) {
            storageApi.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes[THEME_KEY]) {
                    applyTheme(changes[THEME_KEY].newValue);
                }
            });
        }
    }
    // Re-resolve when the system theme flips while in 'auto'.
    if (darkMql.addEventListener) {
        darkMql.addEventListener('change', () => {
            if (currentThemeMode === 'auto') applyTheme('auto');
        });
    }

    // --- Helpers ---
    function getFileExtFromName(fileName) {
        const name = fileName.toLowerCase().trim();
        if (name.endsWith('.pdf')) return 'pdf';
        // .docm is macro-enabled Word, same OOXML/ZIP structure as .docx,
        // so it goes through the identical mammoth conversion pipeline.
        if (name.endsWith('.docx') || name.endsWith('.docm')) return 'docx';
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
        // STEP / IGES are open CAD interchange formats. They are tessellated
        // into a triangle mesh locally (OpenCascade WASM in the background page)
        // and rendered with the same WebGL viewer as STL. Nothing leaves the browser.
        if (name.endsWith('.step') || name.endsWith('.stp')) return 'step';
        if (name.endsWith('.iges') || name.endsWith('.igs')) return 'iges';
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

    // Split a JS-call argument string into its top-level arguments, honoring
    // single/double quotes. Returns an array of trimmed string values.
    function splitCallArgs(argsStr) {
        const args = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';
        for (let i = 0; i < argsStr.length; i++) {
            const ch = argsStr[i];
            if (inQuote) {
                if (ch === quoteChar) { inQuote = false; args.push(current); current = ''; }
                else { current += ch; }
            } else if (ch === "'" || ch === '"') {
                inQuote = true; quoteChar = ch; current = '';
            } else if (ch === ',') {
                if (current.trim() !== '') { args.push(current.trim()); }
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) args.push(current.trim());
        return args;
    }

    // CAD attachments (.igs/.stp/.stl...) are wired to viewFile(...) which
    // launches Oracle AutoVue rather than returning bytes. The IDs map onto the
    // same download mechanism, so we parse them and synthesize an equivalent
    // openFile(...) call that the preview pipeline can fetch.
    //   viewFile(classId, objId, tableId, rowId, false, '', fileId)
    function parseViewFileParams(onclickStr) {
        const match = onclickStr.match(/viewFile\s*\(([\s\S]*)\)/);
        if (!match) return null;
        const a = splitCallArgs(match[1]);
        if (a.length < 7) return null;
        return { classId: a[0], objId: a[1], tableId: a[2], rowId: a[3], fileId: a[6] };
    }

    // Read the attachment's byte size from its grid row. Agile shows the size
    // with thousands separators (e.g. "654,524"), so we match comma-grouped
    // numbers specifically — a plain \d+ scan would both split "654,524" into
    // "654"/"524" and pick up unrelated IDs (e.g. FOLDER1083681). openFile()
    // rejects a wrong size with an "Application Error", so this must be exact.
    function getAttachmentSizeFromRow(link) {
        const row = link.closest ? link.closest('tr') : null;
        if (!row) return null;
        const text = row.textContent || '';
        const grouped = text.match(/\d{1,3}(?:,\d{3})+/g);
        if (grouped && grouped.length) {
            let max = 0;
            for (let i = 0; i < grouped.length; i++) {
                const n = parseInt(grouped[i].replace(/,/g, ''), 10);
                if (n > max) max = n;
            }
            if (max > 0) return String(max);
        }
        return null;
    }

    function toJsStringLiteral(s) {
        return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    }

    //   openFile('', classId, objId, tableId, rowId, fileId, fileName, size, ' ', false, false, false)
    function buildOpenFileCallFromViewFile(vf, fileName, size) {
        return 'openFile(' +
            "'', " +
            toJsStringLiteral(vf.classId) + ', ' +
            toJsStringLiteral(vf.objId) + ', ' +
            toJsStringLiteral(vf.tableId) + ', ' +
            toJsStringLiteral(vf.rowId) + ', ' +
            toJsStringLiteral(vf.fileId) + ', ' +
            toJsStringLiteral(fileName) + ', ' +
            toJsStringLiteral(size) + ", ' ', false, false, false);";
    }

    // The onclick string to trigger for a given link: a synthesized openFile()
    // for viewFile-based CAD links, otherwise the link's own onclick.
    function onclickForTrigger(link) {
        return link.__previewOnclick || link.getAttribute('onclick');
    }

    // --- Page-context bridge (MAIN-world hooks live in page-hooks.js) ---
    // Chrome MV3 enforces the page CSP on injected inline scripts and blocks
    // eval, so the openFile hooks run in the MAIN world (page-hooks.js). Here we
    // only send commands and receive results over document-level CustomEvents.
    const BRIDGE_ATTR = 'data-preview-bridge-id';
    let bridgeCounter = 0;
    function sendPageCmd(msg) {
        document.dispatchEvent(new CustomEvent('__pp_cmd', { detail: JSON.stringify(msg) }));
    }
    function ensureBridgeId(link) {
        if (!link) return null;
        let id = link.getAttribute(BRIDGE_ATTR);
        if (!id) { bridgeCounter += 1; id = 'pp_' + Date.now() + '_' + bridgeCounter; link.setAttribute(BRIDGE_ATTR, id); }
        return id;
    }
    // The page function + parsed arg list to invoke. onclickForTrigger handles
    // synthesized openFile(...) calls for viewFile/CAD links (via __previewOnclick).
    //
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
        const onclickStr = onclickForTrigger(link) || '';
        const parsed = parseOpenFileParams(onclickStr);
        return { fn: 'openFile', args: parsed ? coerceCallArgs(parsed.args) : [] };
    }
    // Normal download — invoke the page's openFile in the MAIN world, no capture.
    function triggerDownload(link) {
        try {
            const call = getOpenFileCall(link);
            // For a real attachment anchor, click the original DOM node in the
            // MAIN world so the page's NATIVE onclick runs with correct argument
            // types. Reconstructed args lose JS types (e.g. the trailing booleans
            // arrive as the string "false", which is truthy) and Agile then
            // answers "Application Error". Only synthesized viewFile/CAD links
            // (__previewOnclick) must use fn+args, since clicking the anchor
            // would launch the original viewFile (AutoVue) instead.
            const linkAttrValue = link.__previewOnclick ? null : ensureBridgeId(link);
            sendPageCmd({ cmd: 'invoke', fn: call.fn, args: call.args, linkAttrValue });
        } catch (err) { log('Download trigger error:', err); }
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
            try {
                const call = getOpenFileCall(link);
                // Click the real anchor for normal attachments so the page's
                // native onclick runs with correct argument types (see
                // triggerDownload). Synthesized viewFile/CAD links must use
                // fn+args because their anchor would run the original viewFile.
                const linkAttrValue = link.__previewOnclick ? null : ensureBridgeId(link);
                sendPageCmd({ cmd: 'capture', id: captureId, fn: call.fn, args: call.args, linkAttrValue });
            } catch (err) {
                log('Error triggering capture:', err);
                document.removeEventListener('__pp_result', handler);
                resolve(null);
                return;
            }
            setTimeout(() => {
                document.removeEventListener('__pp_result', handler);
                resolve(null);
            }, 7000);
        });
    }

    // ===================================================================
    // Attachment revision viewer (preview revision dropdown)
    // -------------------------------------------------------------------
    // The Attachments grid shows the file for the item's CURRENTLY selected
    // revision (the revSelectName dropdown). Each item revision can carry a
    // different version of the same file (different objId/fileId, and sometimes a
    // different file type, e.g. .pdf at an older rev vs .docx now).
    //
    // To preview a PAST revision we POST the page's own MainForm to PCMServlet
    // with revchangeid set + the Attachments tab (tabid 13), parse the returned
    // HTML for the matching file's openFile(...) call, then replay that call
    // through the preview capture hooks to fetch the bytes. No hidden Agile shell
    // to boot, and the visible page's revision is never disturbed.
    //
    // (The agile-attachrev-frame iframe helpers below are retained but unused;
    // the POST approach replaced them because booting a fresh shell timed out.)
    // ===================================================================
    let attachFrame = null;
    let attachFrameReady = null;

    function attachFrameDoc() {
        try { return attachFrame && attachFrame.contentDocument; } catch (e) { return null; }
    }

    function runInAttachFrame(jsText) {
        const d = attachFrameDoc();
        if (!d) return;
        const s = d.createElement('script');
        s.textContent = jsText;
        (d.documentElement || d.body).appendChild(s);
        s.remove();
    }

    // Identify the object currently shown on the MAIN page from its tab strip:
    // the displayObject('<X>Handler', classId, objId, tabId) group that appears
    // across the most tabs (works for any handler, not just ItemHandler). Used to
    // navigate the hidden frame to the same object so its revision dropdown
    // (revSelectName) and changeRevs() become available.
    function detectCurrentObjectNav() {
        const re = /displayObject\s*\(\s*['"]([A-Za-z]+Handler)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/;
        const groups = Object.create(null);
        document.querySelectorAll('a[href*="Handler"], a[onclick*="Handler"]').forEach((a) => {
            const src = (a.getAttribute('onclick') || '') + ' ' + (a.getAttribute('href') || '');
            const m = re.exec(src);
            if (!m) return;
            const handler = m[1], classId = m[2], objId = m[3], tabId = m[4];
            const key = handler + '|' + classId + '|' + objId;
            const g = groups[key] || (groups[key] = { handler, classId, objId, tabs: Object.create(null) });
            g.tabs[tabId] = true;
        });
        let best = null, bestCount = 0;
        Object.keys(groups).forEach((k) => {
            const n = Object.keys(groups[k].tabs).length;
            if (n > bestCount) { bestCount = n; best = groups[k]; }
        });
        if (!best) return null;
        const tabIds = Object.keys(best.tabs);
        return { handler: best.handler, classId: best.classId, objId: best.objId, titleTab: tabIds[0] };
    }

    // Poll the attachment frame until an injected boolean test is true (the test
    // runs in the frame's PAGE world; it sets a marker attribute we can read from
    // the content world). Rejects after timeoutMs with `label`.
    function pollAttachFrame(testJs, attr, timeoutMs, label) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                const d = attachFrameDoc();
                if (!d) { reject(new Error('Attachment frame unavailable.')); return; }
                try { d.documentElement.removeAttribute(attr); } catch (e) {}
                runInAttachFrame("try{if(" + testJs + "){document.documentElement.setAttribute('" + attr + "','1');}}catch(e){}");
                if (d.documentElement.getAttribute(attr) === '1') { resolve(true); return; }
                if (Date.now() - t0 > timeoutMs) { reject(new Error(label)); return; }
                setTimeout(poll, 250);
            })();
        });
    }

    // Boot a hidden Agile shell, EXACTLY like the (proven) Part Tree frame:
    // load cleanAgileUrl() and resolve as soon as displayObject exists. We do
    // NOT navigate or wait for changeRevs here — bundling those readiness checks
    // into the boot is what made the old version time out. Navigation and the
    // revision switch are driven as separate steps in getRevisionAttachment.
    function ensureAttachFrame() {
        if (attachFrameReady) return attachFrameReady;
        attachFrameReady = new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            frame.id = 'agile-attachrev-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden;';
            let settled = false;
            const fail = (e) => { if (!settled) { settled = true; attachFrameReady = null; log('AttachRev frame fail:', e && e.message); reject(e); } };
            const hard = setTimeout(() => fail(new Error('Attachment frame load timed out.')), 35000);
            frame.addEventListener('load', () => {
                pollAttachFrame("typeof displayObject==='function'", 'data-attach-shell', 25000,
                    'Agile shell did not load in the attachment frame.')
                    .then(() => { if (!settled) { settled = true; clearTimeout(hard); log('AttachRev frame ready'); resolve(true); } })
                    .catch(fail);
            });
            frame.src = cleanAgileUrl();
            (document.body || document.documentElement).appendChild(frame);
            attachFrame = frame;
        });
        return attachFrameReady;
    }

    // Drive the attachment frame (trigger an action that re-renders #content),
    // resolving once isReady(content) holds for a settle window on a genuinely
    // fresh render. Mirrors waitForContentSettle but scoped to the frame doc.
    function attachFrameDrive(triggerFn, isReady, opts) {
        opts = opts || {};
        const d0 = attachFrameDoc();
        if (!d0) return Promise.reject(new Error('Attachment frame unavailable.'));
        const TIMEOUT = opts.timeout || 16000;
        const SETTLE = opts.settle || 500;
        const MIN_WAIT = opts.minWait || 300;
        const old = d0.getElementById('content');
        const beforeLen = old ? old.innerHTML.length : -1;
        if (old) old.setAttribute('data-attachrev-stale', '1');
        const t0 = Date.now();
        return new Promise((resolve, reject) => {
            let done = false, settleTimer = null;
            const finish = (ok, p) => {
                if (done) return; done = true;
                if (settleTimer) clearTimeout(settleTimer);
                clearTimeout(hard); obs.disconnect();
                if (ok) resolve(p); else reject(p);
            };
            const check = () => {
                const d = attachFrameDoc();
                if (!d) return;
                const content = d.getElementById('content');
                if (!content) return;
                let ready; try { ready = isReady(content, d); } catch (e) { ready = false; }
                if (!ready) return;
                const fresh = !content.hasAttribute('data-attachrev-stale');
                const changed = fresh || content.innerHTML.length !== beforeLen;
                if (!changed) return;
                if (Date.now() - t0 < MIN_WAIT) return;
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => {
                    const d2 = attachFrameDoc();
                    const c = d2 && d2.getElementById('content');
                    let r2; try { r2 = c && isReady(c, d2); } catch (e) { r2 = false; }
                    if (r2) finish(true, d2);
                }, SETTLE);
            };
            const obs = new MutationObserver(check);
            obs.observe(d0.documentElement || d0, { childList: true, subtree: true });
            const hard = setTimeout(() => finish(false, new Error(opts.timeoutMsg || 'Timed out loading the attachment frame.')), TIMEOUT);
            try { triggerFn(); } catch (e) { finish(false, e); return; }
            setTimeout(check, MIN_WAIT + 50);
        });
    }

    // Switch the frame to a given item revision (drives Agile's own changeRevs).
    // Readiness is tab-agnostic: changeRevs re-renders #content for whatever tab
    // the frame is on (title block OR a grid), so we accept any fresh, populated
    // #content rather than requiring the title block specifically.
    function frameContentLoaded(content) {
        if (!content) return false;
        if (content.querySelector('dl.side_by_side_text dd[id^="col_"]')) return true; // title block
        if (content.querySelector('a[onclick*="openFile"]')) return true;              // attachments grid
        if (content.querySelector('table tr td')) return true;                          // any data grid
        if (/no\s+(items|attachments|files|rows)/i.test(content.textContent || '')) return true;
        return false;
    }

    function frameSwitchRevision(revId) {
        log('AttachRev: switching frame to revision', revId);
        return attachFrameDrive(
            () => runInAttachFrame(
                '(function(){try{' +
                'var s=document.getElementById("revSelectName");' +
                'if(s){for(var i=0;i<s.options.length;i++){if(String(s.options[i].value)===' +
                JSON.stringify(String(revId)) + '){s.selectedIndex=i;break;}}}' +
                'if(typeof changeRevs==="function"){changeRevs();}' +
                '}catch(e){console.error("[AttachRev] rev trigger error",e);}})();'),
            (content) => frameContentLoaded(content),
            { timeoutMsg: 'Timed out switching to revision ' + revId + '.' }
        ).then((doc) => { log('AttachRev: revision switched', revId); return doc; });
    }

    // Open the Attachments tab in the frame and wait for its file grid.
    function frameOpenAttachments() {
        log('AttachRev: opening Attachments tab in frame');
        const re = TAB_MATCHERS.attachments;
        const reSource = re.source.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const reFlags = re.flags;
        return attachFrameDrive(
            () => runInAttachFrame(
                '(function(){try{' +
                'var re=new RegExp(\'' + reSource + '\',\'' + reFlags + '\');' +
                'var links=document.querySelectorAll(".tabConButton, .tabname, .tabnames a, .tabConButtonSel, td a, li a, a");' +
                'for(var i=0;i<links.length;i++){var t=(links[i].textContent||"").replace(/\\s+/g," ").trim();' +
                'if(t&&re.test(t)){links[i].click();return;}}' +
                'console.warn("[AttachRev] Attachments tab not found");' +
                '}catch(e){console.error("[AttachRev] tab trigger error",e);}})();'),
            (content) => !!content.querySelector('a[onclick*="openFile"]') ||
                /no\s+(attachments|files|rows)/i.test(content.textContent || ''),
            { timeoutMsg: 'Timed out loading the Attachments tab for this revision.' }
        ).then((doc) => { log('AttachRev: Attachments tab loaded'); return doc; });
    }

    // Base name of an attachment file, used to match the same logical file
    // across revisions (extension and minor wording may differ).
    function attachmentBase(name) {
        return String(name || '').trim().toLowerCase().replace(/\.[a-z0-9]{1,6}$/, '');
    }

    function attachmentExt(name) {
        const m = /\.([a-z0-9]{1,6})$/i.exec(String(name || '').trim());
        return m ? m[1].toLowerCase() : '';
    }

    // Find the best openFile(...) link in a (revision) document for the file the
    // user is viewing. Tiers: exact filename > same base+extension > same base >
    // sole file. Searches the whole doc (the fetched page has the grid outside
    // any #content wrapper). Returns { onclick, fileName } or null.
    function scrapeAttachmentOpenFile(doc, targetName) {
        const cand = [];
        doc.querySelectorAll('a[onclick*="openFile"]').forEach((a) => {
            const onclick = a.getAttribute('onclick') || '';
            // Only the real file links call openFile('', classId, ...). The
            // toolbar "Open" button calls openFileFromRow(...) — exclude it.
            if (!/openFile\s*\(\s*['"]/.test(onclick)) return;
            const name = (a.textContent || '').replace(/\u00a0/g, ' ').trim();
            if (name && onclick) cand.push({ name: name, onclick: onclick });
        });
        if (!cand.length) return null;
        const tLower = String(targetName || '').trim().toLowerCase();
        const tBase = attachmentBase(targetName);
        const tExt = attachmentExt(targetName);
        const hit =
            cand.find((c) => c.name.toLowerCase() === tLower) ||
            cand.find((c) => attachmentBase(c.name) === tBase && attachmentExt(c.name) === tExt) ||
            cand.find((c) => attachmentBase(c.name) === tBase) ||
            (cand.length === 1 ? cand[0] : null);
        return hit ? { onclick: hit.onclick, fileName: hit.name } : null;
    }

    // Serialize the live MainForm (all inputs/selects) into a URL-encoded body,
    // applying overrides (e.g. revchangeid). Returns { params, action } or null.
    function serializeMainForm(overrides) {
        const form = document.querySelector('form[name="MainForm"]');
        if (!form) return null;
        const params = new URLSearchParams();
        form.querySelectorAll('input, select, textarea').forEach((el) => {
            if (!el.name) return;
            params.append(el.name, el.value == null ? '' : el.value);
        });
        Object.keys(overrides || {}).forEach((k) => params.set(k, overrides[k]));
        return { params: params, action: form.action };
    }

    // Map each revision id -> its class id, from the page's SetRevObject(id,
    // classId) script calls (changeRevs needs revchangeclass to match the rev).
    function getRevClassMap() {
        const map = Object.create(null);
        document.querySelectorAll('script').forEach((s) => {
            const t = s.textContent || '';
            const re = /SetRevObject\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
            let m; while ((m = re.exec(t))) { map[m[1]] = m[2]; }
        });
        return map;
    }

    // POST the MainForm for a given revision with the Attachments tab selected;
    // resolves with the parsed response Document (same-origin, credentialed).
    function fetchRevisionAttachmentsDoc(revId) {
        const revClass = getRevClassMap()[String(revId)] || '';
        const ser = serializeMainForm({
            opcode: 'displayObject',
            tabid: '13',                 // Attachments tab
            revchangeid: String(revId),
            revchangeclass: revClass,
            siteOrRevChanged: 'true',
            expandLevel: '',
            refresh: 'false'
        });
        if (!ser) return Promise.reject(new Error('Could not read the item form on this page.'));
        return fetch(ser.action, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: ser.params.toString()
        }).then((r) => {
            if (!r.ok) throw new Error('Agile returned HTTP ' + r.status + ' for that revision.');
            return r.text();
        }).then((html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            doc.__rawHtml = html;   // keep raw text for diagnostics
            return doc;
        });
    }

    // The Attachments TreeGrid loads its rows from a SEPARATE request whose URL
    // is in the grid's `Page_Url` attribute (HTML-entity-encoded), e.g.
    //   PCMServlet?ajaxRequest=true&GRID_CTX_NAME=ATTACHMENTS_FILELIST&module=
    //   ItemHandler&opcode=loadGridData&objid=..&classid=..&tabid=13&revchangeid=..
    // The displayObject response only has the empty grid shell, so we must fetch
    // this URL to get the actual file rows (with their openFile(...) calls).
    function extractGridDataUrl(rawHtml) {
        const m = /Page_Url\s*=\s*["']([^"']+)["']/i.exec(rawHtml || '');
        if (!m) return null;
        // Decode HTML entities (&#x3f; -> ?, &#x3d; -> =, &#x26; -> &, &amp; -> &).
        let u = m[1]
            .replace(/&#x3f;/gi, '?').replace(/&#x3d;/gi, '=').replace(/&#x26;/gi, '&')
            .replace(/&amp;/gi, '&');
        try { u = new URL(u, location.origin + '/Agile/').href; } catch (e) { /* keep as-is */ }
        return u;
    }

    // Decode HTML entities so grid-data XML cells (which carry HTML-encoded
    // anchors like &lt;a onclick=&quot;openFile(..)&quot;&gt;) become parseable.
    function decodeHtmlEntities(s) {
        return String(s || '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
            .replace(/&#x3d;/gi, '=').replace(/&#x3f;/gi, '?').replace(/&#x26;/gi, '&')
            .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    }

    // Last-resort: pull an openFile('', ...) call straight from text, matched to
    // the target file name (the 7th argument). Returns { onclick, fileName }.
    function matchOpenFileFromText(text, targetName) {
        const re = /openFile\s*\(\s*(['"][^)]*?)\)/g;
        const tBase = attachmentBase(targetName);
        const tExt = attachmentExt(targetName);
        let m, sole = null, soleCount = 0, baseHit = null;
        while ((m = re.exec(text))) {
            const argStr = m[1];
            const args = (argStr.match(/'([^']*)'|"([^"]*)"/g) || []).map((a) => a.slice(1, -1));
            const fname = args[6] || '';   // file name is the 7th argument
            if (!fname) continue;
            const onclick = 'openFile(' + argStr + ')';
            soleCount++; sole = { onclick: onclick, fileName: fname };
            if (fname.toLowerCase() === String(targetName || '').toLowerCase()) {
                return { onclick: onclick, fileName: fname };
            }
            if (!baseHit && attachmentBase(fname) === tBase && attachmentExt(fname) === tExt) {
                baseHit = { onclick: onclick, fileName: fname };
            }
        }
        if (baseHit) return baseHit;
        return (soleCount === 1) ? sole : null;
    }

    // Parse the EJS TreeGrid XML grid-data response and reconstruct the
    // openFile('', classId, objId, tableId, rowId, fileId, fileName, size, ...)
    // call for the matching row. The grid stores cell values as attributes on
    // each <I .../> (or <R .../>) row element, keyed by attribute id:
    //   i1046 = filename, i3623 = file size, plus the file/folder object ids.
    // We match the target row by its filename cell, then pull the ids needed.
    function matchOpenFileFromGridXml(gridText, targetName) {
        let xml;
        try { xml = new DOMParser().parseFromString(gridText, 'text/xml'); } catch (e) { return null; }
        if (!xml || xml.getElementsByTagName('parsererror').length) {
            // Some responses are HTML-wrapped; retry as HTML.
            try { xml = new DOMParser().parseFromString(gridText, 'text/html'); } catch (e2) { return null; }
        }
        const rows = Array.from(xml.querySelectorAll('I, R, B > *')).filter((el) => {
            const t = (el.tagName || '').toUpperCase();
            return t === 'I' || t === 'R';
        });
        if (!rows.length) return null;

        const tLower = String(targetName || '').toLowerCase();
        const tBase = attachmentBase(targetName);
        const tExt = attachmentExt(targetName);

        // Each row's attributes: find the one whose any attribute equals the
        // file name, then read the file's open-call ids from sibling attrs.
        const buildFor = (row) => {
            const attrs = {};
            for (const a of Array.from(row.attributes)) attrs[a.name.toLowerCase()] = a.value;
            // Filename: the attribute that holds the file name (i1046) — but be
            // tolerant: look for any attribute value matching the target name.
            let fname = attrs.i1046 || '';
            if (!fname) {
                for (const k in attrs) {
                    if (/\.[a-z0-9]{1,6}$/i.test(attrs[k]) && /[a-z]/i.test(attrs[k])) { fname = attrs[k]; break; }
                }
            }
            const size = attrs.i3623 || attrs.i_3623 || '';
            // Open-call ids. Agile names vary by build; gather the plausible ones.
            const classId = attrs.fileclassid || attrs.classid || attrs.boclassid || '6159';
            const objId = attrs.fileobjid || attrs.objid || attrs.boobjid || attrs.id || '';
            const tableId = attrs.tableid || attrs.filerevid || attrs.filerev || '';
            const rowId = attrs.rowid || attrs.filerowid || '';
            const fileId = attrs.fileid || attrs.boFileId || '';
            return { fname, size, classId, objId, tableId, rowId, fileId, attrs };
        };

        // First pass: try to find a matching row by filename.
        let chosen = null;
        for (const row of rows) {
            const info = buildFor(row);
            if (!info.fname) continue;
            const fl = info.fname.toLowerCase();
            if (fl === tLower || (attachmentBase(info.fname) === tBase && attachmentExt(info.fname) === tExt)) {
                chosen = info; break;
            }
            if (!chosen && attachmentBase(info.fname) === tBase) chosen = info;
        }
        if (!chosen) {
            // Dump attribute keys of the first row so we can map the schema.
            const first = rows[0];
            const keys = first ? Array.from(first.attributes).map((a) => a.name + '=' + (a.value || '').slice(0, 40)) : [];
            log('AttachRev: grid XML row attrs (first row):', keys);
            return null;
        }
        if (!chosen.objId || !chosen.fileId) {
            log('AttachRev: matched filename but missing ids; row attrs:',
                Object.keys(chosen.attrs).map((k) => k + '=' + (chosen.attrs[k] || '').slice(0, 30)));
            return null;
        }
        const q = (v) => "'" + String(v).replace(/'/g, "\\'") + "'";
        const onclick = 'openFile(' + ["''", q(chosen.classId), q(chosen.objId), q(chosen.tableId),
            q(chosen.rowId), q(chosen.fileId), q(chosen.fname), q(chosen.size), "' '", 'false', 'false', 'false'].join(',') + ')';
        return { onclick: onclick, fileName: chosen.fname };
    }

    // Resolve the openFile(...) call for the file the user is viewing at a given
    // item revision, by driving a hidden Agile shell (the same proven pattern
    // the Part Tree uses): navigate the frame to this item's Attachments tab,
    // switch its revision dropdown to revId, let Agile render the real grid, then
    // scrape the matching file's openFile(...) anchor from the rendered DOM.
    // Resolve the openFile(...) call for the file the user is viewing at a given
    // item revision, by driving Agile's OWN page revision dropdown (the native
    // path that always works): switch the live page to revId, let the Attachments
    // grid re-render, scrape the matching file's openFile(...) anchor, then RESTORE
    // the page to the revision the user started on.
    //
    // openFile(...) is NOT safe to replay after restoring — the form it submits
    // also reads the live page's revision/session context, so a past revision's
    // openFile replayed while the page sits on the current rev returns the wrong
    // bytes. Therefore callers that need the FILE (not just the onclick) pass an
    // `inContext(hit)` callback: it runs while the page is still on `revId`, and
    // its resolved value is returned as `.contextResult`.
    function getRevisionAttachment(revId, targetName, inContext) {
        log('AttachRev: switching page to revision', revId, 'for', targetName);
        const sel0 = getRevSelect();
        const originalRevId = (sel0 && sel0.options[sel0.selectedIndex])
            ? String(sel0.options[sel0.selectedIndex].value) : null;

        // changeRevs() reloads the object at the new revision and lands on the
        // TITLE/cover tab (NOT Attachments) — so a rev switch is "ready" once any
        // of: the title block, an attachments grid, or a settled data grid shows.
        const revReady = (content) =>
            !!content.querySelector('dl.side_by_side_text dd[id^="col_"]') ||
            !!document.querySelector('a[onclick*="openFile"]') ||
            isGridReady(content);

        const switchRev = (target) => waitForContentSettle(
            () => runInPageContext(
                '(function(){try{' +
                'var s=document.getElementById("revSelectName");' +
                'if(s){for(var i=0;i<s.options.length;i++){if(String(s.options[i].value)===' +
                JSON.stringify(String(target)) + '){s.selectedIndex=i;break;}}}' +
                'if(typeof changeRevs==="function"){changeRevs();}' +
                '}catch(e){console.error("[AttachRev] rev trigger error",e);}})();'),
            revReady,
            { timeout: 30000, timeoutMsg: 'Timed out loading revision ' + target + '.' }
        );

        // Ensure the Attachments tab is showing its file grid; short-circuit if
        // the page is already on it (rev switch sometimes preserves the tab).
        const openAttachments = () => {
            if (document.querySelector('a[onclick*="openFile"]')) return Promise.resolve();
            log('AttachRev: opening Attachments tab on page');
            return navigateToTab('attachments');
        };

        const restore = () => {
            if (originalRevId == null || originalRevId === String(revId)) return Promise.resolve();
            log('AttachRev: restoring page to revision', originalRevId);
            return switchRev(originalRevId).then(openAttachments)
                .catch((e) => { log('AttachRev: restore failed', e && e.message); });
        };

        // Correct order: switch the revision FIRST (lands on title tab), THEN open
        // Attachments so its grid renders the new revision's files, then scrape.
        return switchRev(revId)
            .then(openAttachments)
            .then(() => {
                const hit = scrapeAttachmentOpenFile(document, targetName);
                if (!hit || !hit.onclick) {
                    const anchors = document.querySelectorAll('a[onclick*="openFile"]').length;
                    return restore().then(() => {
                        throw new Error('No matching attachment found in revision ' + revId +
                            ' (' + anchors + ' file link' + (anchors === 1 ? '' : 's') + ' on this revision).');
                    });
                }
                log('AttachRev: matched', hit.fileName);
                // Run the in-context work (e.g. capture the file bytes) WHILE the
                // page is still on this revision, then restore.
                const ctx = inContext
                    ? Promise.resolve().then(() => inContext(hit))
                    : Promise.resolve(undefined);
                return ctx.then(
                    (contextResult) => restore().then(() => {
                        hit.contextResult = contextResult;
                        return hit;
                    }),
                    (err) => restore().then(() => { throw err; })
                );
            })
            .catch((err) => {
                // switchRev/openAttachments failures land here (page untouched or
                // mid-switch); ensure we attempt a restore before surfacing.
                return restore().then(() => { throw err; });
            });
    }

    // (legacy diagnostic path kept below for reference; no longer the main flow)
    function getRevisionAttachmentLegacy(revId, targetName) {
        log('AttachRev: fetching revision', revId, 'for', targetName);
        return fetchRevisionAttachmentsDoc(revId).then((doc) => {
            const hit = scrapeAttachmentOpenFile(doc, targetName);
            if (hit && hit.onclick) { log('AttachRev: matched', hit.fileName); return hit; }
            // Diagnostics: what did the response actually contain?
            const raw = doc.__rawHtml || '';
            const baseName = attachmentBase(targetName);
            const diag = {
                len: raw.length,
                openFileCalls: (raw.match(/openFile\s*\(/g) || []).length,
                openFileFromRow: (raw.match(/openFileFromRow/g) || []).length,
                hasGrid: /ATTACHMENTS_FILELIST/.test(raw),
                hasRevSelect: /revSelectName/.test(raw),
                hasFileName: baseName ? raw.toLowerCase().indexOf(baseName) >= 0 : false,
                gmDataRows: (raw.match(/GMDataRow/g) || []).length,
                hasGridData: /Grid_Data|Data_Tag|<I\s|gridData|GridData/.test(raw),
                attachmentHandler: (raw.match(/AttachmentHandler/g) || []).length,
                looksLikeLogin: /login-cms|j_username|Please sign in/i.test(raw),
                title: (doc.title || '').slice(0, 80)
            };
            log('AttachRev: no match. diagnostics:', diag);
            // Extract the TreeGrid data-source hints so we can learn how rows load.
            try {
                const gridEl = doc.getElementById('treegrid_ATTACHMENTS_FILELIST') ||
                    doc.querySelector('[id*="ATTACHMENTS_FILELIST"]');
                const grepAttr = (re) => { const m = re.exec(raw); return m ? m[1] : ''; };
                const hints = {
                    treegridTag: gridEl ? (gridEl.outerHTML || '').slice(0, 400) : '(none)',
                    dataUrl: grepAttr(/Data_Url\s*=\s*["']([^"']+)["']/i),
                    dataTag: grepAttr(/Data_Tag\s*=\s*["']([^"']+)["']/i),
                    pageUrl: grepAttr(/Page_Url\s*=\s*["']([^"']+)["']/i),
                    layoutUrl: grepAttr(/Layout_Url\s*=\s*["']([^"']+)["']/i),
                    treegridSrc: grepAttr(/<treegrid[^>]*\sid=["']ATTACHMENTS_FILELIST["'][^>]*>/i) ? 'see raw' : '',
                    ajaxRefs: (raw.match(/ajaxRequest=true[^"'&]*/g) || []).slice(0, 3),
                    startTreeGrid: /StartTreeGrid/.test(raw)
                };
                log('AttachRev: grid data hints:', hints);
                if (gridEl) log('AttachRev: treegrid element HTML:', gridEl.outerHTML);
            } catch (e) { log('AttachRev: hint extraction failed', e); }
            throw new Error('No matching attachment found in revision ' + revId +
                '. [len=' + diag.len + ' openFile=' + diag.openFileCalls +
                ' gmRows=' + diag.gmDataRows + ' fileName=' + diag.hasFileName +
                ' attHandler=' + diag.attachmentHandler + ' gridData=' + diag.hasGridData + ']');
        });
    }

    // Replay an openFile(...) onclick string through the main-page capture hooks
    // (so we get the POST form for the bytes) without needing a real DOM link.
    function captureFileUrlFromOnclick(onclick) {
        const fake = document.createElement('a');
        fake.setAttribute('onclick', onclick);
        return captureFileUrl(fake);
    }

    // ===================================================================
    // Revision DIFF — compare two revisions of the same attachment as text.
    // Text is extracted via the background fetch_file pipeline (same one the
    // preview uses): plain text for txt/code/csv/xml/json/md, and mammoth HTML
    // for .docx (converted to text here). Binary/scanned formats (PDF, images,
    // CAD) have no scriptable text layer in this build, so they report that a
    // text diff isn't available rather than guess.
    // ===================================================================

    // File extensions we can extract diffable text from, mapped to the fileType
    // the background fetch_file handler understands.
    const DIFF_TEXT_TYPES = {
        txt: 'txt', text: 'txt', log: 'txt', csv: 'txt', tsv: 'txt', ini: 'txt', cfg: 'txt',
        json: 'json', xml: 'xml', html: 'html', htm: 'html', md: 'md', markdown: 'md',
        c: 'txt', h: 'txt', cpp: 'txt', cc: 'txt', hpp: 'txt', cs: 'txt', java: 'txt',
        js: 'txt', ts: 'txt', py: 'txt', rb: 'txt', go: 'txt', rs: 'txt', php: 'txt',
        sh: 'txt', ps1: 'txt', bat: 'txt', yaml: 'txt', yml: 'txt', sql: 'txt', vbs: 'txt',
        vhd: 'txt', vhdl: 'txt', v: 'txt', sv: 'txt', tcl: 'txt', m: 'txt', r: 'txt',
        docx: 'docx', doc: 'doc'
    };

    function diffFileTypeFor(fileName) {
        const ext = (String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
        return DIFF_TEXT_TYPES[ext] || null;
    }

    // Convert mammoth-produced HTML into readable plain text, keeping block-level
    // boundaries (paragraphs, list items, table rows, headings) as line breaks so
    // the line diff aligns sensibly.
    function htmlToDiffText(html) {
        const doc = new DOMParser().parseFromString(html || '', 'text/html');
        const blockEls = doc.body.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6');
        if (!blockEls.length) return (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
        const lines = [];
        blockEls.forEach((el) => {
            let line;
            if (el.tagName === 'TR') {
                line = Array.from(el.querySelectorAll('td, th'))
                    .map((c) => (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
                    .join(' | ');
            } else {
                line = (el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            }
            if (line) lines.push(line);
        });
        return lines.join('\n');
    }

    // Render a captured attachment into an OFFSCREEN preview iframe (the exact
    // same path the visible preview uses) and read back the rendered text once
    // content-iframe.js has finished the two-stage download + conversion. This
    // sidesteps re-fetching bytes ourselves (and the zip/bounce-page pitfalls):
    // we just diff what the working renderer produces. Same-origin iframe, so we
    // can read its document.
    function renderCapturedToText(captured, fileType, fileName) {
        return new Promise((resolve, reject) => {
            if (!captured || captured.type !== 'form') { reject(new Error('Could not load this revision\u2019s file.')); return; }
            const host = document.createElement('div');
            host.setAttribute('aria-hidden', 'true');
            host.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1200px;overflow:hidden;visibility:hidden;pointer-events:none;';
            document.body.appendChild(host);

            let settled = false;
            const cleanup = () => { try { host.remove(); } catch (e) {} };
            const done = (text) => { if (settled) return; settled = true; cleanup(); resolve(String(text || '')); };
            const fail = (e) => { if (settled) return; settled = true; cleanup(); reject(e); };

            // Kick off the standard preview render into our hidden host.
            try { openInSidebar(captured, host, fileType); } catch (e) { fail(e); return; }

            // The iframe first loads the Agile "bounce" / completion page ("Please
            // close this dialog when your attachment download is complete") BEFORE
            // content-iframe.js replaces it with the rendered file. We must ignore
            // that interim page and only read once the real render markers appear.
            const isBouncePage = (d) => {
                const t = (d.body.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                return /please close this dialog|attachment download is complete|your download (will|should)/.test(t);
            };
            const isRendered = (d) => {
                if (d.querySelector('.docx-header, .docx-body, .docx-footer')) return true; // docx
                if (d.querySelector('pre')) return true;                                    // txt/json/code
                if (isBouncePage(d)) return false;                                          // still the bounce page
                // Any other non-trivial body that isn't the bounce page.
                return ((d.body.textContent || '').trim().length > 0);
            };

            const readText = () => {
                const iframe = host.querySelector('iframe');
                let d = null;
                try { d = iframe && (iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document)); } catch (e) { d = null; }
                if (!d || !d.body) return null;
                if (!isRendered(d)) return null; // bounce page / not ready yet
                // The docx render is split into .docx-header (page header: doc
                // number, title, revision), .docx-body and .docx-footer. Revision
                // differences often live in the HEADER/FOOTER, so include all three.
                // Fall back to the whole body for non-docx renders. Use innerHTML +
                // block-aware extraction (innerText is unreliable offscreen;
                // textContent loses line breaks).
                const parts = [];
                const header = d.querySelector('.docx-header');
                const bodyEl = d.querySelector('.docx-body');
                const footer = d.querySelector('.docx-footer');
                if (header) { const t = htmlToDiffText(header.innerHTML || ''); if (t) parts.push('[Header]\n' + t); }
                if (bodyEl) { const t = htmlToDiffText(bodyEl.innerHTML || ''); if (t) parts.push(t); }
                if (footer) { const t = htmlToDiffText(footer.innerHTML || ''); if (t) parts.push('[Footer]\n' + t); }
                if (parts.length) return parts.join('\n');
                // Non-docx (plain text, etc.): read the whole rendered body.
                return htmlToDiffText(d.body.innerHTML || '');
            };

            const t0 = Date.now();
            let lastLen = -1, stableSince = 0;
            const poll = () => {
                if (settled) return;
                const txt = readText();
                if (txt != null) {
                    const len = txt.replace(/\s+/g, '').length;
                    // Wait for the body to have real content AND stop growing
                    // (render finished), so we don't read a half-rendered doc.
                    if (len > 0) {
                        if (len === lastLen) {
                            if (Date.now() - stableSince >= 600) { done(txt.trim()); return; }
                        } else { lastLen = len; stableSince = Date.now(); }
                    }
                }
                if (Date.now() - t0 > 25000) {
                    // Timed out: return a real render if we have one; never return
                    // the bounce page (that would read as "no differences").
                    const last = readText();
                    if (last && last.trim()) { done(last.trim()); return; }
                    fail(new Error('Timed out rendering ' + (fileName || 'the file') +
                        ' for comparison (it may have downloaded instead of previewing).'));
                    return;
                }
                setTimeout(poll, 250);
            };
            setTimeout(poll, 400);
        });
    }

    // Get the diffable plain text for a given revision of the attachment.
    // `resolveCapture(revId, targetName)` returns a Promise<{captured, fileName}>
    // for non-current revisions (it knows whether to drive the page dropdown or a
    // hidden frame). The current revision is captured straight from `link`.
    function getRevisionText(revId, currentRevId, link, targetName, resolveCapture) {
        const ft = diffFileTypeFor(targetName);
        if (!ft) {
            return Promise.reject(new Error('Text comparison isn\u2019t available for this file type ('
                + (targetName || 'unknown') + '). PDFs and images have no extractable text in this view.'));
        }

        // Render the captured file via the working preview pipeline (hidden) and
        // read back the text.
        const captureAndRender = (captured, fileName) => {
            const ftThis = diffFileTypeFor(fileName) || ft;
            try {
                log('AttachRev diff render rev=' + revId + ' file=' + fileName + ' ft=' + ftThis);
            } catch (e) { /* ignore */ }
            return renderCapturedToText(captured, ftThis, fileName)
                .then((text) => {
                    try {
                        log('AttachRev diff text rev=' + revId + ' len=' + (text || '').length +
                            ' sample=' + JSON.stringify(String(text || '').slice(0, 400)));
                    } catch (e) { /* ignore */ }
                    return { text: String(text || ''), fileName: fileName };
                });
        };

        const capPromise = (revId === currentRevId)
            ? captureFileUrl(link).then((c) => ({ captured: c, fileName: targetName }))
            : resolveCapture(revId, targetName);
        return capPromise.then(({ captured, fileName }) => captureAndRender(captured, fileName || targetName));
    }

    // ---- Line diff (LCS) with optional word-level highlight ----------------
    // Classic longest-common-subsequence over lines; small/medium docs only, so
    // the O(n*m) DP table is fine. Returns an array of {type, a, b} ops where
    // type is 'same' | 'del' (only in A) | 'add' (only in B).
    function diffLines(aLines, bLines) {
        const n = aLines.length, m = bLines.length;
        // Guard against pathological sizes.
        const CAP = 4000;
        if (n > CAP || m > CAP) {
            // Fall back to a coarse diff: equal prefix/suffix, middle as del+add.
            return coarseDiff(aLines, bLines);
        }
        const dp = new Array(n + 1);
        for (let i = 0; i <= n; i++) { dp[i] = new Int32Array(m + 1); }
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
            if (aLines[i] === bLines[j]) { ops.push({ type: 'same', a: aLines[i], b: bLines[j] }); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', a: aLines[i] }); i++; }
            else { ops.push({ type: 'add', b: bLines[j] }); j++; }
        }
        while (i < n) { ops.push({ type: 'del', a: aLines[i++] }); }
        while (j < m) { ops.push({ type: 'add', b: bLines[j++] }); }
        return ops;
    }

    function coarseDiff(aLines, bLines) {
        const ops = [];
        let s = 0;
        while (s < aLines.length && s < bLines.length && aLines[s] === bLines[s]) {
            ops.push({ type: 'same', a: aLines[s], b: bLines[s] }); s++;
        }
        let ea = aLines.length, eb = bLines.length;
        const tail = [];
        while (ea > s && eb > s && aLines[ea - 1] === bLines[eb - 1]) {
            tail.unshift({ type: 'same', a: aLines[ea - 1], b: bLines[eb - 1] }); ea--; eb--;
        }
        for (let k = s; k < ea; k++) ops.push({ type: 'del', a: aLines[k] });
        for (let k = s; k < eb; k++) ops.push({ type: 'add', b: bLines[k] });
        return ops.concat(tail);
    }

    // Word-level diff between two single lines -> {aHtml, bHtml} with <del>/<ins>.
    function diffWords(a, b) {
        const aw = a.split(/(\s+)/);
        const bw = b.split(/(\s+)/);
        const n = aw.length, m = bw.length;
        const dp = [];
        for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = (aw[i] === bw[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        let i = 0, j = 0, aHtml = '', bHtml = '';
        while (i < n && j < m) {
            if (aw[i] === bw[j]) { aHtml += escapeHtml(aw[i]); bHtml += escapeHtml(bw[j]); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { aHtml += '<del>' + escapeHtml(aw[i]) + '</del>'; i++; }
            else { bHtml += '<ins>' + escapeHtml(bw[j]) + '</ins>'; j++; }
        }
        while (i < n) { aHtml += '<del>' + escapeHtml(aw[i++]) + '</del>'; }
        while (j < m) { bHtml += '<ins>' + escapeHtml(bw[j++]) + '</ins>'; }
        return { aHtml, bHtml };
    }

    // Render the diff ops into the preview body. Adjacent del/add blocks of equal
    // size get word-level highlighting so small edits are easy to spot.
    function renderRevisionDiff(container, ops, labelA, labelB) {
        let added = 0, removed = 0;
        ops.forEach((o) => { if (o.type === 'add') added++; else if (o.type === 'del') removed++; });

        const rows = [];
        for (let k = 0; k < ops.length; k++) {
            const o = ops[k];
            if (o.type === 'same') {
                rows.push({ cls: 'same', gut: '', html: escapeHtml(o.a) || '&nbsp;' });
                continue;
            }
            // Pair a run of dels with a following run of adds for word highlight.
            if (o.type === 'del') {
                const dels = [];
                while (k < ops.length && ops[k].type === 'del') { dels.push(ops[k].a); k++; }
                const adds = [];
                while (k < ops.length && ops[k].type === 'add') { adds.push(ops[k].b); k++; }
                k--; // for-loop will ++ back
                const pairs = Math.min(dels.length, adds.length);
                for (let p = 0; p < pairs; p++) {
                    const w = diffWords(dels[p], adds[p]);
                    rows.push({ cls: 'del', gut: '\u2212', html: w.aHtml || '&nbsp;' });
                    rows.push({ cls: 'add', gut: '+', html: w.bHtml || '&nbsp;' });
                }
                for (let p = pairs; p < dels.length; p++) rows.push({ cls: 'del', gut: '\u2212', html: escapeHtml(dels[p]) || '&nbsp;' });
                for (let p = pairs; p < adds.length; p++) rows.push({ cls: 'add', gut: '+', html: escapeHtml(adds[p]) || '&nbsp;' });
                continue;
            }
            // A run of adds with no preceding del.
            if (o.type === 'add') {
                rows.push({ cls: 'add', gut: '+', html: escapeHtml(o.b) || '&nbsp;' });
            }
        }

        let html = '<div class="revdiff2-head">' +
            '<span class="revdiff2-leg"><span class="revdiff2-sw del"></span>Removed (' + escapeHtml(labelA) + ')</span>' +
            '<span class="revdiff2-leg"><span class="revdiff2-sw add"></span>Added (' + escapeHtml(labelB) + ')</span>' +
            '<span class="revdiff2-summary">' + added + ' added \u00B7 ' + removed + ' removed</span>' +
            '</div>';
        if (added === 0 && removed === 0) {
            html += '<div class="revdiff2-empty">No text differences between these revisions.</div>';
        } else {
            html += rows.map((r) =>
                '<div class="revdiff2-row ' + r.cls + '"><span class="gut">' + r.gut + '</span><span class="txt">' + r.html + '</span></div>'
            ).join('');
        }
        container.innerHTML = '<div class="revdiff2">' + html + '</div>';
    }

    // Run a full compare between two revisions and paint the result into `body`.
    function runRevisionCompare(body, revAId, revBId, currentRevId, link, targetName, labelA, labelB, resolveCapture) {
        body.innerHTML = '<div class="preview-loading">Comparing revisions\u2026</div>';
        // Sequential, NOT parallel: both sides may drive the same page/frame
        // revision dropdown, so running them at once would race. Resolve A fully
        // before starting B.
        return getRevisionText(revAId, currentRevId, link, targetName, resolveCapture)
            .then((a) => getRevisionText(revBId, currentRevId, link, targetName, resolveCapture)
                .then((b) => [a, b]))
            .then(([a, b]) => {
                const aLines = String(a.text).replace(/\r\n?/g, '\n').split('\n');
                const bLines = String(b.text).replace(/\r\n?/g, '\n').split('\n');
                const ops = diffLines(aLines, bLines);
                renderRevisionDiff(body, ops, labelA, labelB);
            }).catch((err) => {
                body.innerHTML = '<div class="preview-error">' + escapeHtml((err && err.message) || String(err)) + '</div>';
            });
    }

    // Build the revision dropdown bar at the top of a preview panel and wire it
    // to switch the previewed attachment between item revisions. No-op unless
    // this is an attachment (openFile-based) and the item has >= 2 revisions.
    // On a Change/ECO page you can preview an affected item's attachment, but the
    // page has no revSelectName, so the revision dropdown can't come from it.
    // Detect the affected ITEM (classId, objId) for the redline attachments being
    // shown, so we can load that item in a hidden frame to read its revisions.
    function detectEcoAttachmentItem() {
        // The redline attachments sub-tab carries a title like "Redlines for <Item>".
        let itemNum = '';
        const titles = document.querySelectorAll('h4, [id^="view_controls_tabletitle"] h4');
        for (const h of titles) {
            const m = /redlines?\s+for\s+(.+)/i.exec((h.textContent || '').replace(/\s+/g, ' ').trim());
            if (m) { itemNum = m[1].trim(); break; }
        }
        if (!itemNum) return null;
        const re = /displayItem\s*\(\s*['"]ItemHandler['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/;
        let found = null;
        document.querySelectorAll('a[onclick*="displayItem"]').forEach((a) => {
            if (found) return;
            const t = (a.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (t === itemNum) {
                const m = re.exec(a.getAttribute('onclick') || '');
                if (m) found = { classId: m[1], objId: m[2], titleTab: '0', itemNum: itemNum };
            }
        });
        log('AttachRev: detectEcoAttachmentItem itemNum=' + JSON.stringify(itemNum) + ' found=', found);
        return found;
    }

    // Resolve once the preview sessionStorage flag is no longer set (or after a
    // safety timeout), so the hidden revision frame can boot without stealing the
    // active preview's flag (content-iframe.js activates on that flag in ANY frame).
    function waitForPreviewFlagClear() {
        return new Promise((resolve) => {
            const t0 = Date.now();
            (function poll() {
                let v = null;
                try { v = sessionStorage.getItem(PREVIEW_FLAG); } catch (e) { v = null; }
                if (!v || Date.now() - t0 > 6000) { resolve(); return; }
                setTimeout(poll, 200);
            })();
        });
    }

    // Boot the hidden Agile shell and navigate it to the given item, waiting until
    // its revision dropdown (revSelectName) is available in the frame.
    function framePrepareItem(nav) {
        return ensureAttachFrame().then(() => {
            log('AttachRev: frame navigating to item', nav.classId, nav.objId);
            return attachFrameDrive(
                () => runInAttachFrame("try{displayObject('ItemHandler','" + nav.classId +
                    "','" + nav.objId + "','" + (nav.titleTab || '0') + "');}catch(e){console.error('[AttachRev] eco nav',e);}"),
                (content, d) => frameContentLoaded(content) && !!(d && d.getElementById('revSelectName')),
                { timeout: 30000, timeoutMsg: 'Timed out loading the item\u2019s revisions.' }
            );
        });
    }

    // Read the revision options from the frame's revSelectName.
    function frameGetRevisionOptions() {
        const d = attachFrameDoc();
        const sel = d && d.getElementById('revSelectName');
        if (!sel) return [];
        return Array.from(sel.options).map((o) => ({
            id: String(o.value),
            label: (o.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || o.value
        }));
    }

    function frameCurrentRevId() {
        const d = attachFrameDoc();
        const sel = d && d.getElementById('revSelectName');
        if (sel && sel.options[sel.selectedIndex]) return String(sel.options[sel.selectedIndex].value);
        return null;
    }

    // Switch the frame to revId, open its Attachments tab, scrape the file's
    // openFile(...) call. The onclick fully identifies the attachment object, so
    // it can be replayed/captured from the main page afterwards.
    //
    // The Attachments grid (EJS TreeGrid) loads its rows ASYNCHRONOUSLY from a
    // separate request, so the openFile(...) anchors appear a beat AFTER the tab
    // re-renders. The strict "fresh render settle" of attachFrameDrive expires
    // before that, so instead we switch the revision, click the Attachments tab
    // once, then POLL the frame document until the matching openFile link shows.
    function frameGetRevisionAttachment(revId, targetName) {
        return frameSwitchRevision(revId).then(() => {
            log('AttachRev: frame opening Attachments + polling for openFile');
            // Click the Attachments tab in the frame (by caption).
            const re = TAB_MATCHERS.attachments;
            const reSource = re.source.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const reFlags = re.flags;
            const clickAttachments = () => runInAttachFrame(
                '(function(){try{' +
                'var re=new RegExp(\'' + reSource + '\',\'' + reFlags + '\');' +
                'var links=document.querySelectorAll(".tabConButton, .tabname, .tabnames a, .tabConButtonSel, td a, li a, a");' +
                'for(var i=0;i<links.length;i++){var t=(links[i].textContent||"").replace(/\\s+/g," ").trim();' +
                'if(t&&re.test(t)){links[i].click();return;}}' +
                '}catch(e){console.error("[AttachRev] tab trigger error",e);}})();');

            return new Promise((resolve, reject) => {
                const t0 = Date.now();
                let clickedAt = 0;
                const tick = () => {
                    const d = attachFrameDoc();
                    if (!d) { reject(new Error('Attachment frame unavailable.')); return; }
                    // Re-click the tab every ~2.5s in case the first click landed
                    // before the tab strip was ready.
                    if (Date.now() - clickedAt > 2500) { clickAttachments(); clickedAt = Date.now(); }
                    const hit = scrapeAttachmentOpenFile(d, targetName);
                    if (hit && hit.onclick) { log('AttachRev: frame matched', hit.fileName); resolve(hit); return; }
                    if (/no\s+(attachments|files|rows)/i.test((d.body && d.body.textContent) || '')) {
                        reject(new Error('Revision ' + revId + ' has no attachments.')); return;
                    }
                    if (Date.now() - t0 > 25000) {
                        const anchors = d.querySelectorAll('a[onclick*="openFile"]').length;
                        reject(new Error('No matching attachment found in revision ' + revId +
                            ' (' + anchors + ' file link' + (anchors === 1 ? '' : 's') + ').'));
                        return;
                    }
                    setTimeout(tick, 300);
                };
                setTimeout(tick, 300);
            });
        });
    }

    // Entry point: decide where the revision list comes from and build the bar.
    //  - Item page: the page's own revSelectName dropdown (drives the page).
    //  - Change/ECO page: load the affected item in a hidden frame for revisions.
    function buildAttachmentRevBar(panel, body, link, params, initialFileType) {
        // EXPERIMENTAL (shelved — the hidden Agile frame + page revision switching
        // corrupted Agile's TreeGrid: "fatal error, TreeGrid cannot render").
        // Disabled so attachment previews work normally. Source stashed under
        // experimental/preview-revision-diff/. To re-enable, remove this return.
        return;
        // eslint-disable-next-line no-unreachable
        const onclick0 = onclickForTrigger(link) || '';
        if (!/openFile/.test(onclick0)) { log('AttachRev bar: link has no openFile, skipping'); return; }

        const existing = panel.querySelector('.preview-revbar');
        if (existing) existing.remove();

        // 1) Item page: use the page's revision dropdown directly.
        const pageOptions = getRevisionOptions();
        log('AttachRev bar: page rev options =', pageOptions.length);
        if (pageOptions.length >= 2) {
            const sel0 = getRevSelect();
            const currentRevId = (sel0 && sel0.options[sel0.selectedIndex])
                ? String(sel0.options[sel0.selectedIndex].value)
                : (pageOptions[0] && pageOptions[0].id);
            const resolveCapture = (revId, target) => getRevisionAttachment(revId, target,
                (hit) => captureFileUrlFromOnclick(hit.onclick).then((c) => ({ captured: c, fileName: hit.fileName }))
            ).then((hit) => hit.contextResult);
            renderRevBar(panel, body, link, params, initialFileType, pageOptions, currentRevId, resolveCapture);
            return;
        }

        // 2) Change/ECO page: no page dropdown — load the affected item in a frame.
        const nav = detectEcoAttachmentItem();
        log('AttachRev bar: ECO item detected =', nav);
        if (!nav) { log('AttachRev bar: no affected item found, no rev bar'); return; }
        // Temporary bar so the user knows revisions are loading.
        const tempBar = document.createElement('div');
        tempBar.className = 'preview-revbar';
        tempBar.innerHTML = '<span class="preview-revbar-label">Revision</span>' +
            '<span class="preview-revbar-status">Loading revisions\u2026</span>';
        panel.insertBefore(tempBar, body);
        // The hidden Agile frame runs content-iframe.js, which activates whenever
        // the PREVIEW_FLAG sessionStorage key is set. Booting the frame while the
        // current preview's flag is still set would let the hidden frame consume
        // that flag and break the visible preview. Wait for the flag to clear.
        waitForPreviewFlagClear().then(() => framePrepareItem(nav)).then(() => {
            const opts = frameGetRevisionOptions();
            log('AttachRev bar: frame rev options =', opts.length, opts.map((o) => o.label));
            if (opts.length < 2) {
                tempBar.querySelector('.preview-revbar-status').textContent =
                    'Only one revision (' + opts.length + ') \u2014 nothing to compare.';
                setTimeout(() => tempBar.remove(), 2500);
                return;
            }
            const currentRevId = frameCurrentRevId() || (opts[0] && opts[0].id);
            const resolveCapture = (revId, target) => frameGetRevisionAttachment(revId, target)
                .then((hit) => captureFileUrlFromOnclick(hit.onclick).then((c) => ({ captured: c, fileName: hit.fileName })));
            tempBar.remove();
            renderRevBar(panel, body, link, params, initialFileType, opts, currentRevId, resolveCapture);
        }).catch((err) => {
            log('AttachRev: ECO rev bar failed', err && err.message);
            const st = tempBar.querySelector('.preview-revbar-status');
            if (st) st.textContent = 'Revisions unavailable: ' + ((err && err.message) || 'error');
            setTimeout(() => tempBar.remove(), 4000);
        });
    }

    // Build the revision dropdown bar UI given a resolved revision source.
    function renderRevBar(panel, body, link, params, initialFileType, revOptions, currentRevId, resolveCapture) {

        const bar = document.createElement('div');
        bar.className = 'preview-revbar';
        const label = document.createElement('span');
        label.className = 'preview-revbar-label';
        label.textContent = 'Revision';
        const select = document.createElement('select');
        select.className = 'preview-revbar-select';
        revOptions.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.label;
            if (o.id === currentRevId) opt.selected = true;
            select.appendChild(opt);
        });
        const status = document.createElement('span');
        status.className = 'preview-revbar-status';

        // Second dropdown + "vs" shown only while comparing (the primary select
        // becomes "From / A", this one is "To / B").
        const vsLabel = document.createElement('span');
        vsLabel.className = 'preview-revbar-vs';
        vsLabel.textContent = 'vs';
        vsLabel.style.display = 'none';
        const select2 = document.createElement('select');
        select2.className = 'preview-revbar-select';
        select2.style.display = 'none';
        revOptions.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.label;
            select2.appendChild(opt);
        });
        // Default B = current revision; A (primary) = next different revision.
        select2.value = currentRevId;
        const otherDefault = revOptions.find((o) => o.id !== currentRevId);

        const compareBtn = document.createElement('button');
        compareBtn.type = 'button';
        compareBtn.className = 'preview-revbar-compare';
        compareBtn.textContent = 'Compare';
        const diffable = !!diffFileTypeFor(params.fileName);

        bar.appendChild(label);
        bar.appendChild(select);
        bar.appendChild(vsLabel);
        bar.appendChild(select2);
        bar.appendChild(status);
        if (diffable) bar.appendChild(compareBtn);
        panel.insertBefore(bar, body);

        const titleEl = panel.querySelector('.preview-header-title');
        let compareMode = false;

        // Render the single-revision preview for whatever the primary select is on.
        function showSinglePreview() {
            const revId = select.value;
            const revLabel = (select.options[select.selectedIndex].textContent || revId).trim();
            status.textContent = '';
            // Current revision: just re-render from the original link.
            if (revId === currentRevId) {
                if (titleEl) titleEl.textContent = params.fileName;
                body.innerHTML = '<div class="preview-loading">Loading preview\u2026</div>';
                captureFileUrl(link).then((c) => {
                    if (!c) { body.innerHTML = '<div class="preview-error">Could not capture the file.</div>'; return; }
                    openInSidebar(c, body, initialFileType);
                });
                return;
            }
            body.innerHTML = '<div class="preview-loading">Loading revision ' + escapeHtml(revLabel) + '\u2026</div>';
            resolveCapture(revId, params.fileName).then(({ captured, fileName }) => {
                const ft = getFileExtFromName(fileName);
                if (titleEl) titleEl.textContent = fileName || params.fileName;
                if (!ft) {
                    body.innerHTML = '<div class="preview-error">This revision\u2019s file (' +
                        escapeHtml(fileName || params.fileName) + ') can\u2019t be previewed.</div>';
                    return;
                }
                if (!captured) {
                    body.innerHTML = '<div class="preview-error">Could not capture this revision\u2019s file.</div>';
                    return;
                }
                openInSidebar(captured, body, ft);
            }).catch((err) => {
                body.innerHTML = '<div class="preview-error">' + escapeHtml((err && err.message) || String(err)) + '</div>';
            });
        }

        // Run the diff for the two selected revisions (A = primary, B = select2).
        function showCompare() {
            const aId = select.value, bId = select2.value;
            const aLabel = (select.options[select.selectedIndex].textContent || aId).trim();
            const bLabel = (select2.options[select2.selectedIndex].textContent || bId).trim();
            if (aId === bId) {
                body.innerHTML = '<div class="revdiff2-empty">Pick two different revisions to compare.</div>';
                return;
            }
            if (titleEl) titleEl.textContent = params.fileName + '  \u2014  diff';
            runRevisionCompare(body, aId, bId, currentRevId, link, params.fileName, aLabel, bLabel, resolveCapture);
        }

        select.addEventListener('change', () => { if (compareMode) showCompare(); else showSinglePreview(); });
        select2.addEventListener('change', () => { if (compareMode) showCompare(); });

        compareBtn.addEventListener('click', () => {
            compareMode = !compareMode;
            compareBtn.classList.toggle('active', compareMode);
            if (compareMode) {
                compareBtn.textContent = 'Exit compare';
                label.textContent = 'From';
                vsLabel.style.display = '';
                select2.style.display = '';
                // Default to comparing the previous revision (A) against current (B).
                if (otherDefault) select.value = otherDefault.id;
                select2.value = currentRevId;
                showCompare();
            } else {
                compareBtn.textContent = 'Compare';
                label.textContent = 'Revision';
                vsLabel.style.display = 'none';
                select2.style.display = 'none';
                select.value = currentRevId;
                showSinglePreview();
            }
        });
    }

    // --- Preview Sidebar ---
    let isPinned = false;
    // The sign-in footer of the currently open external preview. Revealed only
    // when the background script detects a framing block (SSO refused to embed).
    let activeSignInNote = null;
    // The primary part number detected on the current page (page-title <h2>).
    // Used by the Current Status dashboard button.
    let detectedPartNumber = null;
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
        document.body.appendChild(overlay);

        // The overlay is click-through (so the page stays interactive), so we
        // detect "click outside the panel" at the document level instead. When
        // not pinned, clicking anywhere outside the panel closes the preview.
        const outsideClick = (e) => {
            if (isPinned) return;
            const panel = document.querySelector('.preview-panel');
            if (!panel) {
                document.removeEventListener('mousedown', outsideClick, true);
                return;
            }
            // Decide inside/outside by GEOMETRY, not panel.contains(e.target):
            // panels that rebuild their own DOM (e.g. the Part Tree canvas) can
            // detach the clicked node mid-interaction, which would make
            // `contains` falsely report "outside" and close the panel.
            const r = panel.getBoundingClientRect();
            const inside = e.clientX >= r.left && e.clientX <= r.right &&
                e.clientY >= r.top && e.clientY <= r.bottom;
            if (inside) return;
            if (panel.contains(e.target)) return;
            // Ignore clicks on the buttons that open/refresh the preview.
            if (e.target.closest && e.target.closest('.preview-btn, .ref-pdf-btn')) return;
            document.removeEventListener('mousedown', outsideClick, true);
            clearPageInset();
            overlay.remove();
            panel.remove();
        };
        // Defer attaching so the click that opened the panel doesn't close it.
        setTimeout(() => {
            document.addEventListener('mousedown', outsideClick, true);
        }, 0);

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
                    dlBtn.onclick = () => { triggerDownload(link); };
                }
                captureFileUrl(link).then((captured) => {
                    if (!captured) {
                        body.innerHTML = '<div class="preview-error">Could not capture download URL.</div>';
                        return;
                    }
                    body.innerHTML = '<div class="preview-loading">Loading preview\u2026</div>';
                    openInSidebar(captured, body, fileType);
                    // Build the revision bar AFTER capture: on ECO pages it boots a
                    // hidden Agile frame, which must not race the capture above.
                    buildAttachmentRevBar(existingPanel, body, link, params, fileType);
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
            // Pinned: remove the dim overlay so the page stays visible and
            // interactive, and reflow the page so its content sits to the LEFT
            // of the panel (margin-right inset only — see applyPageInset).
            if (isPinned) {
                overlay.style.display = 'none';
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
        downloadBtn.addEventListener('click', () => { triggerDownload(link); });

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
            // Build the revision bar AFTER capture: the ECO path boots a hidden
            // Agile frame, which must not race the capture above (that race made
            // the original openFile leak through and download the file).
            buildAttachmentRevBar(panel, body, link, params, fileType);
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

        // Submit from the ISOLATED world, whose HTMLFormElement.prototype.submit
        // is NOT hooked (only the MAIN-world prototype is), so this performs a
        // normal submission targeting our named iframe with cookies included.
        form.submit();
        form.remove();

        // Keep the flag set long enough for the bounce iframe to load and run the
        // MAIN-world interception hooks (page-iframe-hooks.js) at document_start.
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

    // --- Top-right fixed stack layout --------------------------------------
    // Several injected elements share a vertical stack pinned under the Agile
    // parametric-search toolbar button, right edges aligned: Fireman Manual,
    // Current Status, Part Tree. They collapse UPWARD so there is never a gap —
    // if a higher element is absent/hidden, the ones below shift up to fill its
    // slot. The EOQ FCO warning sits to the LEFT of the Fireman Manual slot (or
    // takes that slot itself when the Fireman Manual button is not present).
    const RIGHT_STACK_ORDER = ['.ref-pdf-btn', '.partstatus-btn', '.parttree-btn'];
    const RIGHT_STACK_TOP = 16;    // first slot offset below the anchor's bottom
    const RIGHT_STACK_STEP = 32;   // vertical distance between slots

    function isStackVisible(el) {
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function layoutRightStack() {
        const anchor = document.getElementById('top_paramSearch');
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && rect.right === 0) return; // not laid out yet
        const rightGap = Math.max(8, Math.round(window.innerWidth - rect.right));
        const baseTop = Math.round(rect.bottom);
        // Assign each present element the next free slot (collapsing upward).
        let firemanTop = null, firemanRight = null;
        let slot = 0;
        RIGHT_STACK_ORDER.forEach((selDiv) => {
            const el = document.querySelector(selDiv);
            if (!isStackVisible(el)) return;
            const top = baseTop + RIGHT_STACK_TOP + slot * RIGHT_STACK_STEP;
            el.style.left = 'auto';
            el.style.right = rightGap + 'px';
            el.style.top = top + 'px';
            if (selDiv === '.ref-pdf-btn') { firemanTop = top; }
            slot++;
        });
        // EOQ FCO warning: to the LEFT of the Fireman Manual button, or in the
        // top slot when the Fireman Manual button is absent.
        const warn = document.querySelector('.eoq-fco-fixed');
        if (warn && isStackVisible(warn)) {
            const fireman = document.querySelector('.ref-pdf-btn');
            warn.style.left = 'auto';
            if (isStackVisible(fireman)) {
                const fr = fireman.getBoundingClientRect();
                warn.style.right = Math.max(8, Math.round(window.innerWidth - fr.left + 8)) + 'px';
                warn.style.top = Math.round(fr.top) + 'px';
            } else {
                warn.style.right = rightGap + 'px';
                warn.style.top = (baseTop + RIGHT_STACK_TOP) + 'px';
            }
        }
    }

    let rightStackBound = false;
    function scheduleRightStackLayout() {
        requestAnimationFrame(layoutRightStack);
        [0, 150, 400, 900, 1800].forEach((d) => setTimeout(layoutRightStack, d));
        if (rightStackBound) return;
        rightStackBound = true;
        window.addEventListener('resize', layoutRightStack);
        window.addEventListener('scroll', layoutRightStack, true);
        const anchor = document.getElementById('top_paramSearch');
        if (anchor && typeof ResizeObserver !== 'undefined') {
            try { new ResizeObserver(layoutRightStack).observe(anchor); } catch (e) { /* ignore */ }
        }
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

        // Position within the collapsing top-right fixed stack.
        scheduleRightStackLayout();

        log('Reference PDF button injected:', url);
    }

    // ===================================================================
    // Current Status dashboard
    // Aggregates live data about the page's part number from MVDB (apex) and
    // Azure DevOps. Each source is queried first-party inside a hidden iframe
    // (content-mvdb.js / content-azure.js) which postMessages results back —
    // the same cross-origin/cookie workaround proven by the ECHO lookup.
    // ===================================================================
    const STATUS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M3 12h4l2 6 4-14 2 8h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';

    function getCurrentPartNumber() {
        // Always read the CURRENT page-title heading first so that navigating
        // to a different part in Agile updates the status target. The cached
        // detectedPartNumber is only a fallback if no title is present.
        const headings = document.querySelectorAll('.column_one h2, h2.page-title, .layout h2');
        for (const h2 of headings) {
            // Read only the first text node (before any injected <button>).
            let raw = '';
            for (const node of h2.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) { raw += node.textContent; }
                else break;
            }
            const candidate = (raw || '').trim();
            if (isPartNumber(candidate)) return candidate;
        }
        return detectedPartNumber;
    }

    function statusEscape(s) {
        return String(s == null ? '' : s)
            .replace(/@<[^>]*>/g, '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fieldRow(key, value) {
        if (value == null || value === '') return '';
        return '<div class="status-field"><span class="k">' + statusEscape(key) +
            '</span><span class="v">' + statusEscape(value) + '</span></div>';
    }

    function renderMvdbBody(bodyEl, badgeEl, state) {
        if (state.loading) {
            badgeEl.textContent = 'Loading';
            badgeEl.className = 'status-badge';
            bodyEl.innerHTML = '<div class="status-loading">' +
                '<div class="preview-spinner"></div><span>Querying MVDB\u2026</span></div>';
            return;
        }
        if (!state.ok) {
            badgeEl.textContent = state.error === 'signin' ? 'Sign-in' : 'Unavailable';
            badgeEl.className = 'status-badge is-bad';
            let html = '<div class="status-error">' + statusEscape(state.message || 'MVDB unavailable.') + '</div>';
            if (state.error === 'signin') {
                html += '<button type="button" class="status-signin-btn" ' +
                    'data-signin="https://apex.natinst.com/">Open MVDB to sign in</button>';
            }
            bodyEl.innerHTML = html;
            return;
        }
        if (state.empty || (!state.data && !(state.rows && state.rows.length))) {
            badgeEl.textContent = 'Not found';
            badgeEl.className = 'status-badge';
            bodyEl.innerHTML = '<div class="status-muted">No MVDB document found for this part.</div>';
            return;
        }
        const rows = (state.rows && state.rows.length) ? state.rows : (state.data ? [state.data] : []);
        badgeEl.textContent = rows.length > 1
            ? rows.length + ' items'
            : ((rows[0].key && (rows[0].key.phase || rows[0].key.entryStatus)) || 'Found');
        badgeEl.className = 'status-badge is-ok';
        bodyEl.innerHTML = rows.map((d, i) => renderMvdbRow(d, i, rows.length)).join('');
    }

    // The only MVDB columns worth surfacing (matched loosely by header label).
    // Anything not in this list is ignored so the panel stays focused.
    const MVDB_PREFERRED = [
        'phase', 'entry status', 'goal run', 'days since handoff', 'days since',
        'job qty', 'job quantity', 'doctype', 'doc type', 'finish date'
    ];

    function mvdbFieldRank(label) {
        const n = String(label || '').toLowerCase();
        for (let i = 0; i < MVDB_PREFERRED.length; i++) {
            if (n.indexOf(MVDB_PREFERRED[i]) !== -1) return i;
        }
        return -1;
    }

    function renderMvdbRow(d, idx, total) {
        // Support both the new {fields,key,link} shape and a legacy flat object.
        const key = d.key || d;
        const link = d.link || d.__link;
        let fields = Array.isArray(d.fields) ? d.fields.slice() : null;
        if (!fields) {
            // Legacy fallback: synthesize from known keys.
            fields = [
                { label: 'Phase', value: key.phase },
                { label: 'Goal Run Date', value: key.goalRunDate },
                { label: 'Entry Status', value: key.entryStatus },
                { label: 'Job Qty', value: key.jobQty },
                { label: 'Days Since Handoff', value: key.daysSinceHandoff },
                { label: 'Doctype', value: key.docType }
            ];
        }
        // Keep ONLY the necessary fields (allowlist), then order them.
        fields = fields
            .filter((f) => f && f.value && mvdbFieldRank(f.label) !== -1)
            .sort((a, b) => mvdbFieldRank(a.label) - mvdbFieldRank(b.label));

        let head = '';
        if (total > 1) {
            const label = key.docId || key.assemblyPn || ('Item ' + (idx + 1));
            head = '<div class="status-mvdb-head">' +
                (link
                    ? '<a class="status-mvdb-link" href="' + statusEscape(link) +
                      '" target="_blank" rel="noopener">' + statusEscape(label) + '</a>'
                    : '<span>' + statusEscape(label) + '</span>') +
                (key.phase ? '<span class="status-badge is-ok">' + statusEscape(key.phase) + '</span>' : '') +
                '</div>';
        }
        const fieldHtml = fields.map((f) => fieldRow(f.label, f.value)).join('');
        let openLink = '';
        if (link && total <= 1) {
            openLink = '<a class="status-mvdb-open" href="' + statusEscape(link) +
                '" target="_blank" rel="noopener">Open in MVDB \u2197</a>';
        }
        return '<div class="status-mvdb-item">' + head + fieldHtml + openLink + '</div>';
    }

    function renderAzureBody(bodyEl, badgeEl, state) {
        if (state.loading) {
            badgeEl.textContent = 'Loading';
            badgeEl.className = 'status-badge';
            bodyEl.innerHTML = '<div class="status-loading">' +
                '<div class="preview-spinner"></div><span>Querying Azure DevOps\u2026</span></div>';
            return;
        }
        if (!state.ok) {
            badgeEl.textContent = state.error === 'signin' ? 'Sign-in' : 'Unavailable';
            badgeEl.className = 'status-badge is-bad';
            let html = '<div class="status-error">' + statusEscape(state.message || 'Azure DevOps unavailable.') + '</div>';
            if (state.error === 'signin') {
                html += '<button type="button" class="status-signin-btn" ' +
                    'data-signin="https://dev.azure.com/ni/DevCentral">Open Azure DevOps to sign in</button>';
            }
            bodyEl.innerHTML = html;
            return;
        }
        const items = state.items || [];
        const open = items.filter((it) => !it.closed);
        if (!items.length) {
            badgeEl.textContent = 'None';
            badgeEl.className = 'status-badge';
            bodyEl.innerHTML = '<div class="status-muted">No work items reference this part.</div>';
            return;
        }
        const closedCount = items.length - open.length;
        badgeEl.textContent = open.length + ' open / ' + items.length + ' total';
        badgeEl.className = open.length ? 'status-badge is-warn' : 'status-badge is-ok';

        // Show every matched item (open first), each with its discussion.
        const ordered = open.concat(items.filter((it) => it.closed));
        bodyEl.innerHTML = ordered.map(renderWorkItem).join('');
    }

    function clip(text, max) {
        const s = String(text || '').trim();
        if (s.length <= max) return s;
        return s.slice(0, max).replace(/\s+\S*$/, '') + '\u2026';
    }

    function renderWorkItem(it) {
        let html = '<div class="status-wi' + (it.closed ? ' is-closed' : '') + '">';
        html += '<div class="status-wi-title">' +
            '<span class="status-wi-id">#' + statusEscape(it.id) + '</span>' +
            '<span>' + statusEscape(it.title) + '</span></div>';
        html += '<div class="status-wi-meta">' +
            '<span class="status-wi-state' + (it.closed ? '' : ' is-open') + '">' +
            statusEscape(it.state) + '</span> ' +
            statusEscape(it.type) +
            (it.assignedTo ? ' \u00b7 ' + statusEscape(it.assignedTo) : '') + '</div>';

        if (it.description) {
            html += '<div class="status-wi-field"><span class="lbl">Description</span> ' +
                statusEscape(clip(it.description, 280)) + '</div>';
        }
        if (it.acceptanceCriteria) {
            html += '<div class="status-wi-field"><span class="lbl">Acceptance criteria</span> ' +
                statusEscape(clip(it.acceptanceCriteria, 280)) + '</div>';
        }
        if (it.reproSteps) {
            html += '<div class="status-wi-field"><span class="lbl">Repro steps</span> ' +
                statusEscape(clip(it.reproSteps, 280)) + '</div>';
        }

        const comments = (it.comments || []).slice();
        // Comments come newest-first from the API; show the latest few.
        if (comments.length) {
            html += '<div class="status-wi-discussion"><span class="lbl">Discussion (' +
                comments.length + ')</span>';
            comments.slice(0, 4).forEach((c) => {
                html += '<div class="status-comment"><span class="who">' + statusEscape(c.by) +
                    '</span>: ' + statusEscape(clip(c.text, 240)) + '</div>';
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function computeRollup(rollupEl, textEl, mvdb, azure) {
        // Heuristic, clearly-labelled summary — not a system of record.
        const openCount = (azure && azure.ok && azure.items)
            ? azure.items.filter((it) => !it.closed).length : 0;
        const anyError = (mvdb && !mvdb.loading && !mvdb.ok) ||
            (azure && !azure.loading && !azure.ok);
        const stillLoading = (mvdb && mvdb.loading) || (azure && azure.loading);

        if (stillLoading) {
            rollupEl.className = 'status-rollup is-partial';
            textEl.textContent = 'Gathering status\u2026';
            return;
        }
        if (openCount > 0) {
            rollupEl.className = 'status-rollup is-warn';
            textEl.textContent = 'Needs attention \u2014 ' + openCount +
                ' open work item' + (openCount === 1 ? '' : 's');
        } else if (anyError) {
            rollupEl.className = 'status-rollup is-partial';
            textEl.textContent = 'Partial status \u2014 some sources unavailable';
        } else {
            rollupEl.className = 'status-rollup is-clear';
            textEl.textContent = 'Looks clear \u2014 no open work items';
        }
    }

    // Build a plain-language summary paragraph synthesizing both sources once
    // they have finished loading. Clearly labelled as an auto-generated digest.
    function renderSummary(summaryEl, partNum, mvdb, azure) {
        if (!summaryEl) return;
        const stillLoading = (mvdb && mvdb.loading) || (azure && azure.loading);
        if (stillLoading) {
            summaryEl.innerHTML = '<div class="status-loading">' +
                '<div class="preview-spinner"></div><span>Building summary\u2026</span></div>';
            return;
        }

        const lines = [];

        // MVDB sentence.
        const mvdbRows = (mvdb && mvdb.ok && mvdb.rows && mvdb.rows.length)
            ? mvdb.rows : (mvdb && mvdb.ok && mvdb.data ? [mvdb.data] : []);
        if (mvdbRows.length) {
            if (mvdbRows.length > 1) {
                lines.push('MVDB has <strong>' + mvdbRows.length +
                    '</strong> documents involving this part.');
            }
            mvdbRows.slice(0, 6).forEach((row) => {
                const d = row.key || row;
                const multi = mvdbRows.length > 1;
                let s = multi ? (statusEscape(d.docId || d.assemblyPn || 'Doc') + ': ') : 'MVDB ';
                if (d.phase) s += (multi ? '' : 'shows this part in ') +
                    '<strong>' + statusEscape(d.phase) + '</strong> phase';
                else s += (multi ? 'record present' : 'has a record for this part');
                if (d.goalRunDate) s += ', goal run date <strong>' + statusEscape(d.goalRunDate) + '</strong>';
                if (d.daysSinceHandoff) s += ', ' + statusEscape(d.daysSinceHandoff) + ' days since handoff';
                if (d.jobQty) s += ', job qty ' + statusEscape(d.jobQty);
                if (d.entryStatus) s += ' (entry status: ' + statusEscape(d.entryStatus) + ')';
                s += '.';
                lines.push(s);
            });
        } else if (mvdb && mvdb.ok && (mvdb.empty || !mvdb.data)) {
            lines.push('MVDB has no record for this part.');
        } else if (mvdb && !mvdb.ok) {
            lines.push(mvdb.error === 'signin'
                ? 'MVDB status could not be read \u2014 sign-in required.'
                : 'MVDB status was unavailable.');
        }

        // Azure sentence.
        if (azure && azure.ok && Array.isArray(azure.items)) {
            const open = azure.items.filter((it) => !it.closed);
            const closed = azure.items.length - open.length;
            const total = azure.items.length;
            if (total === 0) {
                lines.push('No Azure DevOps work items reference this part.');
            } else if (open.length === 0) {
                lines.push('No open work items remain \u2014 all ' + total +
                    ' referencing item' + (total === 1 ? '' : 's') + ' closed.');
            } else {
                lines.push('<strong>' + open.length + ' open work item' +
                    (open.length === 1 ? '' : 's') + '</strong> remaining' +
                    (closed > 0 ? ' (' + closed + ' already closed)' : '') + ':');

                // Describe each open item: what it is and what's going on.
                open.slice(0, 8).forEach((it) => {
                    let line = '<strong>#' + statusEscape(it.id) + '</strong> ' +
                        statusEscape(it.title) +
                        ' \u2014 ' + statusEscape(it.state) + ', ' + statusEscape(it.type) +
                        (it.assignedTo ? ', ' + statusEscape(it.assignedTo) : '') + '.';
                    const detail = it.acceptanceCriteria || it.description || it.reproSteps;
                    if (detail) line += ' ' + statusEscape(clip(detail, 200));
                    const latest = (it.comments || [])[0];
                    if (latest && latest.text) {
                        line += ' <em>Latest:</em> ' + statusEscape(latest.by) + ' \u2014 \u201c' +
                            statusEscape(clip(latest.text, 160)) + '\u201d';
                    }
                    lines.push(line);
                });
            }
        } else if (azure && !azure.ok) {
            lines.push(azure.error === 'signin'
                ? 'Azure DevOps could not be queried \u2014 sign-in required.'
                : 'Azure DevOps was unavailable.');
        }

        // Overall verdict line.
        const openCount = (azure && azure.ok && azure.items)
            ? azure.items.filter((it) => !it.closed).length : 0;
        const anyError = (mvdb && !mvdb.loading && !mvdb.ok) ||
            (azure && !azure.loading && !azure.ok);
        let verdict, cls;
        if (openCount > 0) {
            verdict = 'Bottom line: this part needs attention \u2014 there ' +
                (openCount === 1 ? 'is 1 open item' : 'are ' + openCount + ' open items') +
                ' to resolve.';
            cls = 'is-warn';
        } else if (anyError) {
            verdict = 'Bottom line: partial picture \u2014 some sources could not be read, ' +
                'so this summary may be incomplete.';
            cls = 'is-partial';
        } else {
            verdict = 'Bottom line: nothing outstanding \u2014 no open work items found.';
            cls = 'is-clear';
        }

        const body = lines.length
            ? lines.map((l) => '<p>' + l + '</p>').join('')
            : '<p class="status-muted">No status information could be gathered.</p>';

        summaryEl.innerHTML =
            '<div class="status-summary-head">Summary for ' + statusEscape(partNum) + '</div>' +
            '<div class="status-summary-body ' + cls + '">' + body +
            '<p class="status-summary-verdict">' + verdict + '</p></div>' +
            '<div class="status-muted">Auto-generated digest \u2014 verify against the sources below.</div>';
    }

    function openStatusDashboard(partNum) {
        // Reuse an existing panel if present (e.g. pinned).
        document.querySelectorAll('.preview-panel').forEach((p) => p.remove());
        document.querySelectorAll('.preview-overlay').forEach((o) => o.remove());

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
        title.textContent = 'Current Status: ' + partNum;
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

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'download-btn';
        refreshBtn.textContent = '\u21bb Refresh';
        refreshBtn.title = 'Re-query all sources';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715 Close';

        actions.appendChild(pinBtn);
        actions.appendChild(refreshBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'preview-body';
        const dash = document.createElement('div');
        dash.className = 'status-dash';
        dash.innerHTML =
            '<div class="status-rollup is-partial"><span class="status-dot"></span>' +
            '<span class="status-rollup-text">Gathering status\u2026</span></div>' +
            '<div class="status-summary" data-summary><div class="status-loading">' +
            '<div class="preview-spinner"></div><span>Building summary\u2026</span></div></div>' +
            section('azure', 'Azure DevOps work items');
        body.appendChild(dash);

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        const rollupEl = dash.querySelector('.status-rollup');
        const rollupText = dash.querySelector('.status-rollup-text');
        const summaryEl = dash.querySelector('[data-summary]');
        const azureBody = dash.querySelector('[data-body="azure"]');
        const azureBadge = dash.querySelector('[data-badge="azure"]');

        // Per-source state, used for the rollup and for re-rendering.
        const sources = {
            azure: { loading: true }
        };
        const token = 'st_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        let frames = [];
        let timers = [];

        function rerender() {
            renderAzureBody(azureBody, azureBadge, sources.azure);
            computeRollup(rollupEl, rollupText, null, sources.azure);
            renderSummary(summaryEl, partNum, null, sources.azure);
        }

        function onMessage(e) {
            if (e.origin !== 'https://dev.azure.com') return;
            const d = e.data;
            if (!d || d.__partStatus !== token) return;
            if (d.source === 'azure' && sources.azure.loading) {
                sources.azure = d;
                rerender();
            }
        }

        function spawnFrame(url) {
            const f = document.createElement('iframe');
            f.style.cssText = 'position:absolute;width:0;height:0;border:none;left:-9999px;top:-9999px;';
            f.setAttribute('aria-hidden', 'true');
            f.src = url;
            document.body.appendChild(f);
            frames.push(f);
        }

        function startQueries() {
            sources.azure = { loading: true };
            rerender();

            spawnFrame('https://dev.azure.com/' + 'ni/DevCentral/#__azure_status=' +
                token + '|' + encodeURIComponent(partNum));

            // Timeout so a silent source doesn't spin forever.
            timers.push(setTimeout(() => {
                if (sources.azure.loading) {
                    sources.azure = { ok: false, error: 'timeout', message: 'Azure DevOps did not respond.' };
                    rerender();
                }
            }, 40000));
        }

        function cleanupFrames() {
            frames.forEach((f) => f.remove());
            frames = [];
            timers.forEach((t) => clearTimeout(t));
            timers = [];
        }

        function teardown() {
            cleanupFrames();
            window.removeEventListener('message', onMessage);
            document.removeEventListener('keydown', escHandler);
            isPinned = false;
            clearPageInset();
            overlay.remove();
            panel.remove();
        }

        const escHandler = (e) => { if (e.key === 'Escape') teardown(); };

        refreshBtn.addEventListener('click', () => {
            cleanupFrames();
            startQueries();
        });
        closeBtn.addEventListener('click', teardown);
        document.addEventListener('keydown', escHandler);

        // Sign-in shortcut buttons (delegated).
        dash.addEventListener('click', (e) => {
            const t = e.target.closest('.status-signin-btn');
            if (t && t.dataset.signin) window.open(t.dataset.signin, '_blank', 'noopener');
        });

        window.addEventListener('message', onMessage);
        startQueries();

        function section(key, label) {
            return '<div class="status-section">' +
                '<div class="status-section-head"><span>' + label + '</span>' +
                '<span class="status-badge" data-badge="' + key + '">Loading</span></div>' +
                '<div class="status-section-body" data-body="' + key + '"></div></div>';
        }
    }

    // ===================================================================
    // Compare revisions (Title Block diff)
    // ===================================================================
    // Agile loads each revision's data by mutating MainForm and submitting it
    // through its own AJAX (changeRevs -> displayObject -> displayContent), which
    // also attaches a CSRF token. Rather than reverse-engineer/replay that POST
    // (fragile, and CSRF-dependent), we drive the page's genuine changeRevs() and
    // scrape the rendered title block DOM for each revision, then diff them.
    // A module-level flag pauses our own DOM processors during the capture so
    // their button injections don't interfere with settle detection.
    let revCaptureInProgress = false;

    function getRevSelect() {
        return document.getElementById('revSelectName');
    }

    // Normalize a title-block <dd> value: collapse whitespace, treat the Agile
    // "&nbsp;" placeholder as empty.
    function normalizeFieldValue(dd) {
        if (!dd) return '';
        let text = (dd.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return text;
    }

    // Parse the title block from a container into an ordered field map.
    // Returns { order: [ids], fields: { id: {label, value, section} } }.
    // Fields are keyed by their stable Agile attribute id (the <dd id="col_XXXX">),
    // so the diff matches fields by id rather than by position or label.
    function parseTitleBlock(root) {
        const fields = {};
        const order = [];
        if (!root) return { order, fields };
        let currentSection = 'General';
        const nodes = root.querySelectorAll('h3, dd[id^="col_"]');
        nodes.forEach((node) => {
            if (node.tagName === 'H3') {
                const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
                if (t) currentSection = t;
                return;
            }
            // node is a dd[id^="col_"]
            const id = node.id;
            if (!id || fields[id]) return;
            // The label is the immediately-preceding <dt> sibling.
            let dt = node.previousElementSibling;
            while (dt && dt.tagName !== 'DT') dt = dt.previousElementSibling;
            const label = dt ? (dt.textContent || '').replace(/\s+/g, ' ').replace(/:\s*$/, '').trim() : id;
            fields[id] = { label: label, value: normalizeFieldValue(node), section: currentSection };
            order.push(id);
        });
        return { order, fields };
    }

    // Find the live title-block container on the page.
    function getTitleBlockRoot() {
        const content = document.getElementById('content');
        if (content && content.querySelector('dl.side_by_side_text dd[id^="col_"]')) {
            return content;
        }
        // Fallback: any element holding the side_by_side_text fields.
        const dd = document.querySelector('dl.side_by_side_text dd[id^="col_"]');
        return dd ? (document.getElementById('content') || dd.closest('.ObjectFull') || document.body) : null;
    }

    // Run a snippet of JS in the page's own context (so it can see page globals
    // like changeRevs and inline onclick handlers). Returns nothing.
    // MV3: inline page scripts are CSP-blocked. The only active caller is the
    // Part Tree's navigateMainToObject (displayObject). We best-effort extract a
    // single page function call and invoke it via the MAIN-world bridge; the
    // revision-diff/compare features that injected arbitrary JS are shelved.
    function runInPageContext(jsText) {
        const m = /(displayObject|displayItem|changeRevs|changeSite)\s*\(([^)]*)\)/.exec(String(jsText || ''));
        if (!m) return;
        const args = (m[2].match(/'([^']*)'|"([^"]*)"/g) || []).map((s) => s.slice(1, -1));
        sendPageCmd({ cmd: 'invoke', fn: m[1], args: args });
    }

    // Generic "wait until the #content area settles" helper. Drives an action,
    // then watches document.body for mutations and resolves once `isReady(content)`
    // has held for SETTLE_MS with no further changes. Used both for revision
    // switches and for tab navigation, since both replace/rewrite #content.
    function waitForContentSettle(triggerFn, isReady, opts) {
        opts = opts || {};
        const TRIGGER_TIMEOUT = opts.timeout || 14000;
        const SETTLE_MS = opts.settle || 600;
        const MIN_WAIT = opts.minWait || 350;
        const timeoutMsg = opts.timeoutMsg || 'Timed out loading the page.';

        return new Promise((resolve, reject) => {
            // Mark current content so we can detect a genuine re-render even when
            // Agile reuses the same #content node (innerHTML swap).
            const oldContent = document.getElementById('content');
            const beforeFingerprint = oldContent ? oldContent.innerHTML.length : -1;
            if (oldContent) oldContent.setAttribute('data-revcompare-stale', '1');

            let settleTimer = null;
            let hardTimer = null;
            const startedAt = Date.now();
            let done = false;

            function finish(ok, payload) {
                if (done) return;
                done = true;
                if (settleTimer) clearTimeout(settleTimer);
                if (hardTimer) clearTimeout(hardTimer);
                observer.disconnect();
                if (ok) resolve(payload); else reject(payload);
            }

            function trySettle() {
                const content = document.getElementById('content');
                if (!content) return;
                if (!isReady(content)) return;
                // Require either a fresh node (marker gone) or a changed size.
                const isFresh = !content.hasAttribute('data-revcompare-stale');
                const changed = isFresh || content.innerHTML.length !== beforeFingerprint;
                if (!changed) return;
                if (Date.now() - startedAt < MIN_WAIT) return;
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => {
                    const c = document.getElementById('content');
                    if (!c || !isReady(c)) return;
                    finish(true, c);
                }, SETTLE_MS);
            }

            const observer = new MutationObserver(trySettle);
            observer.observe(document.body, { childList: true, subtree: true });

            hardTimer = setTimeout(() => finish(false, new Error(timeoutMsg)), TRIGGER_TIMEOUT);

            try {
                triggerFn();
            } catch (err) {
                finish(false, err);
                return;
            }

            // In case the swap is instantaneous, attempt a settle check soon.
            setTimeout(trySettle, MIN_WAIT + 50);
        });
    }

    // Drive the page to a given revision id and wait for the title block to
    // re-render. Resolves with the live #content element.
    function switchToRevision(revId) {
        return waitForContentSettle(
            () => runInPageContext(
                '(function(){try{' +
                'var s=document.getElementById("revSelectName");' +
                'if(s){for(var i=0;i<s.options.length;i++){if(String(s.options[i].value)===' +
                JSON.stringify(String(revId)) + '){s.selectedIndex=i;break;}}}' +
                'if(typeof changeRevs==="function"){changeRevs();}' +
                '}catch(e){console.error("[RevCompare] rev trigger error",e);}})();'),
            (content) => !!content.querySelector('dl.side_by_side_text dd[id^="col_"]'),
            {
                timeoutMsg: 'Timed out loading revision ' + revId +
                    ' (the page may have unsaved changes).'
            }
        );
    }

    // Capture just the title block of the currently-loaded revision.
    function captureRevisionSnapshot(revId) {
        return switchToRevision(revId).then((content) => parseTitleBlock(content));
    }

    // The label text Agile uses for the tabs we know how to diff. We match the
    // visible tab caption (case-insensitive) rather than guess an internal id.
    const TAB_MATCHERS = {
        bom: /^(bom|bill of materials?|items?)$/i,
        attachments: /^(attachments?|files?)$/i
    };

    // Click a tab by its visible caption, in page context (so Agile's own inline
    // handler runs), then wait for a data grid to appear in #content.
    function navigateToTab(aspect) {
        const re = TAB_MATCHERS[aspect];
        if (!re) return Promise.reject(new Error('Unknown tab: ' + aspect));
        const reSource = re.source.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const reFlags = re.flags;
        return waitForContentSettle(
            () => runInPageContext(
                '(function(){try{' +
                'var re=new RegExp(\'' + reSource + '\',\'' + reFlags + '\');' +
                'var links=document.querySelectorAll(".tabConButton, .tabname, .tabnames a, .tabConButtonSel, td a, li a, a");' +
                'var hit=null;' +
                'for(var i=0;i<links.length;i++){' +
                'var t=(links[i].textContent||"").replace(/\\s+/g," ").trim();' +
                'if(t&&re.test(t)){hit=links[i];break;}}' +
                'if(hit){hit.click();}else{console.warn("[RevCompare] tab not found:"+re);}' +
                '}catch(e){console.error("[RevCompare] tab trigger error",e);}})();'),
            (content) => isGridReady(content),
            {
                timeoutMsg: 'Timed out loading the ' + aspect + ' tab (it may not exist for this object).'
            }
        );
    }

    // Heuristic: a data grid is present once #content holds a table with at least
    // one body row of multiple cells. Title-block-only content has no such table.
    function isGridReady(content) {
        const tables = content.querySelectorAll('table');
        for (const t of tables) {
            const rows = t.querySelectorAll('tr');
            for (const r of rows) {
                if (r.querySelectorAll('td').length >= 2) return true;
            }
        }
        // An explicitly empty grid (e.g. "No items") also counts as "loaded".
        if (/no\s+(items|attachments|files|rows)/i.test(content.textContent || '')) return true;
        return false;
    }

    // Read the rev dropdown options into [{id, label}].
    function getRevisionOptions() {
        const sel = getRevSelect();
        if (!sel) return [];
        return Array.from(sel.options).map((o) => ({
            id: String(o.value),
            label: (o.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || o.value
        }));
    }

    function buildRevDiff(snapA, snapB) {
        const ids = [];
        const seen = {};
        snapA.order.concat(snapB.order).forEach((id) => {
            if (!seen[id]) { seen[id] = true; ids.push(id); }
        });
        const rows = [];
        ids.forEach((id) => {
            const a = snapA.fields[id];
            const b = snapB.fields[id];
            const label = (b && b.label) || (a && a.label) || id;
            const section = (b && b.section) || (a && a.section) || 'General';
            let status;
            if (a && b) status = (a.value === b.value) ? 'same' : 'changed';
            else if (a && !b) status = 'removed';
            else status = 'added';
            rows.push({
                id, label, section, status,
                valueA: a ? a.value : '', valueB: b ? b.value : ''
            });
        });
        return rows;
    }

    function renderRevDiff(container, rows, labelA, labelB) {
        const diffsOnly = container.__diffsOnly !== false; // default true
        const visible = rows.filter((r) => diffsOnly ? r.status !== 'same' : true);

        let html = '<div class="revdiff-toolbar">' +
            '<label><input type="checkbox" class="revdiff-onlydiff"' +
            (diffsOnly ? ' checked' : '') + '> Show differences only</label>' +
            '<span class="revdiff-legend">' +
            '<span><span class="revdiff-chip changed"></span>Changed</span>' +
            '<span><span class="revdiff-chip added"></span>Added in B</span>' +
            '<span><span class="revdiff-chip removed"></span>Removed in B</span>' +
            '</span></div>';

        const changedCount = rows.filter((r) => r.status !== 'same').length;
        if (changedCount === 0) {
            html += '<div class="revdiff-status">No differences in the title block between these revisions.</div>';
            container.innerHTML = html;
            wireToolbar(container, rows, labelA, labelB);
            return;
        }

        html += '<table><thead><tr>' +
            '<th>Field</th><th>' + escapeHtml(labelA) + '</th><th>' + escapeHtml(labelB) + '</th>' +
            '</tr></thead><tbody>';

        let lastSection = null;
        visible.forEach((r) => {
            if (r.section !== lastSection) {
                lastSection = r.section;
                html += '<tr class="revdiff-section-row"><td colspan="3">' + escapeHtml(r.section) + '</td></tr>';
            }
            const cls = r.status === 'same' ? '' : r.status;
            const va = r.valueA ? escapeHtml(r.valueA) : '<span class="revdiff-empty">(empty)</span>';
            const vb = r.valueB ? escapeHtml(r.valueB) : '<span class="revdiff-empty">(empty)</span>';
            html += '<tr class="' + cls + '">' +
                '<td class="revdiff-field">' + escapeHtml(r.label) + '</td>' +
                '<td class="revdiff-a">' + va + '</td>' +
                '<td class="revdiff-b">' + vb + '</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        wireToolbar(container, rows, labelA, labelB);
    }

    function wireToolbar(container, rows, labelA, labelB) {
        const cb = container.querySelector('.revdiff-onlydiff');
        if (cb) {
            cb.addEventListener('change', () => {
                container.__diffsOnly = cb.checked;
                renderRevDiff(container, rows, labelA, labelB);
            });
        }
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---- Grid (BOM / Attachments) capture + diff ----------------------

    // Parse the main data grid inside #content into rows keyed by a stable value.
    // Generic on purpose: we find the largest table, read its header labels, then
    // each body row's cells. `keyFromRow(cellsByCol, rowEl)` derives the match key
    // (e.g. BOM item number, attachment file name). Returns:
    //   { columns: [labels], order: [keys], rows: { key: { cells: {label:value} } } }
    function parseGrid(content, keyFromRow) {
        const result = { columns: [], order: [], rows: {} };
        if (!content) return result;

        // Choose the table with the most data rows (the real grid, not layout tables).
        let grid = null;
        let bestRows = 0;
        content.querySelectorAll('table').forEach((t) => {
            const dataRows = t.querySelectorAll('tr');
            let count = 0;
            dataRows.forEach((r) => { if (r.querySelectorAll('td').length >= 2) count++; });
            if (count > bestRows) { bestRows = count; grid = t; }
        });
        if (!grid) return result;

        // Header labels: prefer <th>, else the first row's cells.
        let headerCells = grid.querySelectorAll('thead th, tr th');
        if (!headerCells.length) {
            const firstRow = grid.querySelector('tr');
            headerCells = firstRow ? firstRow.querySelectorAll('td') : [];
        }
        const columns = Array.from(headerCells).map((c) =>
            (c.textContent || '').replace(/\s+/g, ' ').trim());
        result.columns = columns;

        // Body rows: every row whose cells are data (>=2 td), skipping the header row.
        const seenKey = {};
        let autoIndex = 0;
        grid.querySelectorAll('tr').forEach((tr) => {
            const tds = tr.querySelectorAll('td');
            if (tds.length < 2) return; // header / spacer
            const cells = {};
            Array.from(tds).forEach((td, i) => {
                const label = columns[i] || ('Col ' + (i + 1));
                cells[label] = (td.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            });
            let key = keyFromRow ? keyFromRow(cells, tr, columns) : '';
            if (!key) { autoIndex++; key = '__row_' + autoIndex; }
            // De-duplicate keys (e.g. repeated component) by suffixing.
            let uniq = key, n = 2;
            while (seenKey[uniq]) { uniq = key + ' #' + n; n++; }
            seenKey[uniq] = true;
            result.order.push(uniq);
            result.rows[uniq] = { cells, label: key };
        });
        return result;
    }

    // Pick the value of the first column whose header matches any of `res`.
    function pickColumn(cells, columns, res) {
        for (const re of res) {
            for (const col of columns) {
                if (re.test(col)) {
                    const v = cells[col];
                    if (v) return v;
                }
            }
        }
        return '';
    }

    // BOM rows are matched by the component item number.
    function bomKey(cells, tr, columns) {
        return pickColumn(cells, columns, [/item\s*number|^number$|part\s*number|^item$/i]) || '';
    }
    // Attachments are matched by file name.
    function attachmentKey(cells, tr, columns) {
        return pickColumn(cells, columns, [/file\s*name|^name$|^file$|attachment/i]) || '';
    }

    // Capture a grid aspect for one revision: switch rev, open the tab, parse.
    function captureRevisionGrid(revId, aspect) {
        const keyFn = aspect === 'bom' ? bomKey : attachmentKey;
        return switchToRevision(revId)
            .then(() => navigateToTab(aspect))
            .then((content) => parseGrid(content, keyFn));
    }

    // Diff two grids. Rows keyed by `order` union; a row is added/removed/changed/same.
    // For changed rows we also record which columns differ.
    function buildGridDiff(snapA, snapB) {
        const cols = [];
        const seenCol = {};
        snapA.columns.concat(snapB.columns).forEach((c) => {
            if (c && !seenCol[c]) { seenCol[c] = true; cols.push(c); }
        });
        const keys = [];
        const seen = {};
        snapA.order.concat(snapB.order).forEach((k) => {
            if (!seen[k]) { seen[k] = true; keys.push(k); }
        });
        const rows = [];
        keys.forEach((key) => {
            const a = snapA.rows[key];
            const b = snapB.rows[key];
            let status, changedCols = [];
            if (a && b) {
                cols.forEach((c) => {
                    if ((a.cells[c] || '') !== (b.cells[c] || '')) changedCols.push(c);
                });
                status = changedCols.length ? 'changed' : 'same';
            } else if (a && !b) {
                status = 'removed';
            } else {
                status = 'added';
            }
            rows.push({
                key, label: (b && b.label) || (a && a.label) || key,
                status, changedCols,
                cellsA: a ? a.cells : {}, cellsB: b ? b.cells : {}
            });
        });
        return { columns: cols, rows };
    }

    function renderGridDiff(container, diff, labelA, labelB) {
        const diffsOnly = container.__diffsOnly !== false;
        const cols = diff.columns;
        const visible = diff.rows.filter((r) => diffsOnly ? r.status !== 'same' : true);

        let html = '<div class="revdiff-toolbar">' +
            '<label><input type="checkbox" class="revdiff-onlydiff"' +
            (diffsOnly ? ' checked' : '') + '> Show differences only</label>' +
            '<span class="revdiff-legend">' +
            '<span><span class="revdiff-chip changed"></span>Changed</span>' +
            '<span><span class="revdiff-chip added"></span>Added in B</span>' +
            '<span><span class="revdiff-chip removed"></span>Removed in B</span>' +
            '</span></div>';

        if (!cols.length) {
            html += '<div class="revdiff-status">Could not read a data grid for this tab. ' +
                'If this looks wrong, open the tab manually and share the table HTML so I can refine the parser.</div>';
            container.innerHTML = html;
            wireToolbar2(container, diff, labelA, labelB);
            return;
        }

        const changedCount = diff.rows.filter((r) => r.status !== 'same').length;
        if (changedCount === 0) {
            html += '<div class="revdiff-status">No differences between these revisions.</div>';
            container.innerHTML = html;
            wireToolbar2(container, diff, labelA, labelB);
            return;
        }

        html += '<table><thead><tr><th>Change</th>';
        cols.forEach((c) => { html += '<th>' + escapeHtml(c) + '</th>'; });
        html += '</tr></thead><tbody>';

        visible.forEach((r) => {
            const cls = r.status === 'same' ? '' : r.status;
            const tag = r.status === 'added' ? '+ added' :
                r.status === 'removed' ? '\u2212 removed' :
                r.status === 'changed' ? '~ changed' : '';
            html += '<tr class="' + cls + '"><td class="revdiff-field">' + escapeHtml(tag) + '</td>';
            cols.forEach((c) => {
                const va = r.cellsA[c] || '';
                const vb = r.cellsB[c] || '';
                if (r.status === 'changed' && r.changedCols.indexOf(c) !== -1) {
                    html += '<td class="changed-cell">' +
                        '<span class="revdiff-old">' + (va ? escapeHtml(va) : '<span class="revdiff-empty">(empty)</span>') + '</span>' +
                        '<span class="revdiff-new">' + (vb ? escapeHtml(vb) : '<span class="revdiff-empty">(empty)</span>') + '</span></td>';
                } else if (r.status === 'removed') {
                    html += '<td>' + (va ? escapeHtml(va) : '') + '</td>';
                } else if (r.status === 'added') {
                    html += '<td>' + (vb ? escapeHtml(vb) : '') + '</td>';
                } else {
                    html += '<td>' + escapeHtml(vb || va) + '</td>';
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        wireToolbar2(container, diff, labelA, labelB);
    }

    function wireToolbar2(container, diff, labelA, labelB) {
        const cb = container.querySelector('.revdiff-onlydiff');
        if (cb) {
            cb.addEventListener('change', () => {
                container.__diffsOnly = cb.checked;
                renderGridDiff(container, diff, labelA, labelB);
            });
        }
    }

    function openRevCompare() {
        const options = getRevisionOptions();
        const realRevs = options.filter((o) => o.id && o.id !== '0');
        if (realRevs.length < 2) {
            alert('Need at least two revisions to compare.');
            return;
        }

        const sel = getRevSelect();
        const originalRevId = sel ? String(sel.value) : (realRevs[0] && realRevs[0].id);

        document.querySelectorAll('.preview-panel').forEach((p) => p.remove());
        document.querySelectorAll('.preview-overlay').forEach((o) => o.remove());

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
        title.textContent = 'Compare revisions \u2014 Title Block';
        const actions = document.createElement('div');
        actions.className = 'preview-header-actions';

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pin-btn';
        pinBtn.textContent = '\uD83D\uDCCC Pin';
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

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715 Close';

        actions.appendChild(pinBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'preview-body';
        const diff = document.createElement('div');
        diff.className = 'revdiff';

        // Picker UI.
        function optionList(selectedId) {
            return realRevs.map((o) =>
                '<option value="' + escapeHtml(o.id) + '"' +
                (o.id === selectedId ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>'
            ).join('');
        }
        const defaultA = realRevs[1] ? realRevs[1].id : realRevs[0].id; // older
        const defaultB = realRevs[0].id; // newest (top of list)
        diff.innerHTML =
            '<div class="revdiff-aspects">' +
            '<button type="button" class="revdiff-aspect is-active" data-aspect="title">Title Block</button>' +
            '<button type="button" class="revdiff-aspect" data-aspect="bom">BOM</button>' +
            '<button type="button" class="revdiff-aspect" data-aspect="attachments">Attachments</button>' +
            '</div>' +
            '<div class="revdiff-pickers">' +
            '<label>Revision A (base)<select class="revdiff-a-sel">' + optionList(defaultA) + '</select></label>' +
            '<label>Revision B (compare)<select class="revdiff-b-sel">' + optionList(defaultB) + '</select></label>' +
            '<button class="revdiff-go" type="button">Compare</button>' +
            '</div>' +
            '<div class="revdiff-result"></div>';

        body.appendChild(diff);
        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        const selA = diff.querySelector('.revdiff-a-sel');
        const selB = diff.querySelector('.revdiff-b-sel');
        const goBtn = diff.querySelector('.revdiff-go');
        const result = diff.querySelector('.revdiff-result');
        const aspectBtns = Array.from(diff.querySelectorAll('.revdiff-aspect'));
        let aspect = 'title';
        const aspectLabels = { title: 'Title Block', bom: 'BOM', attachments: 'Attachments' };
        aspectBtns.forEach((b) => b.addEventListener('click', () => {
            if (busy) return;
            aspect = b.dataset.aspect;
            aspectBtns.forEach((x) => x.classList.toggle('is-active', x === b));
            title.textContent = 'Compare revisions \u2014 ' + aspectLabels[aspect];
            runCompare();
        }));

        let busy = false;
        async function runCompare() {
            if (busy) return;
            const idA = String(selA.value);
            const idB = String(selB.value);
            const labelA = realRevs.find((o) => o.id === idA);
            const labelB = realRevs.find((o) => o.id === idB);
            const nameA = labelA ? labelA.label : idA;
            const nameB = labelB ? labelB.label : idB;

            if (idA === idB) {
                result.innerHTML = '<div class="revdiff-status">Pick two different revisions.</div>';
                return;
            }

            busy = true;
            goBtn.disabled = true;
            aspectBtns.forEach((b) => b.disabled = true);
            result.innerHTML = '<div class="revdiff-status"><div class="preview-spinner"></div>' +
                'Loading revisions\u2026 the page will briefly switch revisions and restore.</div>';

            revCaptureInProgress = true;
            try {
                if (aspect === 'title') {
                    const snapA = await captureRevisionSnapshot(idA);
                    const snapB = await captureRevisionSnapshot(idB);
                    const rows = buildRevDiff(snapA, snapB);
                    renderRevDiff(result, rows, nameA, nameB);
                } else {
                    const snapA = await captureRevisionGrid(idA, aspect);
                    const snapB = await captureRevisionGrid(idB, aspect);
                    const gd = buildGridDiff(snapA, snapB);
                    renderGridDiff(result, gd, nameA, nameB);
                }
            } catch (err) {
                result.innerHTML = '<div class="revdiff-status">Could not load revisions: ' +
                    escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
            } finally {
                // Restore the user's original revision view.
                try { await captureRevisionSnapshot(originalRevId); } catch (e) { /* best effort */ }
                revCaptureInProgress = false;
                busy = false;
                goBtn.disabled = false;
                aspectBtns.forEach((b) => b.disabled = false);
            }
        }

        goBtn.addEventListener('click', runCompare);

        function teardown() {
            window.removeEventListener('resize', onResize);
            document.removeEventListener('keydown', escHandler);
            isPinned = false;
            clearPageInset();
            overlay.remove();
            panel.remove();
        }
        const onResize = () => {
            if (!document.body.contains(panel)) { window.removeEventListener('resize', onResize); return; }
            const clamped = applyPanelWidth(panel, panel.getBoundingClientRect().width);
            if (isPinned) applyPageInset(clamped);
        };
        const escHandler = (e) => { if (e.key === 'Escape') teardown(); };
        closeBtn.addEventListener('click', teardown);
        document.addEventListener('keydown', escHandler);
        window.addEventListener('resize', onResize);

        // Auto-run the default comparison.
        runCompare();
    }

    function injectCompareRevsButton() {
        const sel = getRevSelect();
        if (!sel || isAuthGatewayPage()) return;
        if (sel.options.length < 2) return;
        // Avoid duplicates; anchor the button right after the dropdown.
        if (sel.parentNode && sel.parentNode.querySelector('.revcompare-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'revcompare-btn';
        btn.type = 'button';
        btn.title = 'Compare the Title Block between two revisions';
        btn.textContent = '\u21C4 Compare revs';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openRevCompare();
        });
        sel.parentNode.insertBefore(btn, sel.nextSibling);
    }

    function injectStatusButton() {
        const existing = document.querySelector('.partstatus-btn');
        if (isAuthGatewayPage() || !document.body) {
            if (existing) existing.remove();
            return;
        }

        // Only show on actual part pages, and only for part numbers that start
        // with "1". Anything else (no part, or a non-1 part) gets no button so
        // it isn't a static fixture on every page.
        const part = getCurrentPartNumber();
        const eligible = !!part && /^1/.test(part);
        if (!eligible) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const btn = document.createElement('button');
        btn.className = 'partstatus-btn';
        btn.type = 'button';
        btn.title = 'Aggregate this part\u2019s status from MVDB and Azure DevOps';
        btn.innerHTML = STATUS_ICON_SVG + '<span>Current Status</span>';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const part = getCurrentPartNumber();
            if (!part) {
                alert('Open a part page first \u2014 no part number detected on this page.');
                return;
            }
            openStatusDashboard(part);
        });

        document.body.appendChild(btn);

        // Position within the collapsing top-right fixed stack.
        scheduleRightStackLayout();

        log('Current Status button injected');
    }

    // Build an iframe wrapped with a spinner overlay that hides once the frame
    // finishes loading. Pass a falsy url to show only the spinner (e.g. while a
    // background lookup is still resolving the real URL).
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

        // A minimum visible time keeps the spinner from flashing away when a
        // page (e.g. the Oracle APEX/MVDB shell) fires `load` almost immediately
        // while its real content is still loading.
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

        // Live apps (ECHO, MVDB, P4) may redirect to an SSO login (e.g.
        // emerson.okta.com) that refuses to be embedded, producing Firefox's
        // "Firefox Can't Open This Page" framing error. We can't read that
        // cross-origin error from JS, so the background script detects the
        // framing block (via response headers) and messages us to reveal this
        // footer. It stays hidden otherwise.
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
            // Unpinned: darkened modal, page NOT reflowed.
            // Pinned: remove the dim overlay and reflow the page so it stays
            // interactive beside the panel.
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

            // Remember the page's primary part number for the status dashboard.
            // Always track the latest so navigating to another part updates it.
            detectedPartNumber = partNum;

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

            // HWT Config Creator: opens this part in the Streamlit test-data
            // viewer (hwt-config-creator). Clicking HWT opens a small menu to
            // pick which endpoint to use. "Local URL" auto-starts the server
            // (via the hwt:// protocol) so you don't have to run the terminal
            // command yourself, and works on any machine because localhost is
            // universal. Network / External are machine-specific and only shown
            // once configured in the popup. The menu is appended to <body> so
            // the Agile header's overflow can't clip it.
            // Only available for part numbers that start with "1".
            if (/^1/.test(partNum)) {
                const wrap = document.createElement('span');
                wrap.className = 'partnum-hwt-wrap';

                const hwtBtn = document.createElement('button');
                hwtBtn.className = 'partnum-hwt-btn';
                hwtBtn.type = 'button';
                hwtBtn.textContent = 'HWT \u25BE';
                hwtBtn.title = 'Open this part in the HWT Config Creator (Local auto-starts the server)';

                const menu = document.createElement('div');
                menu.className = 'partnum-hwt-menu';
                const HWT_OPTIONS = [
                    { key: 'local',    label: 'Local URL',    desc: 'localhost \u2014 auto-starts server' },
                    { key: 'network',  label: 'Network URL',  desc: 'this LAN \u2014 opens in new tab' },
                    { key: 'external', label: 'External URL', desc: 'off-network \u2014 opens in new tab' }
                ];

                function buildMenu() {
                    menu.innerHTML = '';
                    let shown = 0;
                    HWT_OPTIONS.forEach((opt) => {
                        const target = hwtUrls[opt.key];
                        if (!target) return; // hide unconfigured Network/External
                        shown++;
                        const item = document.createElement('button');
                        item.className = 'partnum-hwt-menu-item';
                        item.type = 'button';
                        const lab = document.createElement('span');
                        lab.className = 'hwt-mi-label';
                        lab.textContent = opt.label;
                        const dsc = document.createElement('span');
                        dsc.className = 'hwt-mi-desc';
                        dsc.textContent = opt.desc;
                        item.appendChild(lab);
                        item.appendChild(dsc);
                        item.title = target;
                        item.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            closeHwtMenu();
                            openInHWT(partNum, target, opt.key === 'local');
                        });
                        menu.appendChild(item);
                    });
                    return shown;
                }

                function positionMenu() {
                    const r = hwtBtn.getBoundingClientRect();
                    menu.style.top = (r.bottom + 4) + 'px';
                    menu.style.left = r.left + 'px';
                }

                function onDocClick(e) {
                    if (e.target !== hwtBtn && !menu.contains(e.target)) closeHwtMenu();
                }

                function closeHwtMenu() {
                    menu.classList.remove('open');
                    if (menu.parentNode) menu.parentNode.removeChild(menu);
                    document.removeEventListener('click', onDocClick, true);
                    window.removeEventListener('scroll', positionMenu, true);
                    window.removeEventListener('resize', positionMenu, true);
                }

                hwtBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (menu.classList.contains('open')) { closeHwtMenu(); return; }
                    // Kick off the local hwt-config-creator server in the
                    // background the moment the HWT button is pressed so it's
                    // already warming up by the time a menu option is chosen.
                    launchHWTServer();
                    buildMenu();
                    document.body.appendChild(menu);
                    positionMenu();
                    menu.classList.add('open');
                    setTimeout(() => {
                        document.addEventListener('click', onDocClick, true);
                        window.addEventListener('scroll', positionMenu, true);
                        window.addEventListener('resize', positionMenu, true);
                    }, 0);
                });

                wrap.appendChild(hwtBtn);
                h2.appendChild(wrap);
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

    // Open the part in the HWT Config Creator (Streamlit data viewer) in the
    // preview sidebar. The app reads ?pn=<part> from the URL to pre-fill the
    // Part Number field (see app.py query_params handling).
    //
    // When `isLocal` is true we ask the background script to start the local
    // `hwt-config-creator` server through the native messaging host (which is a
    // no-op when the port is already listening). Native messaging shows NO
    // browser prompt, unlike the old hwt:// protocol. A fresh server takes a few
    // seconds to boot, so we retry the iframe once after a short delay and only
    // fall back to a new tab if it still hasn't loaded.
    function launchHWTServer() {
        // Ask the background script to start the server via the native host.
        // This replaces the hwt:// protocol so there's no "open external link"
        // popup. When it resolves, the captured Network/External URLs have been
        // saved to storage and the menu picks them up via storage.onChanged.
        try {
            if (storageApi && storageApi.runtime && storageApi.runtime.sendMessage) {
                storageApi.runtime.sendMessage({ type: 'start_hwt_server' });
            }
        } catch (e) { /* background unavailable; localhost may still be up */ }
    }

    function openInHWT(partNum, baseUrl, isLocal) {
        const base = baseUrl || HWT_LOCAL_URL;
        const url = base + '?pn=' + encodeURIComponent(partNum);

        // Mixed-content guard: the Agile page is HTTPS. An http:// URL to a
        // non-localhost host (the Network / External IPs) is blocked by the
        // browser inside the preview iframe, so it would silently fail there.
        // localhost/127.0.0.1 over http IS allowed (treated as a secure
        // context). For anything that can't embed, open a new tab directly —
        // that has no mixed-content restriction and is what works.
        let isLoopback = false;
        try {
            const host = new URL(url).hostname;
            isLoopback = (host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
        } catch (e) { /* malformed URL; treat as non-loopback */ }
        const pageHttps = location.protocol === 'https:';
        const urlHttp = /^http:\/\//i.test(url);
        if (pageHttps && urlHttp && !isLoopback) {
            window.open(url, '_blank', 'noopener');
            return;
        }

        if (isLocal) launchHWTServer();
        openUrlInSidebar(url, 'HWT: ' + partNum);

        const panel = document.querySelector('.preview-panel');
        const iframe = panel && panel.querySelector('.preview-body iframe.preview-iframe');
        if (!iframe) {
            window.open(url, '_blank', 'noopener');
            return;
        }
        let loaded = false;
        iframe.addEventListener('load', () => {
            if (iframe.src && iframe.src !== 'about:blank') loaded = true;
        });
        // Cold-start retry: if a freshly launched local server wasn't ready on
        // the first attempt, reload the iframe once it has had time to boot.
        if (isLocal) {
            setTimeout(() => {
                if (!loaded && iframe.isConnected) {
                    iframe.src = url + '&_r=' + Date.now();
                }
            }, 4500);
        }
        // If nothing has loaded after the grace period, the app likely isn't
        // reachable/embeddable — open it in a new browser tab instead.
        setTimeout(() => {
            if (!loaded) window.open(url, '_blank', 'noopener');
        }, isLocal ? 12000 : 5000);
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

    // Diff two Perforce depot folder paths in P4V / P4Merge via the "p4v://"
    // protocol. The handler (p4v-go.ps1) maps both depot paths to the workspace,
    // syncs them, and launches P4Merge's folder comparison (left vs right).
    //   left  = the OLDER revision (1st path in P4V's Diff dialog)
    //   right = the NEWER revision (2nd path)
    function openP4VDiff(leftPath, rightPath) {
        const url = 'p4v://diff?l=' + encodeURIComponent(leftPath) +
            '&r=' + encodeURIComponent(rightPath);
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
            'a[onclick*="openFile"]',
            'a[onclick*="viewFile"]'
        ];

        let count = 0;
        selectors.forEach(selector => {
            const links = document.querySelectorAll(selector);
            links.forEach((link) => {
                if (link.dataset.previewProcessed) return;

                const onclickStr = link.getAttribute('onclick') || '';

                // openFile(...) returns raw file bytes directly. viewFile(...)
                // normally launches Oracle AutoVue for CAD attachments, but its
                // IDs map onto the same download mechanism, so we synthesize an
                // equivalent openFile(...) call and route it through the same
                // pipeline. Anything else (displayObject, etc.) is ignored.
                let parsed = null;
                let synthOnclick = null;

                if (onclickStr.includes('openFile')) {
                    parsed = parseOpenFileParams(onclickStr);
                    if (!parsed || !parsed.fileName) return;
                } else if (onclickStr.includes('viewFile')) {
                    const vf = parseViewFileParams(onclickStr);
                    if (!vf || !vf.fileId) return;
                    const fileName = (link.textContent || '').trim();
                    if (!fileName) return;
                    const size = getAttachmentSizeFromRow(link);
                    synthOnclick = buildOpenFileCallFromViewFile(vf, fileName, size);
                    parsed = { fileName: fileName };
                } else {
                    return;
                }

                const ext = getFileExtFromName(parsed.fileName);
                if (!ext) return;

                link.dataset.previewProcessed = 'true';
                if (synthOnclick) link.__previewOnclick = synthOnclick;
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

            // When the value changed, Agile shows the previous path in a
            // "redlined" span. If present (and different) we can offer a folder
            // diff between the old and new revisions.
            const oldSpan = cell.querySelector('span.redlined');
            const oldPath = oldSpan ? (oldSpan.textContent || '').trim() : '';
            const canDiff = !!oldPath && oldPath !== depotPath && /^\/\//.test(oldPath);

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

            // Third button (only when the path changed): diff the previous and
            // current folder revisions in P4V / P4Merge. Older on the left, newer
            // on the right — matching P4V's "Diff Files" 1st/2nd path order.
            if (canDiff) {
                const diffBtn = document.createElement('button');
                diffBtn.className = 'partnum-echo-btn p4v-diff-btn';
                diffBtn.type = 'button';
                diffBtn.textContent = 'Diff in P4V';
                diffBtn.title = 'Folder-diff the previous revision (' + oldPath +
                    ') against the current revision (' + depotPath + ') in P4V';
                diffBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openP4VDiff(oldPath, depotPath);
                });
                btnWrap.appendChild(diffBtn);
            }

            cell.appendChild(btnWrap);
        });
    }

    // ===================================================================
    // Part Relationship Tree (BOM children + Where-Used parents)
    // -------------------------------------------------------------------
    // Builds an exploded tree for the current part: its Where-Used assemblies
    // (parents, going UP) and its BOM components (children, going DOWN). On open
    // one level is loaded each way; the + handles load further levels on demand
    // (one level per click). Each node shows the part number plus its
    // description; clicking a node navigates the main Agile view to that part.
    //
    // Data is gathered non-destructively in a single hidden, same-origin Agile
    // iframe: we drive Agile's own displayObject('ItemHandler', class, obj, tab)
    // navigation inside the frame to each part's BOM / Where-Used tab, then scrape
    // the GridManager grid. The current page's tab strip tells us the tab ids
    // (they are class-level, identical for every Item). Results are cached per
    // object id and levels are loaded lazily on expand.
    // ===================================================================
    const TREE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect x="9" y="2.5" width="6" height="5" rx="1" stroke="currentColor" stroke-width="2"/>' +
        '<rect x="3" y="16.5" width="6" height="5" rx="1" stroke="currentColor" stroke-width="2"/>' +
        '<rect x="15" y="16.5" width="6" height="5" rx="1" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M12 7.5V12M12 12H6v4.5M12 12h6v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '</svg>';

    // Captured from the current page's tab strip: the open object's identity and
    // the tab ids for its BOM / Where Used / cover tabs. Refreshed on each open.
    let partContext = null;

    // objId -> { children: [rel]|undefined, parents: [rel]|undefined }
    const relationCache = Object.create(null);
    // key ("bom:objId" / "parents:objId") -> { promise, job } for requests that
    // are currently queued/running, so concurrent callers (a background probe
    // and a user click) share ONE iframe navigation instead of queueing two.
    const inflightFetch = Object.create(null);

    // The single reusable background frame, and a PRIORITY work queue so only
    // one displayObject navigation runs in it at a time. User-initiated expands
    // jump ahead of low-priority background probes.
    let treeFrame = null;
    let treeFrameReady = null;
    const fetchQueue = [];      // [{ fn, job:{priority}, resolve, reject }]
    let fetchBusy = false;

    const partTreeStyle = document.createElement('style');
    partTreeStyle.textContent = `
        .parttree-btn {
            position: fixed; right: 18px; top: 50px; z-index: 1000001;
            display: inline-flex; align-items: center; gap: 5px;
            padding: 4px 9px; font-size: 11px; font-weight: 600;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: #fff; background: #5b3aa6; border: none; border-radius: 5px;
            cursor: pointer; box-shadow: 0 1px 5px rgba(0,0,0,0.22);
            transition: background 0.15s ease, transform 0.1s ease; white-space: nowrap;
        }
        .parttree-btn:hover { background: #4a2f8a; }
        .parttree-btn:active { transform: translateY(1px); }
        .parttree-btn svg { width: 13px; height: 13px; display: block; }
        body:has(.preview-panel) .parttree-btn { display: none !important; }

        .parttree-wrap { display: flex; flex-direction: column; height: 100%; background: #faf9fe; }
        .parttree-toolbar {
            display: flex; align-items: center; gap: 8px; padding: 6px 10px;
            border-bottom: 1px solid #e6e1f3; background: #fff; flex: 0 0 auto;
        }
        .parttree-zoombtn, .parttree-fitbtn {
            font: 600 12px "Segoe UI", sans-serif; border: 1px solid #d6c9f5; background: #fff;
            color: #4a2f8a; border-radius: 4px; cursor: pointer; padding: 2px 9px; line-height: 1.4;
        }
        .parttree-fitbtn { display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; }
        .parttree-fitbtn svg { display: block; }
        .parttree-zoombtn:hover, .parttree-fitbtn:hover { background: #efeafc; }
        .parttree-zoomlabel { font: 600 11px "Segoe UI", sans-serif; color: #4a2f8a; min-width: 40px; text-align: center; }
        .parttree-toolbar-hint { font: 11px "Segoe UI", sans-serif; color: #6b7280; margin-left: 6px; }
        .parttree-legend {
            display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px;
            padding: 6px 10px; border-bottom: 1px solid #e6e1f3; background: #fff; flex: 0 0 auto;
            font: 11px "Segoe UI", sans-serif; color: #4b5563;
        }
        .parttree-legend-title { font-weight: 700; color: #4a2f8a; margin-right: 2px; }
        .parttree-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .parttree-dot {
            display: inline-block; width: 9px; height: 9px; border-radius: 50%;
            border: 1px solid rgba(0,0,0,.15); flex: 0 0 auto; vertical-align: middle;
        }
        .parttree-pn .parttree-dot { margin-right: 6px; }
        .parttree-scroll { position: relative; flex: 1 1 auto; overflow: auto; cursor: grab; }
        .parttree-scroll.is-panning { cursor: grabbing; }
        .parttree-scroll.is-panning .parttree-box { cursor: grabbing; }
        .parttree-sizer { position: relative; }
        .parttree-canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
        .parttree-edges { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
        .parttree-edge { fill: none; stroke: #c3b2ea; stroke-width: 1.6; }
        .parttree-box {
            position: absolute; width: 210px; height: 68px; box-sizing: border-box;
            padding: 7px 9px; background: #fff; border: 1.5px solid #d6c9f5; border-radius: 8px;
            box-shadow: 0 1px 4px rgba(60,40,120,.12); cursor: grab; overflow: visible;
            font-family: "Segoe UI", Tahoma, sans-serif; transition: box-shadow .12s, border-color .12s;
        }
        .parttree-box:hover { border-color: #8a6fd0; box-shadow: 0 3px 10px rgba(60,40,120,.22); z-index: 5; }
        .parttree-scroll.is-dragging-node, .parttree-scroll.is-dragging-node .parttree-box { cursor: grabbing; }
        .parttree-box.is-root { border-color: #5b3aa6; background: #efeafc; box-shadow: 0 2px 10px rgba(60,40,120,.28); }
        .parttree-box.is-up { border-color: #c9b6e8; }
        .parttree-box-inner { height: 100%; overflow: hidden; }
        .parttree-pn {
            font-weight: 700; font-size: 13px; color: #4a2f8a; line-height: 1.25; word-break: break-word;
            display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden;
        }
        .parttree-box.is-root .parttree-pn { color: #3a2480; }
        .parttree-desc {
            font-size: 11px; color: #5b6573; line-height: 1.3; margin-top: 2px;
            display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
        }
        .parttree-tog {
            position: absolute; top: 50%; transform: translateY(-50%);
            width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #8a6fd0;
            background: #fff; color: #5b3aa6; font: 700 13px/16px "Segoe UI", sans-serif;
            cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; z-index: 8;
        }
        .parttree-tog:hover { background: #5b3aa6; color: #fff; }
        .parttree-tog.on-right { right: -11px; }
        .parttree-tog.on-left { left: -11px; }
        .parttree-tog.tog-parents { border-color: #b58fd6; color: #6b3fb0; }
        .parttree-tog.tog-bom { border-color: #6f9bd0; color: #2f5fa0; }
        .parttree-tog.tog-bom:hover { background: #2f5fa0; color: #fff; }
        .parttree-tog.is-loading { cursor: default; background: #fff; }
        .parttree-tog.is-loading:hover { background: #fff; }
        .parttree-spin {
            width: 12px; height: 12px; border-radius: 50%;
            border: 2px solid rgba(91,58,166,.25); border-top-color: #5b3aa6;
            animation: preview-spin .7s linear infinite; display: block;
        }
        @keyframes preview-spin { to { transform: rotate(360deg); } }
        .parttree-boxerr {
            position: absolute; top: -8px; right: -8px; width: 16px; height: 16px; border-radius: 50%;
            background: #b91c1c; color: #fff; font: 700 11px/16px sans-serif; text-align: center;
        }
        .parttree-warn {
            position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%);
            max-width: 220px; white-space: nowrap; padding: 1px 7px; border-radius: 9px;
            background: #fef3c7; border: 1px solid #f59e0b; color: #92400e;
            font: 600 10px/14px "Segoe UI", Tahoma, sans-serif; z-index: 7; cursor: help;
            box-shadow: 0 1px 3px rgba(120,80,0,.18);
        }
        .parttree-loadingmsg {
            position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
            font: 14px "Segoe UI", sans-serif; color: #5b6573;
            display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center;
        }
        .parttree-loadingmsg.parttree-fail { color: #b91c1c; }
        .parttree-loadingmsg .preview-spinner {
            flex: 0 0 auto; width: 54px; height: 54px; border-width: 5px; display: block;
        }
        .parttree-shot-btn.shot-ok { background: #2e7d32 !important; color: #fff !important; }
        .parttree-shot-btn.shot-err { background: #b91c1c !important; color: #fff !important; }
        .eoq-fco-fixed {
            position: fixed; z-index: 2147483646; box-sizing: border-box;
            max-width: 90vw; padding: 4px 11px; border-radius: 13px;
            background: #fef9c3; border: 1px solid #eab308;
            font-family: "Segoe UI", Tahoma, sans-serif; font-size: 11px; line-height: 15px;
            color: #854d0e; cursor: help; text-align: center; white-space: nowrap;
            box-shadow: 0 1px 4px rgba(120,80,0,.18);
        }
        .eoq-fco-fixed .eoq-warnicon { font-size: 12px; line-height: 1; }
        .eoq-fco-fixed .eoq-title { font-weight: 700; }
        /* Hide the EOQ FCO warning while a preview panel is open (matches buttons) */
        body:has(.preview-panel) .eoq-fco-fixed { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(partTreeStyle);

    // ---- Current-page context detection -------------------------------
    // The tab strip on a part page renders one displayObject('ItemHandler',
    // class, obj, tab) link per tab, all sharing the open object's class/obj.
    // We pick the class/obj group that appears across the most tabs (the real
    // tab strip), then map tab captions to their ids.
    function detectPartContext() {
        const re = /display(?:Object|Tab)?\s*\(\s*['"]([^'"]*ItemHandler[^'"]*)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/;
        const groups = Object.create(null);
        // Agile's tab strip puts displayObject(...) in the anchor HREF, while
        // grid rows put displayItem/displayObject in ONCLICK — scan both.
        document.querySelectorAll('a[href*="ItemHandler"], a[onclick*="ItemHandler"]').forEach((a) => {
            const src = (a.getAttribute('onclick') || '') + ' ' + (a.getAttribute('href') || '');
            const m = re.exec(src);
            if (!m) return;
            const classId = m[2], objId = m[3], tabId = m[4];
            const key = classId + '|' + objId;
            const g = groups[key] || (groups[key] = { classId, objId, tabs: Object.create(null) });
            if (!(tabId in g.tabs)) g.tabs[tabId] = (a.textContent || '').replace(/\s+/g, ' ').trim();
        });
        let best = null, bestCount = 0;
        Object.keys(groups).forEach((k) => {
            const n = Object.keys(groups[k].tabs).length;
            if (n > bestCount) { bestCount = n; best = groups[k]; }
        });
        if (!best || bestCount < 2) return null;
        const tabIds = Object.keys(best.tabs);
        let bomTab = null, wuTab = null;
        tabIds.forEach((t) => {
            const cap = best.tabs[t] || '';
            if (bomTab === null && /\b(bom|bill of material)/i.test(cap)) bomTab = t;
            if (wuTab === null && /where\s*used/i.test(cap)) wuTab = t;
        });
        return { classId: best.classId, objId: best.objId, bomTab, wuTab, titleTab: tabIds[0], tabs: best.tabs };
    }

    // Read the open part's description. On the Title Block tab it lives in a
    // dt/dd pair; on other tabs (BOM, Where Used, ...) it's the trailing text of
    // the page-title paragraph: "<strong>Type</strong> \u2022 DESCRIPTION".
    function getCurrentPartDescription() {
        const dts = document.querySelectorAll('dl.side_by_side_text dt, .side_by_side_text dt, .column_one dt, dt');
        for (const dt of dts) {
            const label = (dt.textContent || '').replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
            if (/^(item\s*)?description$/i.test(label)) {
                let dd = dt.nextElementSibling;
                while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
                if (dd) {
                    const v = (dd.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
                    if (v) return v;
                }
            }
        }
        // Fallback: the page-title paragraph under the part heading.
        const p = document.querySelector('.column_one.layout p, .column_one p');
        if (p) {
            const clone = p.cloneNode(true);
            clone.querySelectorAll('strong, b').forEach((el) => el.remove());
            let txt = (clone.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            txt = txt.replace(/^[\u2022\u00b7\-\s]+/, '').trim();
            if (txt) return txt;
        }
        return '';
    }

    // Read the open part's lifecycle phase. Agile renders it as the object-stamp
    // heading in the right column (e.g. <div class="column_two"><h2>Pre-Production
    // </h2></div>), or in a title-block dt/dd labelled "Lifecycle Phase".
    function getCurrentPartPhase() {
        const h2 = document.querySelector('.column_two h2');
        if (h2) {
            const v = (h2.textContent || '').replace(/\s+/g, ' ').trim();
            if (v && phaseInfo(v)) return v;
        }
        const dts = document.querySelectorAll('dl.side_by_side_text dt, .side_by_side_text dt, dt');
        for (const dt of dts) {
            const label = (dt.textContent || '').replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
            if (/^lifecycle\s*phase$|^phase$/i.test(label)) {
                let dd = dt.nextElementSibling;
                while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
                if (dd) {
                    const v = (dd.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
                    if (v) return v;
                }
            }
        }
        return '';
    }

    // ---- Hidden background frame --------------------------------------
    function cleanAgileUrl() {
        return location.origin + location.pathname + location.search;
    }

    function treeFrameDoc() {
        try { return treeFrame && treeFrame.contentDocument; } catch (e) { return null; }
    }

    // Send a command to the hidden tree frame's MAIN-world helper (in
    // page-iframe-hooks.js). Chrome MV3 forbids injecting scripts into the
    // frame, so we hand commands over via a data attribute the frame's MAIN
    // world watches: { a:'displayObject', args:[...] } or { a:'clickTab', src, flags }.
    function sendFrameCmd(cmd) {
        const d = treeFrameDoc();
        if (!d || !d.documentElement) return;
        try { d.documentElement.setAttribute('data-pp-frame-cmd', JSON.stringify(cmd)); } catch (e) { /* ignore */ }
    }
    // Compatibility shim: older call sites pass a JS string; we only ever used
    // it to call displayObject(...) in the frame, which now goes through
    // sendFrameCmd. Left as a no-op so any stray call is harmless.
    function runInFrameContext() { /* MV3: inline injection disabled — see sendFrameCmd */ }

    // Resolves once the frame has booted Agile and exposes displayObject. The
    // frame's MAIN-world helper proactively sets data-tree-ready='1' on the
    // documentElement once the function exists, so we just poll that attribute.
    function probeFrameReady() {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                const doc = treeFrameDoc();
                if (!doc) { reject(new Error('Background frame document unavailable.')); return; }
                if (doc.documentElement && doc.documentElement.getAttribute('data-tree-ready') === '1') { resolve(true); return; }
                if (Date.now() - t0 > 25000) { reject(new Error('Agile navigation is not available in the background frame.')); return; }
                setTimeout(poll, 250);
            })();
        });
    }

    function ensureTreeFrame() {
        if (treeFrameReady) return treeFrameReady;
        treeFrameReady = new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            frame.id = 'agile-parttree-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden;';
            let settled = false;
            const fail = (e) => { if (!settled) { settled = true; treeFrameReady = null; reject(e); } };
            const hard = setTimeout(() => fail(new Error('Background frame load timed out.')), 35000);
            frame.addEventListener('load', () => {
                probeFrameReady().then(() => {
                    if (settled) return;
                    settled = true; clearTimeout(hard); resolve(true);
                }).catch(fail);
            });
            frame.src = cleanAgileUrl();
            (document.body || document.documentElement).appendChild(frame);
            treeFrame = frame;
        });
        return treeFrameReady;
    }

    // Find a specific GridManager table by id (the BOM tab is always
    // ITEMTABLE_BOM, Where-Used is ITEMTABLE_WHERELIST). Targeting the exact id
    // is what stops us from accidentally scraping the Changes grid, which is
    // also a GMMainTable. Returns the table only once it is loaded (has a
    // header row) and, when freshOnly is set, not left over from a prior nav.
    function findGrid(doc, tableId, freshOnly) {
        if (!doc) return null;
        const t = doc.getElementById(tableId);
        if (!t || !/\bGMMainTable\b/.test(t.className)) return null;
        if (freshOnly && t.hasAttribute('data-tree-stale')) return null;
        if (!t.querySelector('.GMHeaderRow')) return null;
        return t;
    }

    // Count the data rows in a grid that actually carry a part link (the rows
    // the parser will keep). Used to detect when a streaming grid has finished.
    function countGridPartRows(table) {
        if (!table) return 0;
        let n = 0;
        table.querySelectorAll('tr.GMDataRow').forEach((tr) => {
            if (tr.querySelector('td[colspan="2"] a[onclick*="displayItem"], td[colspan="2"] a[onclick*="displayObject"]')) n++;
        });
        return n;
    }
    // Agile renders the row total into the grid footer/pager. The cleanest
    // signal is a dedicated element (e.g. <strong id="totalCount_ITEMTABLE_BOM">
    // 11</strong>), but big grids vary, so we also parse the pager text such as
    // "1 - 20 of 45" or "45 records". Returns -1 when no total can be read.
    function gridReportedTotal(doc, tableId) {
        if (!doc || !doc.getElementById) return -1;
        // 1. Dedicated count element when present.
        const el = doc.getElementById('totalCount_' + tableId);
        if (el) {
            const n = parseInt((el.textContent || '').replace(/[^0-9]/g, ''), 10);
            if (!isNaN(n)) return n;
        }
        // 2. Pager / footer text near the grid (scoped to a few ancestors of the
        //    table so unrelated "of N" text elsewhere on the page is ignored).
        const table = doc.getElementById(tableId);
        let scope = table;
        for (let i = 0; i < 4 && scope && scope.parentElement; i++) scope = scope.parentElement;
        const root = scope || doc;
        let cand;
        try {
            cand = root.querySelectorAll('[id*="totalCount"],[id*="recordCount"],[class*="Pager"],[class*="pager"],[class*="GMFoot"],[class*="Footer"],[class*="footer"],[class*="Count"],[class*="count"]');
        } catch (e) { cand = []; }
        const reOf = /\bof\s+([\d,]+)\b/i;
        const reRows = /([\d,]+)\s*(?:rows?|items?|records?|results?)\b/i;
        let best = -1;
        for (const c of cand) {
            const t = (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (!t) continue;
            const m = reOf.exec(t) || reRows.exec(t);
            if (m) {
                const n = parseInt(m[1].replace(/,/g, ''), 10);
                if (!isNaN(n) && n > best) best = n;
            }
        }
        return best;
    }

    // Wait until the named grid has (re)rendered AND finished streaming its rows.
    // Agile's TreeGrid paints the header first, then injects data rows over
    // several frames; settling on the header alone scrapes a half-empty BOM.
    // We therefore settle only once the part-row count has stopped growing for
    // SETTLE ms, and short-circuit as soon as it reaches the footer's reported
    // total (so full grids resolve fast).
    //
    // onGrow(doc) (optional) is called each time the grid's part-row count grows,
    // so callers can render rows progressively instead of waiting for settle.
    function waitForGrid(tableId, timeoutMs, onGrow) {
        const TIMEOUT = timeoutMs || 18000;
        const SETTLE = 500;
        // An EMPTY grid (0 rows) is given a much longer quiet window before we
        // conclude it's truly empty: the Where-Used / BOM TreeGrid renders its
        // empty shell first and streams rows a beat later, so a short settle on
        // 0 rows wrongly reports "no parents/children" (the intermittent
        // missing-parents bug). Real-empty parts just wait this once.
        const EMPTY_SETTLE = 1600;
        const MIN_WAIT = 200;
        const ROW_HARD_CAP = 80;   // stop waiting once a grid has streamed this many rows
        const doc0 = treeFrameDoc();
        if (!doc0 || !doc0.body) return Promise.reject(new Error('Background frame unavailable.'));
        const t0 = Date.now();
        let lastCount = -1;
        return new Promise((resolve) => {
            let done = false, settleTimer = null;
            const finish = () => {
                if (done) return; done = true;
                if (settleTimer) clearTimeout(settleTimer);
                clearTimeout(hard); obs.disconnect();
                resolve(treeFrameDoc());
            };
            const armSettle = (ms) => {
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(finish, ms == null ? SETTLE : ms);
            };
            const onChange = () => {
                if (Date.now() - t0 < MIN_WAIT) return;
                const d = treeFrameDoc();
                const fresh = findGrid(d, tableId, true);
                if (!fresh) return;                       // grid not rendered yet
                const count = countGridPartRows(fresh);
                const total = gridReportedTotal(d, tableId);
                // Resolve immediately once every reported row is present.
                if (total >= 0 && count >= total && count > 0) {
                    if (count > lastCount && onGrow) { try { onGrow(d); } catch (e) { /* ignore */ } }
                    finish(); return;
                }
                // Very large grids would never finish streaming (and we cannot
                // usefully draw hundreds of boxes from one node) — stop early once
                // we have plenty; the truncation warning covers the rest.
                if (count >= ROW_HARD_CAP) {
                    if (count > lastCount && onGrow) { try { onGrow(d); } catch (e) { /* ignore */ } }
                    finish(); return;
                }
                // Settle when the row count stops GROWING. Tracking the max (not
                // the last) count means virtualized grids whose row count
                // oscillates as rows recycle don't keep re-arming the timer.
                if (count > lastCount) {
                    lastCount = count;
                    // Emit progressive rows so the caller can paint them now.
                    if (onGrow) { try { onGrow(d); } catch (e) { /* ignore */ } }
                    armSettle(SETTLE); return;
                }
                // No growth: if we still have ZERO rows, wait the longer empty
                // window (the grid may not have started streaming yet); once any
                // row exists use the normal settle.
                if (settleTimer == null) armSettle(lastCount <= 0 ? EMPTY_SETTLE : SETTLE);
            };
            const obs = new MutationObserver(onChange);
            obs.observe(doc0.documentElement || doc0, { childList: true, subtree: true });
            const hard = setTimeout(finish, TIMEOUT);
            setTimeout(onChange, MIN_WAIT + 50);
        });
    }

    // Click a tab in the frame by visible caption (fallback when its tab id is
    // unknown). The frame's MAIN-world helper performs the click.
    function clickFrameTab(re) {
        sendFrameCmd({ a: 'clickTab', src: re.source, flags: re.flags });
    }

    // ---- Grid parsing -------------------------------------------------
    function parseObjectIds(onclick) {
        const m = /display(?:Item|Object)\s*\(\s*['"][^'"]*['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/.exec(onclick || '');
        return m ? { classId: m[1], objId: m[2] } : null;
    }

    function gridHeaderLabels(table) {
        const head = (table.querySelector('.GMHeadMid .GMHeaderRow')) || table.querySelector('.GMHeaderRow');
        const labels = [];
        if (head) {
            head.querySelectorAll('td[colspan="2"]').forEach((td) => {
                const span = td.querySelector('span[title]');
                const img = td.querySelector('img[title]');
                const lbl = span ? (span.getAttribute('title') || span.textContent)
                    : (img ? img.getAttribute('title') : td.textContent);
                labels.push((lbl || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
            });
        }
        return labels;
    }

    // Parse an Agile BOM / Where-Used GridManager table into part relations.
    // Header (.GMHeadMid) and body (.GMBodyMid) cells both use colspan="2" and
    // align 1:1, so we map data cells to columns by their colspan="2" index.
    function parseRelationGrid(table) {
        const out = [];
        if (!table) return out;
        const labels = gridHeaderLabels(table);
        let numIdx = labels.findIndex((l) => /item\s*number|^number$|^part\s*number$/i.test(l));
        const descIdx = labels.findIndex((l) => /item\s*desc|^desc(ription)?$|^title$/i.test(l));
        const phaseIdx = labels.findIndex((l) => /lifecycle\s*phase|^phase$|^lifecycle$/i.test(l));
        if (numIdx < 0) numIdx = 0;
        const seen = Object.create(null);
        table.querySelectorAll('tr.GMDataRow').forEach((tr) => {
            const cells = tr.querySelectorAll('td[colspan="2"]');
            if (!cells.length) return;
            const numCell = cells[numIdx];
            if (!numCell) return;
            const link = numCell.querySelector('a[onclick*="displayItem"], a[onclick*="displayObject"]');
            if (!link) return;
            const partNumber = (link.textContent || '').replace(/\s+/g, ' ').trim();
            if (!partNumber) return;
            const ids = parseObjectIds(link.getAttribute('onclick'));
            if (!ids) return;
            const dedupe = ids.classId + '|' + ids.objId;
            if (seen[dedupe]) return;
            seen[dedupe] = true;
            const cellText = (c) => c ? (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : '';
            let description = descIdx >= 0 ? cellText(cells[descIdx]) : '';
            const phase = phaseIdx >= 0 ? cellText(cells[phaseIdx]) : '';
            // Fallback: if this grid view has no (or an empty) description column,
            // use the longest free-text cell in the row (a description reads like
            // prose: has spaces/letters and isn't the part number or a code).
            if (!description) {
                let best = '';
                cells.forEach((c, i) => {
                    if (i === numIdx) return;
                    const t = cellText(c);
                    if (t.length > best.length && /[a-z].*[a-z]/i.test(t) && /\s/.test(t)) best = t;
                });
                description = best;
            }
            out.push({ partNumber, description, phase, classId: ids.classId, objId: ids.objId });
        });
        return out;
    }

    // ---- Relation fetching (serialized through the single frame) ------
    // ---- Relation fetching (priority queue through the single frame) --
    // Runs one job at a time, always picking the highest-priority pending job
    // (FIFO within a priority). User expands are high priority so they never get
    // stuck behind a backlog of background existence-probes.
    function pumpFetchQueue() {
        if (fetchBusy || !fetchQueue.length) return;
        let bi = 0;
        for (let i = 1; i < fetchQueue.length; i++) {
            if (fetchQueue[i].job.priority > fetchQueue[bi].job.priority) bi = i;
        }
        const item = fetchQueue.splice(bi, 1)[0];
        fetchBusy = true;
        Promise.resolve().then(item.fn).then(
            (v) => { fetchBusy = false; item.resolve(v); pumpFetchQueue(); },
            (e) => { fetchBusy = false; item.reject(e); pumpFetchQueue(); }
        );
    }
    function enqueueFetch(fn, job) {
        return new Promise((resolve, reject) => {
            fetchQueue.push({ fn: fn, job: job || { priority: 0 }, resolve: resolve, reject: reject });
            pumpFetchQueue();
        });
    }

    // Fetch one relationship list with caching + in-flight de-duplication. If a
    // request for the same part/direction is already pending, the new caller
    // shares it (and can raise its priority so a user click bumps a probe).
    //
    // onPartial(rows) (optional) streams progressively-parsed rows as the grid
    // loads. It only fires on a fresh fetch (cached/already-inflight calls skip
    // it since their result is already available or being produced elsewhere).
    function fetchRelations(kind, classId, objId, priority, onPartial) {
        priority = priority || 0;
        const cacheKey = kind === 'bom' ? 'children' : 'parents';
        const c = relationCache[objId] || (relationCache[objId] = {});
        if (c[cacheKey]) return Promise.resolve(c[cacheKey]);

        const key = kind + ':' + objId;
        const existing = inflightFetch[key];
        if (existing) {
            if (priority > existing.job.priority) existing.job.priority = priority;
            return existing.promise;
        }
        const job = { priority: priority };
        const tab = kind === 'bom' ? (partContext && partContext.bomTab) : (partContext && partContext.wuTab);
        const re = kind === 'bom' ? /\b(bom|bill of material)/i : /where\s*used/i;
        const tableId = kind === 'bom' ? 'ITEMTABLE_BOM' : 'ITEMTABLE_WHERELIST';
        const promise = enqueueFetch(() => loadRelations(classId, objId, tab, re, tableId, onPartial), job).then(
            (rows) => {
                delete inflightFetch[key];
                // Cache only non-empty results so a transient empty/partial
                // scrape (slow grid) is not remembered and can be retried.
                if (rows && rows.length) c[cacheKey] = rows;
                return rows || [];
            },
            (err) => { delete inflightFetch[key]; throw err; }
        );
        inflightFetch[key] = { promise: promise, job: job };
        return promise;
    }
    function fetchChildren(classId, objId, priority, onPartial) { return fetchRelations('bom', classId, objId, priority, onPartial); }
    function fetchParents(classId, objId, priority, onPartial) { return fetchRelations('parents', classId, objId, priority, onPartial); }

    function loadRelations(classId, objId, tabId, captionRe, tableId, onPartial) {
        return ensureTreeFrame().then(() => {
            const doc = treeFrameDoc();
            if (!doc) throw new Error('Background frame unavailable.');
            // Mark every current grid stale so we can tell when the target grid
            // for THIS navigation has freshly rendered.
            doc.querySelectorAll('table.GMMainTable').forEach((t) => t.setAttribute('data-tree-stale', '1'));
            const tab = tabId ? String(tabId) : String((partContext && partContext.titleTab) || '1');
            sendFrameCmd({ a: 'displayObject', args: ['ItemHandler', String(classId), String(objId), tab] });
            // Stream rows as they arrive so the caller can paint nodes early.
            const onGrow = onPartial ? (d) => {
                const g = findGrid(d, tableId, false);
                if (g) { try { onPartial(parseRelationGrid(g)); } catch (e) { /* ignore */ } }
            } : null;
            return waitForGrid(tableId, undefined, onGrow).then((d) => {
                let grid = findGrid(d, tableId, false);
                // Fallback: if the tab id was wrong/missing, click the tab by its
                // caption and wait again.
                if (!grid && captionRe) {
                    doc.querySelectorAll('table.GMMainTable').forEach((t) => t.setAttribute('data-tree-stale', '1'));
                    clickFrameTab(captionRe);
                    return waitForGrid(tableId, undefined, onGrow).then((d2) => {
                        const rows2 = parseRelationGrid(findGrid(d2, tableId, false));
                        rows2.gridTotal = gridReportedTotal(d2, tableId);
                        return rows2;
                    });
                }
                const rows = parseRelationGrid(grid);
                rows.gridTotal = gridReportedTotal(d, tableId);
                return rows;
            });
        });
    }

    // ---- Navigation ---------------------------------------------------
    function navigateMainToObject(classId, objId) {
        const tab = (partContext && partContext.titleTab) || '1';
        sendPageCmd({ cmd: 'invoke', fn: 'displayObject', args: ['ItemHandler', String(classId), String(objId), String(tab)] });
    }

    // ---- Tree diagram rendering ---------------------------------------
    // Node boxes are laid out as a real graph, flowing LEFT-TO-RIGHT: the
    // current part sits at the origin, its Where-Used parents fan out to the
    // LEFT and its BOM children fan out to the RIGHT, connected by SVG curves.
    // Layout is a simple tidy-tree pass (measure each subtree's vertical extent,
    // then centre each parent vertically over its children).
    const NODE_W = 210, NODE_H = 68, V_GAP = 22, H_LEVEL = 330, CANVAS_PAD = 1400;
    // Only flag a group as truncated (show the "Showing N of T" warning) once it
    // genuinely has more than this many relations, so small de-dup gaps (e.g.
    // "1 of 2" where the other is the part you came from) don't warn.
    const TRUNC_WARN_MIN = 30;

    // Live diagram state for the currently open tree.
    let treeView = null;

    function clipText(s, n) {
        s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n - 1).trim() + '\u2026' : s;
    }

    // ---- Lifecycle phase colour coding --------------------------------
    // Maps an Agile lifecycle phase to a swatch colour + canonical label. The
    // keys are matched as case-insensitive substrings so minor wording variants
    // ("Final Production", "Pre-Production", ...) still resolve.
    const PHASE_COLORS = [
        { re: /pre[\s-]*production/i,        color: '#f59e0b', label: 'Pre-Production' },
        { re: /production|final production/i, color: '#16a34a', label: 'Production' },
        { re: /\bactive\b/i,                 color: '#16a34a', label: 'Active' },
        { re: /prototype|preliminary|concept/i, color: '#0ea5e9', label: 'Prototype' },
        { re: /pilot|ramp/i,                 color: '#22c55e', label: 'Pilot' },
        { re: /mature|standard support|limited support/i, color: '#1e293b', label: 'Mature' },
        { re: /phase[\s-]*out|end of life|eol|ltb|last time buy/i, color: '#ea580c', label: 'Phase-Out' },
        { re: /discontinued|inactive|obsolete|cancell?ed/i, color: '#dc2626', label: 'Discontinued' },
        { re: /hold|mfghold|enghold/i,       color: '#a855f7', label: 'Hold' }
    ];
    function phaseInfo(phase) {
        const p = String(phase || '').trim();
        if (!p) return null;
        for (const e of PHASE_COLORS) { if (e.re.test(p)) return { color: e.color, label: p }; }
        return { color: '#94a3b8', label: p };   // unknown phase -> neutral grey
    }

    // Shared lifecycle-phase legend (used by the toolbar legend row AND the
    // screenshot, so the exported image matches what's on screen).
    const PHASE_LEGEND = [
        { color: '#16a34a', label: 'Active / Production' },
        { color: '#f59e0b', label: 'Pre-Production' },
        { color: '#0ea5e9', label: 'Prototype / Prelim' },
        { color: '#1e293b', label: 'Mature' },
        { color: '#ea580c', label: 'Phase-Out / EOL' },
        { color: '#dc2626', label: 'Discontinued / Inactive' },
        { color: '#a855f7', label: 'Hold' },
        { color: '#94a3b8', label: 'Other' }
    ];

    // Identity used to suppress duplicate boxes: a part is the same wherever it
    // appears (same number). Keyed on the trimmed, upper-cased part number.
    function relKey(rel) { return String(rel.partNumber || '').trim().toUpperCase(); }
    function nodeKey(node) { return relKey(node.rel); }

    // Collect the keys of every part ANYWHERE in the loaded tree — including
    // branches that are currently collapsed — so a part can never appear in two
    // boxes. A collapsed branch still "reserves" its parts; you'll see such a
    // part only by expanding the branch that first claimed it.
    function collectAllKeys() {
        const set = Object.create(null);
        (function walk(node) {
            set[nodeKey(node)] = true;
            if (node.parents.loaded) node.parents.list.forEach(walk);
            if (node.bom.loaded) node.bom.list.forEach(walk);
        })(treeView.root);
        return set;
    }

    // Filter a freshly-fetched relation list: drop rows whose part already
    // appears in `existing`, and collapse repeats within the list itself.
    function dedupeRels(rels, existing) {
        const out = [], seen = Object.create(null);
        rels.forEach((r) => {
            const k = relKey(r);
            if (!k || seen[k] || (existing && existing[k])) return;
            seen[k] = true;
            out.push(r);
        });
        return out;
    }

    // Each node carries TWO independently-expandable relationship groups:
    //   parents = Where-Used (assemblies this part is on)
    //   bom     = BOM components (this part's children)
    // `side` fixes which half of the diagram the node lives on so expansions
    // always grow outward (root parents grow left, root BOM grows right; every
    // other node's expansions grow further out on its own side). This keeps the
    // layout strictly non-overlapping while still letting any node reveal both
    // its parents and its children.
    function newGroup() {
        // probed/probing/has track a lightweight background check of whether the
        // group has ANY relations, so the +/\u2212 handle is only shown when there
        // really is something to expand. (loaded/list are only populated on a
        // real expand; a probe never builds nodes, to keep the dedupe set clean.)
        return {
            loaded: false, expanded: false, loading: false, leaf: false, err: null, list: [],
            probed: false, probing: false, has: false,
            total: 0, truncated: false   // grid pagination: actual count vs how many were rendered
        };
    }
    function makeNode(rel, side, depth) {
        return {
            rel: rel, side: side, depth: depth, isRoot: false,
            parents: newGroup(), bom: newGroup(),
            x: 0, y: 0, sh: 0,
            dx: 0, dy: 0,        // manual drag offset (relative to laid-out spot)
            offX: 0, offY: 0     // cumulative offset (self + ancestors), per render
        };
    }

    // Relationship direction is consistent for EVERY node: Where-Used parents
    // always fan out to the LEFT, BOM children always fan out to the RIGHT.
    function leftKidsOf(node) {
        return node.parents.expanded ? node.parents.list : [];
    }
    function rightKidsOf(node) {
        return node.bom.expanded ? node.bom.list : [];
    }

    // ---- Tidy-tree layout (top-down, anchor-stable) -------------------
    // X is fixed by graph distance from the root and direction: parents step
    // LEFT (-H_LEVEL per level), BOM children step RIGHT (+H_LEVEL). Columns are
    // discrete multiples of H_LEVEL (330px), wider than a box (210px), so boxes
    // can only ever collide vertically within the SAME column.
    //
    // Y is assigned TOP-DOWN: a node keeps the Y its own parent gave it and is
    // NEVER moved to follow its children. Each group of children is placed as a
    // block centred on the parent's Y, and only pushed DOWN if that column is
    // already occupied above (a per-column "next free Y" cursor). So expanding a
    // node's children does not shift the node \u2014 things move only when there is
    // genuinely no room. Processing in breadth-first order keeps it stable.
    function setX(node, x) {
        node.x = x;
        leftKidsOf(node).forEach((k) => setX(k, x - H_LEVEL));
        rightKidsOf(node).forEach((k) => setX(k, x + H_LEVEL));
    }
    const ROW = NODE_H + V_GAP;
    function colKey(x) { return Math.round(x / H_LEVEL); }

    function layoutY(root) {
        const colNext = Object.create(null);   // colKey -> lowest free Y (top of next slot)
        root.y = 0;
        colNext[colKey(root.x)] = root.y + ROW;

        const queue = [root];
        while (queue.length) {
            const node = queue.shift();
            // Left children (parents) and right children (BOM) live in separate
            // columns; place each block centred on this node, pushed down only
            // if its column is already taken above.
            [leftKidsOf(node), rightKidsOf(node)].forEach((group) => {
                if (!group.length) return;
                const col = colKey(group[0].x);
                const span = (group.length - 1) * ROW;
                let top = node.y - span / 2;        // desired: centred on parent
                const floor = (colNext[col] == null) ? -Infinity : colNext[col];
                if (top < floor) top = floor;       // only shift when blocked
                group.forEach((kid, i) => { kid.y = top + i * ROW; queue.push(kid); });
                colNext[col] = top + span + ROW;    // reserve this column span
            });
        }
    }

    function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

    // Manual-drag support. Each node has a personal offset (dx, dy); a node's
    // EFFECTIVE position is its laid-out (x, y) plus the sum of its own and all
    // ancestors' offsets, so dragging a node moves its whole subtree with it.
    function computeOffsets(node, accX, accY) {
        node.offX = accX + (node.dx || 0);
        node.offY = accY + (node.dy || 0);
        leftKidsOf(node).forEach((k) => computeOffsets(k, node.offX, node.offY));
        rightKidsOf(node).forEach((k) => computeOffsets(k, node.offX, node.offY));
    }
    function effX(node) { return node.x + (node.offX || 0); }
    function effY(node) { return node.y + (node.offY || 0); }

    // Active drag (shared across per-box handlers + window listeners).
    let dragState = null;

    // Lightweight reposition during a drag: recompute offsets and move only the
    // affected DOM (box left/top + edge paths) \u2014 no full rebuild.
    function repositionForDrag() {
        if (!treeView || !treeView.lastNodes) return;
        computeOffsets(treeView.root, 0, 0);
        const ox = treeView.ox, oy = treeView.oy;
        treeView.lastNodes.forEach((n) => {
            if (n._el) {
                n._el.style.left = (effX(n) + ox - NODE_W / 2) + 'px';
                n._el.style.top = (effY(n) + oy - NODE_H / 2) + 'px';
            }
        });
        (treeView.lastEdges || []).forEach((e) => {
            const x1 = effX(e.p) + ox + e.sign * NODE_W / 2;
            const y1 = effY(e.p) + oy;
            const x2 = effX(e.c) + ox - e.sign * NODE_W / 2;
            const y2 = effY(e.c) + oy;
            const mx = (x1 + x2) / 2;
            e.path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2);
        });
    }

    function renderTree() {
        if (!treeView) return;
        const root = treeView.root;
        const canvas = treeView.canvas;
        treeView.renderSeq = (treeView.renderSeq || 0) + 1;

        // Record where the root currently sits in the viewport so we can keep it
        // pinned after re-layout (no jump when expanding/collapsing).
        let anchorVX = null, anchorVY = null;
        if (treeView.rendered && treeView.ox != null) {
            const s0 = treeView.scale;
            anchorVX = (effX(root) + treeView.ox) * s0 - treeView.scroll.scrollLeft;
            anchorVY = (effY(root) + treeView.oy) * s0 - treeView.scroll.scrollTop;
        }

        // Tidy layout: fix X by depth/direction, then assign Y top-down so a
        // node stays put when its children expand (children shift, not parents).
        setX(root, 0);
        layoutY(root);
        // Apply manual drag offsets on top of the laid-out positions.
        computeOffsets(root, 0, 0);

        // Gather every node + each edge (sign -1 = child on the left, +1 = right).
        const nodes = [];
        const edges = [];
        (function walk(node) {
            nodes.push(node);
            leftKidsOf(node).forEach((k) => { edges.push([node, k, -1]); walk(k); });
            rightKidsOf(node).forEach((k) => { edges.push([node, k, 1]); walk(k); });
        })(root);

        // Handles are OPTIMISTIC: a +/− is shown on every node until a click
        // proves a side empty. We deliberately do NOT background-probe every
        // visible node here — that navigated the hidden frame twice per node and
        // was the main source of slowness. The only cost of skipping it is that
        // a leaf's handle lingers until its first (empty) click removes it.
        // Keep a FIXED world origin so existing nodes never move between renders
        // (the view stays put when expanding/collapsing). The canvas is padded
        // generously on all sides so there is plenty of empty space to pan into;
        // it only grows if the content extends beyond that pad.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach((n) => {
            minX = Math.min(minX, n.x - NODE_W / 2); maxX = Math.max(maxX, n.x + NODE_W / 2);
            minY = Math.min(minY, n.y - NODE_H / 2); maxY = Math.max(maxY, n.y + NODE_H / 2);
        });
        // ox/oy map world (0,0) -> a fixed canvas pixel. Expand the pad if the
        // content ever reaches past it so coordinates stay positive, but never
        // shrink it (so the layout doesn't drift on collapse).
        const padL = Math.max(CANVAS_PAD, Math.ceil(-minX) + 80);
        const padT = Math.max(CANVAS_PAD, Math.ceil(-minY) + 80);
        treeView.padL = Math.max(treeView.padL || 0, padL);
        treeView.padT = Math.max(treeView.padT || 0, padT);
        const ox = treeView.padL, oy = treeView.padT;
        const W = Math.max(maxX + ox + CANVAS_PAD, 200);
        const H = Math.max(maxY + oy + CANVAS_PAD, 200);
        treeView.ox = ox; treeView.oy = oy;

        // Build everything into a detached fragment FIRST, then swap it into the
        // canvas in one step. If any box/edge build throws, the existing canvas
        // is left untouched (never blanks the whole tree).
        const frag = document.createDocumentFragment();

        // Connector curves (one SVG layer behind the boxes). Horizontal flow:
        // leave the parent box from its left/right edge, enter the child box on
        // the opposite edge.
        const svg = svgEl('svg');
        svg.setAttribute('class', 'parttree-edges');
        svg.setAttribute('width', W); svg.setAttribute('height', H);
        const edgeRefs = [];
        edges.forEach((e) => {
            const p = e[0], c = e[1], sign = e[2];
            const x1 = effX(p) + ox + sign * NODE_W / 2;
            const y1 = effY(p) + oy;
            const x2 = effX(c) + ox - sign * NODE_W / 2;
            const y2 = effY(c) + oy;
            const mx = (x1 + x2) / 2;
            const path = svgEl('path');
            path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2);
            path.setAttribute('class', 'parttree-edge');
            svg.appendChild(path);
            edgeRefs.push({ p: p, c: c, sign: sign, path: path });
        });
        frag.appendChild(svg);

        // Node boxes on top.
        nodes.forEach((node) => { frag.appendChild(buildBox(node, ox, oy)); });

        // Keep refs so a drag can reposition without a full rebuild.
        treeView.lastNodes = nodes;
        treeView.lastEdges = edgeRefs;

        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        canvas.innerHTML = '';
        canvas.appendChild(frag);

        applyZoom(W, H);

        // Pin the root back to the exact viewport pixel it occupied before, so
        // the diagram does not jump when a branch expands or collapses.
        if (anchorVX != null) {
            const s = treeView.scale;
            treeView.scroll.scrollLeft = (effX(root) + ox) * s - anchorVX;
            treeView.scroll.scrollTop = (effY(root) + oy) * s - anchorVY;
        }
        treeView.rendered = true;
    }

    // Add one expand/collapse handle for a relationship group to a box.
    // OPTIMISTIC: the handle is shown right away and only removed once a
    // background probe (or a real expand) confirms the group is empty. This
    // keeps the tree responsive \u2014 handles appear instantly and the few that
    // have nothing to show quietly disappear a moment later.
    //   group: 'parents' | 'bom'   edge: 'left' | 'right'
    function addToggle(box, node, group, edge) {
        const g = node[group];
        let show;
        if (g.loaded && g.leaf) show = false;         // known empty -> remove
        else if (g.loaded) show = g.list.length > 0;  // known contents
        else if (g.probed) show = g.has;              // probe confirmed empty/non-empty
        else show = true;                             // unknown yet -> show optimistically
        if (!show) return;

        const tog = document.createElement('button');
        tog.type = 'button';
        tog.className = 'parttree-tog on-' + edge + ' tog-' + group;
        if (g.loading) {
            tog.classList.add('is-loading');
            tog.innerHTML = '<span class="parttree-spin"></span>';
        } else {
            tog.textContent = g.expanded ? '\u2212' : '+';
        }
        const noun = group === 'parents' ? 'where this part is used (parents)' : 'this part\u2019s BOM (children)';
        tog.title = (g.expanded ? 'Hide ' : 'Show ') + noun;
        tog.addEventListener('click', (e) => { e.stopPropagation(); toggleGroup(node, group); });
        box.appendChild(tog);
    }

    function buildBox(node, ox, oy) {
        const box = document.createElement('div');
        box.className = 'parttree-box' + (node.isRoot ? ' is-root' : (node.side === 'left' ? ' is-up' : ' is-down'));
        box.style.left = (effX(node) + ox - NODE_W / 2) + 'px';
        box.style.top = (effY(node) + oy - NODE_H / 2) + 'px';
        node._el = box;   // ref for live drag reposition

        // Text lives in an inner wrapper that clips overflow, so the toggle
        // handles (placed on the box edges) are never covered.
        const inner = document.createElement('div');
        inner.className = 'parttree-box-inner';
        const pn = document.createElement('div');
        pn.className = 'parttree-pn';
        const ph = phaseInfo(node.rel.phase);
        if (ph) {
            const dot = document.createElement('span');
            dot.className = 'parttree-dot';
            dot.style.background = ph.color;
            dot.title = 'Lifecycle phase: ' + ph.label;
            pn.appendChild(dot);
        }
        pn.appendChild(document.createTextNode(node.rel.partNumber));
        inner.appendChild(pn);
        if (node.rel.description) {
            const d = document.createElement('div');
            d.className = 'parttree-desc';
            d.textContent = clipText(node.rel.description, 110);
            inner.appendChild(d);
        }
        box.appendChild(inner);
        box.title = node.rel.partNumber +
            (node.rel.description ? ' \u2014 ' + node.rel.description : '') + '  (click to open in Agile)';

        // Left-press a box to either DRAG it (reorganize) or, on a clean click
        // with no drag, navigate to that part. A drag past a small threshold
        // suppresses the navigation click. Dragging a node moves its whole
        // subtree (offsets cascade to descendants).
        let pressSeq = -1;
        box.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest && e.target.closest('.parttree-tog')) return;
            pressSeq = treeView ? treeView.renderSeq : -1;
            dragState = {
                node: node,
                startX: e.clientX, startY: e.clientY,
                baseDx: node.dx || 0, baseDy: node.dy || 0,
                moved: false
            };
            e.preventDefault();   // don't start a native text selection
        });
        box.addEventListener('click', (e) => {
            if (e.target.closest && e.target.closest('.parttree-tog')) return;
            // Suppress navigation if this press turned into a drag.
            if (box.dataset.dragged === '1') { delete box.dataset.dragged; return; }
            if (!treeView || treeView.renderSeq !== pressSeq) return;
            navigateMainToObject(node.rel.classId, node.rel.objId);
        });

        // Toggles: parents (purple) always on the LEFT edge, BOM children
        // (blue) always on the RIGHT edge \u2014 for every node, including the root.
        addToggle(box, node, 'parents', 'left');
        addToggle(box, node, 'bom', 'right');

        if (node.parents.err || node.bom.err) {
            const er = document.createElement('div');
            er.className = 'parttree-boxerr';
            er.textContent = '!';
            er.title = node.parents.err || node.bom.err;
            box.appendChild(er);
        }

        // Warn when an expanded group was truncated by Agile's grid pagination
        // (more relations exist than the grid rendered, so not all are shown).
        const truncParts = [];
        if (node.parents.expanded && node.parents.truncated) {
            truncParts.push(node.parents.list.length + ' of ' + node.parents.total + ' parents');
        }
        if (node.bom.expanded && node.bom.truncated) {
            truncParts.push(node.bom.list.length + ' of ' + node.bom.total + ' children');
        }
        if (truncParts.length) {
            const w = document.createElement('div');
            w.className = 'parttree-warn';
            w.textContent = '\u26a0 Showing ' + truncParts.join(', ');
            w.title = 'Not every related part is drawn here.\n'
                + 'Some may be on a later page of Agile\u2019s grid, or already shown elsewhere in this tree.\n'
                + 'Open this part in Agile to see the full list.';
            box.appendChild(w);
        }
        return box;
    }

    // Build/refresh a group's child node list from a (partial or final) row set,
    // de-duplicating against the rest of the tree. Safe to call repeatedly as
    // rows stream in: existing child node objects are reused by part number so
    // their own expand/probe state survives each progressive update. Returns the
    // number of nodes after de-dup.
    function populateGroup(node, group, rows, childSide) {
        const g = node[group];
        // Compute the dedupe set EXCLUDING this group's own current nodes (so a
        // part isn't blocked against itself), by hiding them during the walk.
        const prevLoaded = g.loaded, prevList = g.list;
        g.loaded = false; g.list = [];
        const seen = collectAllKeys();
        g.loaded = prevLoaded;
        const filtered = dedupeRels(rows || [], seen);
        const byKey = Object.create(null);
        prevList.forEach((n) => { byKey[nodeKey(n)] = n; });
        g.list = filtered.map((r) => {
            const ex = byKey[relKey(r)];
            if (ex) { ex.rel = r; return ex; }   // keep existing node (and its state)
            return makeNode(r, childSide, node.depth + 1);
        });
        return filtered.length;
    }

    function toggleGroup(node, group) {
        const g = node[group];
        if (g.leaf) return;
        if (g.loaded) { g.expanded = !g.expanded; renderTree(); return; }
        g.loading = true; g.err = null; renderTree();
        const fetcher = group === 'bom' ? fetchChildren : fetchParents;
        // Box colour follows the relationship: parents tinted as "up" (left),
        // BOM children as "down" (right).
        const childSide = group === 'bom' ? 'right' : 'left';
        // Progressive: paint child nodes as the grid streams them in, so the
        // first relations appear immediately instead of after the full settle.
        const onPartial = (partialRows) => {
            if (node[group] !== g) return;
            const n = populateGroup(node, group, partialRows, childSide);
            if (n > 0) {
                g.loading = false; g.loaded = true; g.expanded = true; g.has = true; g.leaf = false;
                renderTree();
            }
        };
        // High priority: a user click must jump ahead of background probes.
        fetcher(node.rel.classId, node.rel.objId, 100, onPartial).then((rels) => {
            g.loading = false; g.loaded = true; g.probed = true;
            // The true number of relations this part has: the grid's reported
            // total when known, otherwise the number of rows we actually scraped.
            const reported = (typeof rels.gridTotal === 'number' && rels.gridTotal >= 0) ? rels.gridTotal : rels.length;
            g.total = Math.max(reported, rels.length);
            // Final pass: rebuild from the complete row set (corrects any rows
            // captured mid-render) and de-dup against the rest of the tree.
            const n = populateGroup(node, group, rels, childSide);
            if (!n) { g.leaf = true; g.expanded = false; g.has = false; }
            else { g.expanded = true; g.has = true; }
            // Truncated when fewer boxes are shown than the part really has,
            // whether from grid pagination or de-dup. Only warn for large lists.
            g.truncated = g.expanded && g.list.length < g.total && g.total > TRUNC_WARN_MIN;
            renderTree();
        }).catch((err) => {
            g.loading = false; g.err = (err && err.message) ? err.message : String(err);
            renderTree();
        });
    }

    // Coalesce many probe-driven re-renders into one per animation frame.
    let probeRenderPending = false;
    function scheduleProbeRender() {
        if (!treeView || probeRenderPending) return;
        probeRenderPending = true;
        requestAnimationFrame(() => { probeRenderPending = false; if (treeView) renderTree(); });
    }

    // Background check: does this group have ANY relations? Loads the relation
    // list (cached for a later real expand) but does NOT build diagram nodes, so
    // the dedupe set is untouched. Sets `has`, then re-renders so the +/\u2212 handle
    // appears only when there is something to show. Runs once per group.
    function ensureProbed(node, group) {
        const g = node[group];
        if (g.loaded || g.probed || g.probing || g.loading) return;
        g.probing = true;
        const fetcher = group === 'bom' ? fetchChildren : fetchParents;
        // Low priority: existence probes must never delay a user expand.
        fetcher(node.rel.classId, node.rel.objId, 0).then((rels) => {
            g.probing = false; g.probed = true;
            // After dedupe, would any of these actually be shown? (A part whose
            // only relation is already on screen should not offer an empty +.)
            g.has = dedupeRels(rels || [], collectAllKeys()).length > 0;
            scheduleProbeRender();
        }).catch(() => {
            // On error, leave the handle visible so the user can click and see
            // the failure rather than silently hiding a real relationship.
            g.probing = false; g.probed = true; g.has = true;
            scheduleProbeRender();
        });
    }

    // --- zoom + scroll plumbing ---
    function applyZoom(W, H) {
        const s = treeView.scale;
        treeView.canvas.style.transform = 'scale(' + s + ')';
        treeView.sizer.style.width = (W * s) + 'px';
        treeView.sizer.style.height = (H * s) + 'px';
        if (treeView.zoomLabel) treeView.zoomLabel.textContent = Math.round(s * 100) + '%';
        treeView.lastW = W; treeView.lastH = H;
    }
    function setZoom(s) {
        if (!treeView) return;
        treeView.scale = Math.max(0.3, Math.min(1.6, s));
        applyZoom(treeView.lastW || 800, treeView.lastH || 600);
    }
    function centerOnRoot() {
        if (!treeView) return;
        const root = treeView.root, s = treeView.scale, sc = treeView.scroll;
        sc.scrollLeft = (root.x + treeView.ox) * s - sc.clientWidth / 2;
        sc.scrollTop = (root.y + treeView.oy) * s - sc.clientHeight / 2;
    }

    // --- Full-area screenshot -> clipboard ---
    // Redraws the WHOLE tree (every visible box + connector, regardless of
    // scroll/zoom) onto an offscreen canvas and copies it as a PNG. Drawing
    // natively (rather than rasterising the DOM) keeps it crisp and avoids any
    // cross-origin canvas tainting.
    function truncateToWidth(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        let lo = 0, hi = text.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(text.slice(0, mid) + '\u2026').width <= maxW) lo = mid; else hi = mid - 1;
        }
        return text.slice(0, lo).trim() + '\u2026';
    }
    function wrapToLines(ctx, text, maxW, maxLines) {
        const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        const lines = [];
        let idx = 0;
        while (idx < words.length && lines.length < maxLines) {
            let cur = words[idx++];
            while (idx < words.length && ctx.measureText(cur + ' ' + words[idx]).width <= maxW) {
                cur += ' ' + words[idx++];
            }
            lines.push(cur);
        }
        // Anything left over couldn't fit; mark the last line with an ellipsis.
        if (idx < words.length && lines.length) {
            const last = lines.length - 1;
            lines[last] = truncateToWidth(ctx, lines[last] + ' ' + words.slice(idx).join(' '), maxW);
        }
        return lines.map((l) => truncateToWidth(ctx, l, maxW));
    }
    function roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function renderTreeToCanvas() {
        const root = treeView.root;
        // Collect the currently-visible nodes + edges (same walk as renderTree).
        const nodes = [], edges = [];
        (function walk(node) {
            nodes.push(node);
            leftKidsOf(node).forEach((k) => { edges.push([node, k, -1]); walk(k); });
            rightKidsOf(node).forEach((k) => { edges.push([node, k, 1]); walk(k); });
        })(root);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach((n) => {
            minX = Math.min(minX, effX(n) - NODE_W / 2); maxX = Math.max(maxX, effX(n) + NODE_W / 2);
            minY = Math.min(minY, effY(n) - NODE_H / 2); maxY = Math.max(maxY, effY(n) + NODE_H / 2);
        });
        const PAD = 40;
        let ox = PAD - minX, oy = PAD - minY;
        let W = Math.ceil(maxX - minX + 2 * PAD);
        let H = Math.ceil(maxY - minY + 2 * PAD);

        // Reserve clear space for the top-right legend box so it never overlaps
        // nodes. Measure the legend, then if any node in the legend's horizontal
        // band reaches into its vertical band, push ALL content down by the
        // overlap (and grow the canvas height to match) so the legend sits in
        // fresh whitespace above the tree.
        const measureCtx = document.createElement('canvas').getContext('2d');
        const leg = measureLegendBox(measureCtx);
        const legLeft = W - leg.MARGIN - leg.boxW;
        const legRight = W - leg.MARGIN;
        const legBottom = leg.MARGIN + leg.boxH;
        const LEG_GAP = 16;
        let needTop = 0;
        nodes.forEach((n) => {
            const nl = effX(n) + ox - NODE_W / 2, nr = effX(n) + ox + NODE_W / 2;
            if (nr < legLeft - LEG_GAP || nl > legRight + LEG_GAP) return; // not under the legend
            const nt = effY(n) + oy - NODE_H / 2;
            const deficit = (legBottom + LEG_GAP) - nt;
            if (deficit > needTop) needTop = deficit;
        });
        if (needTop > 0) { oy += needTop; H += Math.ceil(needTop); }

        const dpr = Math.min(window.devicePixelRatio || 1, 2) * 1.5;
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(W * dpr);
        canvas.height = Math.ceil(H * dpr);
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.textBaseline = 'alphabetic';

        // Background.
        ctx.fillStyle = '#faf9fe';
        ctx.fillRect(0, 0, W, H);

        // Edges.
        ctx.strokeStyle = '#c3b2ea';
        ctx.lineWidth = 1.6;
        edges.forEach((e) => {
            const p = e[0], c = e[1], sign = e[2];
            const x1 = effX(p) + ox + sign * NODE_W / 2, y1 = effY(p) + oy;
            const x2 = effX(c) + ox - sign * NODE_W / 2, y2 = effY(c) + oy;
            const mx = (x1 + x2) / 2;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
            ctx.stroke();
        });

        // Boxes.
        nodes.forEach((node) => {
            const bx = effX(node) + ox - NODE_W / 2, by = effY(node) + oy - NODE_H / 2;
            const isRoot = node.isRoot, isUp = !isRoot && node.side === 'left';
            ctx.fillStyle = isRoot ? '#efeafc' : '#ffffff';
            ctx.strokeStyle = isRoot ? '#5b3aa6' : (isUp ? '#c9b6e8' : '#d6c9f5');
            ctx.lineWidth = 1.5;
            roundRectPath(ctx, bx, by, NODE_W, NODE_H, 8);
            ctx.fill();
            ctx.stroke();

            const tx = bx + 9, maxW = NODE_W - 18;
            // Phase dot + part number.
            const ph = phaseInfo(node.rel.phase);
            let pnX = tx;
            if (ph) {
                ctx.beginPath();
                ctx.arc(tx + 5, by + 16, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = ph.color;
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(0,0,0,.15)';
                ctx.stroke();
                pnX = tx + 15;
            }
            ctx.fillStyle = isRoot ? '#3a2480' : '#4a2f8a';
            ctx.font = '700 13px "Segoe UI", Tahoma, sans-serif';
            ctx.fillText(truncateToWidth(ctx, node.rel.partNumber || '', maxW - (pnX - tx)), pnX, by + 21);
            // Description (up to 2 lines).
            if (node.rel.description) {
                ctx.fillStyle = '#5b6573';
                ctx.font = '11px "Segoe UI", Tahoma, sans-serif';
                const lines = wrapToLines(ctx, node.rel.description, maxW, 2);
                lines.forEach((ln, i) => ctx.fillText(ln, tx, by + 38 + i * 14));
            }
        });

        // Legend box (lifecycle phase key) pinned to the TOP-RIGHT of the image.
        drawLegendBox(ctx, W);

        return canvas;
    }

    // Draw the lifecycle-phase legend as a titled, rounded box in the top-right
    // corner of the screenshot canvas (mirrors the on-screen toolbar legend).
    const LEGEND_LAYOUT = { MARGIN: 16, PAD: 12, ROW_H: 18, DOT_R: 5, GAP: 8,
        titleFont: '700 13px "Segoe UI", Tahoma, sans-serif',
        itemFont: '12px "Segoe UI", Tahoma, sans-serif', title: 'Lifecycle phase' };

    // Compute the legend box footprint (so renderTreeToCanvas can reserve space).
    function measureLegendBox(ctx) {
        const L = LEGEND_LAYOUT;
        ctx.font = L.titleFont;
        let contentW = ctx.measureText(L.title).width;
        ctx.font = L.itemFont;
        PHASE_LEGEND.forEach((e) => {
            const w = L.DOT_R * 2 + L.GAP + ctx.measureText(e.label).width;
            if (w > contentW) contentW = w;
        });
        const boxW = Math.ceil(contentW + L.PAD * 2);
        const boxH = Math.ceil(L.PAD * 2 + L.ROW_H + 6 + PHASE_LEGEND.length * L.ROW_H);
        return { boxW, boxH, MARGIN: L.MARGIN };
    }

    function drawLegendBox(ctx, canvasW) {
        const L = LEGEND_LAYOUT;
        const { boxW, boxH } = measureLegendBox(ctx);
        const bx = Math.round(canvasW - L.MARGIN - boxW);
        const by = L.MARGIN;

        // Card background + border + soft shadow.
        ctx.save();
        ctx.shadowColor = 'rgba(40,24,90,0.18)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = '#ffffff';
        roundRectPath(ctx, bx, by, boxW, boxH, 10);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = '#d9d2ec';
        ctx.lineWidth = 1.5;
        roundRectPath(ctx, bx, by, boxW, boxH, 10);
        ctx.stroke();

        // Title.
        let y = by + L.PAD + 12;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#4a2f8a';
        ctx.font = L.titleFont;
        ctx.fillText(L.title, bx + L.PAD, y);
        y += 8;

        // Items: colour dot + label.
        ctx.font = L.itemFont;
        PHASE_LEGEND.forEach((e) => {
            y += L.ROW_H;
            const cy = y - 4;
            ctx.beginPath();
            ctx.arc(bx + L.PAD + L.DOT_R, cy, L.DOT_R, 0, Math.PI * 2);
            ctx.fillStyle = e.color;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(0,0,0,.15)';
            ctx.stroke();
            ctx.fillStyle = '#3a3a44';
            ctx.fillText(e.label, bx + L.PAD + L.DOT_R * 2 + L.GAP, y);
        });
    }

    function captureTreeToClipboard(btn) {
        if (!treeView) return;
        const original = btn.innerHTML;
        const flash = (txt, ok) => {
            btn.innerHTML = txt;
            btn.classList.toggle('shot-ok', ok === true);
            btn.classList.toggle('shot-err', ok === false);
            setTimeout(() => {
                btn.innerHTML = original;
                btn.classList.remove('shot-ok', 'shot-err');
            }, 1600);
        };
        let canvas;
        try { canvas = renderTreeToCanvas(); }
        catch (err) { log('Screenshot render failed:', err); flash('\u2715 Failed', false); return; }

        canvas.toBlob((blob) => {
            if (!blob) { flash('\u2715 Failed', false); return; }
            const tryDownload = () => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'part-tree-' + (treeView.root.rel.partNumber || 'export') + '.png';
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);
            };
            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                    .then(() => flash('\u2713 Copied', true))
                    .catch((err) => {
                        log('Clipboard image write failed, downloading instead:', err);
                        tryDownload();
                        flash('\u2193 Saved', true);
                    });
            } else {
                tryDownload();
                flash('\u2193 Saved', true);
            }
        }, 'image/png');
    }

    function buildTreeScaffold(body) {
        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'parttree-wrap';

        const toolbar = document.createElement('div');
        toolbar.className = 'parttree-toolbar';
        const zo = document.createElement('button'); zo.type = 'button'; zo.className = 'parttree-zoombtn'; zo.textContent = '\u2212';
        const zl = document.createElement('span'); zl.className = 'parttree-zoomlabel'; zl.textContent = '100%';
        const zi = document.createElement('button'); zi.type = 'button'; zi.className = 'parttree-zoombtn'; zi.textContent = '+';
        const zf = document.createElement('button'); zf.type = 'button'; zf.className = 'parttree-fitbtn'; zf.title = 'Re-center on this part';
        zf.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M3 11.5 12 4l9 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M5 10v9h5v-5h4v5h5v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>';
        const hint = document.createElement('span'); hint.className = 'parttree-toolbar-hint';
        hint.textContent = 'Drag a box to rearrange \u00b7 left + = parents \u00b7 right + = BOM \u00b7 drag empty space to pan \u00b7 click a box to open.';
        const zr = document.createElement('button'); zr.type = 'button'; zr.className = 'parttree-fitbtn'; zr.textContent = 'Reset layout';
        zr.title = 'Undo all manual box moves';
        zo.addEventListener('click', () => setZoom((treeView ? treeView.scale : 1) - 0.15));
        zi.addEventListener('click', () => setZoom((treeView ? treeView.scale : 1) + 0.15));
        zf.addEventListener('click', () => { setZoom(1); centerOnRoot(); });
        zr.addEventListener('click', () => {
            if (!treeView) return;
            (function clear(n) { n.dx = 0; n.dy = 0; n.parents.list.forEach(clear); n.bom.list.forEach(clear); })(treeView.root);
            renderTree();
            setTimeout(centerOnRoot, 0);
        });
        toolbar.appendChild(zo); toolbar.appendChild(zl); toolbar.appendChild(zi);
        toolbar.appendChild(zf); toolbar.appendChild(zr); toolbar.appendChild(hint);

        // Phase legend (lifecycle phase colour key) as a second toolbar row.
        const legend = document.createElement('div');
        legend.className = 'parttree-legend';
        const LEGEND = PHASE_LEGEND;
        const legTitle = document.createElement('span');
        legTitle.className = 'parttree-legend-title';
        legTitle.textContent = 'Lifecycle phase:';
        legend.appendChild(legTitle);
        LEGEND.forEach((e) => {
            const item = document.createElement('span');
            item.className = 'parttree-legend-item';
            const dot = document.createElement('span');
            dot.className = 'parttree-dot';
            dot.style.background = e.color;
            item.appendChild(dot);
            item.appendChild(document.createTextNode(e.label));
            legend.appendChild(item);
        });

        const scroll = document.createElement('div');
        scroll.className = 'parttree-scroll';
        const sizer = document.createElement('div');
        sizer.className = 'parttree-sizer';
        const canvas = document.createElement('div');
        canvas.className = 'parttree-canvas';
        sizer.appendChild(canvas);
        scroll.appendChild(sizer);

        // Pan the canvas by dragging empty space (left button, Lucidchart/Fusion
        // style) or by dragging with the right button anywhere. Dragging on a
        // node box is ignored so boxes stay clickable.
        let panning = false, panStartX = 0, panStartY = 0, panLeft = 0, panTop = 0, panMoved = false, panBtn = 0;
        function onEmptySpace(target) {
            return !(target.closest && target.closest('.parttree-box'));
        }
        scroll.addEventListener('mousedown', (e) => {
            const leftOnEmpty = e.button === 0 && onEmptySpace(e.target);
            const rightAnywhere = e.button === 2;
            if (!leftOnEmpty && !rightAnywhere) return;
            panning = true; panMoved = false; panBtn = e.button;
            panStartX = e.clientX; panStartY = e.clientY;
            panLeft = scroll.scrollLeft; panTop = scroll.scrollTop;
            scroll.classList.add('is-panning');
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            // Node drag takes precedence over canvas pan.
            if (dragState) {
                const s = (treeView && treeView.scale) || 1;
                const dx = (e.clientX - dragState.startX) / s;
                const dy = (e.clientY - dragState.startY) / s;
                if (!dragState.moved && (Math.abs(e.clientX - dragState.startX) > 3 || Math.abs(e.clientY - dragState.startY) > 3)) {
                    dragState.moved = true;
                    scroll.classList.add('is-dragging-node');
                    if (dragState.node._el) dragState.node._el.dataset.dragged = '1';
                }
                if (dragState.moved) {
                    dragState.node.dx = dragState.baseDx + dx;
                    dragState.node.dy = dragState.baseDy + dy;
                    repositionForDrag();
                    e.preventDefault();
                }
                return;
            }
            if (!panning) return;
            const dx = e.clientX - panStartX, dy = e.clientY - panStartY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
            scroll.scrollLeft = panLeft - dx;
            scroll.scrollTop = panTop - dy;
            e.preventDefault();
        });
        window.addEventListener('mouseup', (e) => {
            if (dragState) {
                const wasDrag = dragState.moved;
                dragState = null;
                scroll.classList.remove('is-dragging-node');
                // Leave the dataset.dragged flag so the click handler that fires
                // next suppresses navigation; it clears the flag itself.
                if (!wasDrag && e.button === 0) { /* treated as a click */ }
                return;
            }
            if (!panning || e.button !== panBtn) return;
            panning = false;
            scroll.classList.remove('is-panning');
        });
        scroll.addEventListener('contextmenu', (e) => {
            // Only block the menu when it was a pan-drag, so a plain right-click
            // still behaves normally elsewhere.
            if (panMoved) { e.preventDefault(); panMoved = false; }
        });

        wrap.appendChild(toolbar);
        wrap.appendChild(legend);
        wrap.appendChild(scroll);
        body.appendChild(wrap);

        return { scroll: scroll, sizer: sizer, canvas: canvas, zoomLabel: zl };
    }

    // Build the diagram into a preview-body element: scaffold, then render the
    // root node only. Relationships load lazily when the user clicks a handle.
    function initTreeInto(body, rootPart, rootDesc, rootPhase) {
        const parts = buildTreeScaffold(body);
        const root = {
            isRoot: true, side: 'root', depth: 0,
            rel: {
                partNumber: rootPart, description: rootDesc, phase: rootPhase,
                classId: partContext.classId, objId: partContext.objId
            },
            parents: newGroup(), bom: newGroup(), x: 0, y: 0, sh: 0
        };
        treeView = {
            root: root, scroll: parts.scroll, sizer: parts.sizer,
            canvas: parts.canvas, zoomLabel: parts.zoomLabel,
            scale: 1, ox: null, oy: null, padL: 0, padT: 0, rendered: false, renderSeq: 0, lastW: 800, lastH: 600
        };

        // Big upfront loading animation while the hidden Agile frame boots and
        // the first level (Where-Used + BOM) is fetched. Nothing is drawn until
        // both sides resolve, so the user sees one clean loading phase instead
        // of a lone root box that then stalls on the first click. The overlay is
        // attached to the scroll viewport (which has real dimensions) so it
        // stays centred; the canvas has no size until the first render.
        parts.canvas.innerHTML = '';
        const loadingEl = document.createElement('div');
        loadingEl.className = 'parttree-loadingmsg';
        loadingEl.innerHTML = '<span class="preview-spinner"></span>' +
            '<span>Loading relationships for ' + escapeHtml(rootPart) + '\u2026</span>';
        parts.scroll.appendChild(loadingEl);

        root.bom.loading = true;
        root.parents.loading = true;

        const fillGroup = (group, fetcher) => {
            const childSide = group === 'bom' ? 'right' : 'left';
            return fetcher(partContext.classId, partContext.objId, 100).then(
                (rels) => {
                    if (treeView.root !== root) return;
                    const g = root[group];
                    g.loading = false; g.loaded = true; g.probed = true; g.expanded = true;
                    // True number of relations (grid total when known, else scraped).
                    const reported = (rels && typeof rels.gridTotal === 'number' && rels.gridTotal >= 0) ? rels.gridTotal : (rels ? rels.length : 0);
                    g.total = Math.max(reported, rels ? rels.length : 0);
                    const n = populateGroup(root, group, rels || [], childSide);
                    if (!n) { g.leaf = true; g.has = false; }
                    else { g.has = true; }
                    g.truncated = g.expanded && g.list.length < g.total && g.total > TRUNC_WARN_MIN;
                },
                (err) => {
                    if (treeView.root !== root) return;
                    const g = root[group];
                    g.loading = false; g.loaded = true; g.err = (err && err.message) || String(err);
                });
        };

        // Load both sides, THEN draw everything at once and centre on the root.
        // Parents first so the dedupe order is deterministic (a shared part is
        // shown as a parent rather than flipping per timing).
        fillGroup('parents', fetchParents)
            .then(() => fillGroup('bom', fetchChildren))
            .then(() => {
                if (treeView.root !== root) return;
                if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
                renderTree();
                setTimeout(centerOnRoot, 0);
            });
    }

    function openPartTree() {
        partContext = detectPartContext();
        const rootPart = getCurrentPartNumber();
        if (!rootPart) {
            alert('Open a part page first \u2014 no part number detected on this page.');
            return;
        }
        if (!partContext || !partContext.objId) {
            alert('Could not read this part\u2019s BOM / Where Used tabs from the page. ' +
                'Open the part\u2019s main object page and try again.');
            return;
        }
        const rootDesc = getCurrentPartDescription();
        const rootPhase = getCurrentPartPhase();

        // Reuse an existing (e.g. pinned) panel.
        const existingPanel = document.querySelector('.preview-panel');
        if (existingPanel) {
            const title = existingPanel.querySelector('.preview-header-title');
            if (title) title.textContent = 'Part Tree: ' + rootPart;
            const body = existingPanel.querySelector('.preview-body');
            if (body) { initTreeInto(body, rootPart, rootDesc, rootPhase); }
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
        title.textContent = 'Part Tree: ' + rootPart;
        const actions = document.createElement('div');
        actions.className = 'preview-header-actions';

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pin-btn';
        pinBtn.textContent = '\uD83D\uDCCC Pin';
        pinBtn.title = 'Keep panel open while you browse';
        pinBtn.addEventListener('click', () => {
            isPinned = !isPinned;
            pinBtn.classList.toggle('pinned', isPinned);
            pinBtn.textContent = isPinned ? '\uD83D\uDCCC Pinned' : '\uD83D\uDCCC Pin';
            if (isPinned) { overlay.style.display = 'none'; applyPageInset(panel.getBoundingClientRect().width); }
            else { overlay.style.display = ''; clearPageInset(); }
        });

        const shotBtn = document.createElement('button');
        shotBtn.className = 'pin-btn parttree-shot-btn';
        shotBtn.innerHTML = '\uD83D\uDCF7 Screenshot';
        shotBtn.title = 'Copy a full-tree screenshot to the clipboard';
        shotBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            captureTreeToClipboard(shotBtn);
        });

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715 Close';
        closeBtn.addEventListener('click', () => {
            isPinned = false; clearPageInset(); overlay.remove(); panel.remove();
        });

        actions.appendChild(pinBtn);
        actions.appendChild(shotBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'preview-body';

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        initTreeInto(body, rootPart, rootDesc, rootPhase);

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                isPinned = false; clearPageInset(); overlay.remove(); panel.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    // --- End-of-quarter FCO approval warning -------------------------------
    // The fiscal year is split into four calendar quarters, ending on the last
    // day of March (Q1), June (Q2), September (Q3) and December (Q4). During the
    // final month of each quarter, any FCO document requires Director approval,
    // so a small inline warning is shown next to the FCO number. It appears on
    // the 1st of the quarter-end month and clears once that quarter closes.
    const EOQ_QUARTER_END_MONTHS = { 2: 'Q1', 5: 'Q2', 8: 'Q3', 11: 'Q4' }; // 0-indexed month -> quarter

    // Whether *today* is inside a quarter-end month, plus the formatted last day
    // of that quarter. Computed once and cached (the date does not change within
    // a session), so the per-mutation banner check is a trivial lookup.
    let eoqWindowCache;
    function eoqInfo() {
        if (eoqWindowCache === undefined) {
            const now = new Date();
            const m = now.getMonth();
            const quarter = EOQ_QUARTER_END_MONTHS[m] || null;
            if (!quarter) {
                eoqWindowCache = null;
            } else {
                const lastDay = new Date(now.getFullYear(), m + 1, 0); // last day of this month
                const endDateStr = lastDay.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
                eoqWindowCache = { quarter: quarter, endDateStr: endDateStr };
            }
        }
        return eoqWindowCache;
    }

    function injectEoqFcoBanner() {
        // Cheap, cached check FIRST: outside a quarter-end month there is nothing
        // to do, so we never touch the DOM on the common path.
        const info = eoqInfo();
        if (!info) { document.querySelectorAll('.eoq-fco-fixed').forEach((n) => n.remove()); return; }
        if (!document.body || isAuthGatewayPage()) return;
        // Only on FCO documents that are currently in the "Pending" workflow
        // status (read from the lifecycle/status stamp, e.g. <h2>Pending</h2>).
        const part = getCurrentPartNumber();
        const statusEl = document.querySelector('.column_two h2');
        const status = statusEl ? (statusEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const eligible = !!part && /^FCO/i.test(part) && /pending/i.test(status);
        if (!eligible) {
            document.querySelectorAll('.eoq-fco-fixed').forEach((n) => n.remove());
            return;
        }
        // Already placed -> just keep it positioned (cheap) and bail.
        if (document.querySelector('.eoq-fco-fixed')) { layoutRightStack(); return; }
        const tip = 'End Of Quarter FCOs require Director approval\n\n'
            + 'Please answer these questions under "Reason Why Change is Needed" on the cover page.\n\n'
            + '\u2022 Is this FCO essential for EOQ or can this wait until next quarter? What is the impact if we wait?\n'
            + '\u2022 Has the code been validated, and is there any impact to other products?';
        const pill = document.createElement('span');
        pill.className = 'eoq-fco-fixed';
        pill.title = tip;
        pill.innerHTML =
            '<span class="eoq-warnicon">\u26a0</span> ' +
            '<span class="eoq-title">End of Quarter approaching ' + statusEscape(info.endDateStr) +
            ' \u2014 director approval will be required</span>';
        // Fixed pill placed to the LEFT of the Fireman Manual button (or in its
        // slot when that button is absent) by the shared right-stack layout.
        document.body.appendChild(pill);
        scheduleRightStackLayout();
    }

    function injectPartTreeButton() {
        const existing = document.querySelector('.parttree-btn');
        if (isAuthGatewayPage() || !document.body) {
            if (existing) existing.remove();
            return;
        }
        const part = getCurrentPartNumber();
        // Only show for real items. Change orders (part numbers that start with
        // "2", and FCO documents) have no BOM / Where-Used structure, so the tree
        // is meaningless there.
        const eligible = !!part && !/^2/.test(part) && !/^FCO/i.test(part);
        if (!eligible) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const btn = document.createElement('button');
        btn.className = 'parttree-btn';
        btn.type = 'button';
        btn.title = 'Show this part\u2019s BOM / Where-Used relationship tree';
        btn.innerHTML = TREE_ICON_SVG + '<span>Part Tree</span>';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPartTree();
        });
        document.body.appendChild(btn);
        scheduleRightStackLayout();
        log('Part Tree button injected');
    }

    // --- Init ---
    log('Initializing...');
    processLinks();
    processPartNumbers();
    processPerforcePaths();
    injectReferencePdfButton();
    // EXPERIMENTAL (shelved — broke Agile's TreeGrid): Current Status + Compare
    // Revs are disabled. Source stashed under experimental/. See EXPERIMENTAL_OFF.
    // injectStatusButton();
    // injectCompareRevsButton();
    injectPartTreeButton();
    injectEoqFcoBanner();

    // The background script messages us when a preview sub-frame is blocked
    // from being embedded (SSO/X-Frame-Options). Only then do we reveal the
    // sign-in footer for the currently open external preview.
    if (browser.runtime && browser.runtime.onMessage) {
        browser.runtime.onMessage.addListener((msg) => {
            if (msg && msg.type === 'preview_frame_blocked' && activeSignInNote) {
                activeSignInNote.classList.add('is-visible');
                const loader = document.querySelector('.preview-iframe-loader');
                if (loader) loader.remove();
            }
        });
    }

    if (document.body) {
        const observer = new MutationObserver((mutations) => {
            // Recolor any newly-added nodes when dark mode is active (cheap:
            // batched, and each element is processed at most once).
            if (darkActive) {
                for (let i = 0; i < mutations.length; i++) {
                    const added = mutations[i].addedNodes;
                    for (let j = 0; j < added.length; j++) {
                        if (added[j].nodeType === 1) scheduleDarken(added[j]);
                    }
                }
            }
            // Paused while we drive the page through revisions for a comparison,
            // so our button injections don't disturb settle detection.
            if (revCaptureInProgress) return;
            processLinks();
            processPartNumbers();
            processPerforcePaths();
            // injectStatusButton(); injectCompareRevsButton(); // EXPERIMENTAL — shelved
            injectPartTreeButton();
            injectEoqFcoBanner();
            layoutRightStack();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        log('MutationObserver attached');
    }

    setInterval(() => {
        if (revCaptureInProgress) return;
        processLinks(); processPartNumbers(); processPerforcePaths();
        // injectStatusButton(); injectCompareRevsButton(); // EXPERIMENTAL — shelved
        injectPartTreeButton();
        injectEoqFcoBanner();
        layoutRightStack();
    }, 3000);
    log('Init complete');
})();
