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
    { key: 'showP4v',       name: 'p4v',         desc: 'Open Perforce path in P4V' },
    { key: 'showP4Browser', name: 'P4 Browser',  desc: 'Open Perforce path in browser' },
    { key: 'showFireman',   name: 'Fireman Manual', desc: 'Open the reference PDF' }
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
})();
