// popup.js — Settings UI for the Agile PLM Inline Preview toolbar button.
// Each toggle enables/disables one of the buttons the extension injects onto
// Agile pages. Settings are stored in browser.storage.local and read live by
// content-main.js (which hides disabled buttons via CSS).

(function () {
  'use strict';

  // Cross-browser storage handle (Firefox: browser, Chromium: chrome).
  const api = (typeof browser !== 'undefined') ? browser : chrome;

  // The button toggles, in display order. `key` matches the keys content-main.js
  // reads from storage. Defaults are all enabled (true).
  const BUTTONS = [
    { key: 'showCopy',      name: 'Copy',        desc: 'Copy the part number' },
    { key: 'showEcho',      name: 'ECHO',        desc: 'Open part in ECHO' },
    { key: 'showMvdb',      name: 'MVDB',        desc: 'Open part in MVDB' },
    { key: 'showBlueNITE',  name: 'BlueNITE',    desc: 'Search part in BlueNITE' },
    { key: 'showAzure',     name: 'Azure',       desc: 'Search part in Azure DevOps' },
    { key: 'showHWT',       name: 'HWT',         desc: 'Open part in HWT Config Creator' },
    { key: 'showP4v',       name: 'p4v',         desc: 'Open Perforce path in P4V' },
    { key: 'showP4Browser', name: 'P4 Browser',  desc: 'Open Perforce path in browser' },
    { key: 'showFireman',   name: 'Fireman Manual', desc: 'Open the reference PDF' },
    { key: 'showStatus',    name: 'Current Status', desc: 'Aggregate MVDB + Azure status' },
    { key: 'showTree',      name: 'Part Tree',      desc: 'BOM / Where-Used relationship tree' }
  ];

  const STORAGE_KEY = 'previewButtonSettings';

  function defaults() {
    const d = {};
    BUTTONS.forEach((b) => { d[b.key] = true; });
    return d;
  }

  function loadSettings() {
    return api.storage.local.get(STORAGE_KEY).then((res) => {
      const stored = (res && res[STORAGE_KEY]) || {};
      return Object.assign(defaults(), stored);
    });
  }

  function saveSettings(settings) {
    return api.storage.local.set({ [STORAGE_KEY]: settings });
  }

  function render(settings) {
    const list = document.getElementById('list');
    list.innerHTML = '';
    BUTTONS.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'row';

      const label = document.createElement('div');
      label.className = 'label';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = b.name;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = b.desc;
      label.appendChild(name);
      label.appendChild(desc);

      const sw = document.createElement('label');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings[b.key] !== false;
      input.addEventListener('change', () => {
        settings[b.key] = input.checked;
        saveSettings(settings);
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      sw.appendChild(input);
      sw.appendChild(slider);

      row.appendChild(label);
      row.appendChild(sw);
      list.appendChild(row);
    });
  }

  function setAll(value) {
    loadSettings().then((settings) => {
      BUTTONS.forEach((b) => { settings[b.key] = value; });
      saveSettings(settings).then(() => render(settings));
    });
  }

  document.getElementById('enableAll').addEventListener('click', () => setAll(true));
  document.getElementById('disableAll').addEventListener('click', () => setAll(false));

  loadSettings().then(render);

  // --- HWT Config Creator endpoints ---
  // Local is fixed (localhost, auto-started by the extension); only the
  // machine-specific Network / External URLs are stored here. content-main.js
  // reads this object live and shows a menu item for each non-empty URL.
  const HWT_URLS_KEY = 'hwtUrls';
  const netInput = document.getElementById('hwtNetwork');
  const extInput = document.getElementById('hwtExternal');

  api.storage.local.get(HWT_URLS_KEY).then((res) => {
    const cfg = (res && res[HWT_URLS_KEY]) || {};
    netInput.value = cfg.network || '';
    extInput.value = cfg.external || '';
  }).catch(() => { /* storage unavailable */ });

  let hwtSaveTimer = null;
  function saveHwtUrls() {
    clearTimeout(hwtSaveTimer);
    hwtSaveTimer = setTimeout(() => {
      api.storage.local.set({
        [HWT_URLS_KEY]: {
          network: netInput.value.trim(),
          external: extInput.value.trim()
        }
      });
    }, 350);
  }
  netInput.addEventListener('input', saveHwtUrls);
  extInput.addEventListener('input', saveHwtUrls);

  // --- Appearance / dark mode ---
  // 'themeMode' = 'auto' | 'light' | 'dark'. content-main.js reads the same key
  // and themes the Agile pages + injected panels live.
  const THEME_KEY = 'themeMode';
  const darkMql = window.matchMedia('(prefers-color-scheme: dark)');
  let themeMode = 'light';

  function applyPopupTheme(mode) {
    themeMode = mode || 'light';
    const dark = themeMode === 'dark' || (themeMode === 'auto' && darkMql.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('#themeSeg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === themeMode);
    });
  }

  api.storage.local.get(THEME_KEY).then((res) => {
    applyPopupTheme(res && res[THEME_KEY]);
  }).catch(() => applyPopupTheme('light'));

  document.getElementById('themeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    applyPopupTheme(btn.dataset.mode);
    api.storage.local.set({ [THEME_KEY]: themeMode });
  });

  darkMql.addEventListener('change', () => {
    if (themeMode === 'auto') applyPopupTheme('auto');
  });
})();
