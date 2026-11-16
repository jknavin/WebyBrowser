'use strict';
// Local-only settings. Nothing here is ever sent anywhere.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  searchEngine: 'duckduckgo',
  httpsOnly: true,
  blockThirdPartyCookies: true,
  stripTrackingParams: true,
  secureDns: true,
  saveHistory: true,
  ramOnly: false,
  clearOnExit: false,
  youtube: {
    hideShorts: true,
    hideHomeFeed: false,
    hideRelated: false,
    hideComments: false,
    hideEndCards: true,
    hideExplore: false,
    noAutoplay: true,
    grayscale: false,
  },
};

const SEARCH = {
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  startpage: 'https://www.startpage.com/do/search?q=%s',
  brave: 'https://search.brave.com/search?q=%s',
  mojeek: 'https://www.mojeek.com/search?q=%s',
};

let data = JSON.parse(JSON.stringify(DEFAULTS));
let file = '';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Keep only known keys that have the right type; fill gaps from defaults.
function normalize(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const o = isObj(over) ? over[k] : undefined;
    out[k] = isObj(b) ? normalize(b, o) : typeof o === typeof b ? o : b;
  }
  return out;
}

function overlay(a, b) {
  const out = { ...a };
  if (!isObj(b)) return out;
  for (const k of Object.keys(b)) {
    out[k] = isObj(a[k]) && isObj(b[k]) ? overlay(a[k], b[k]) : b[k];
  }
  return out;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (_) { /* best effort */ }
}

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    data = normalize(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    data = normalize(DEFAULTS, {});
  }
  if (!SEARCH[data.searchEngine]) data.searchEngine = 'duckduckgo';
  return data;
}

function get() { return data; }

function update(patch) {
  data = normalize(DEFAULTS, overlay(data, patch));
  if (!SEARCH[data.searchEngine]) data.searchEngine = 'duckduckgo';
  save();
  return data;
}

function searchUrl(q) {
  return SEARCH[data.searchEngine].replace('%s', encodeURIComponent(q));
}

module.exports = { load, get, update, searchUrl, SEARCH };
