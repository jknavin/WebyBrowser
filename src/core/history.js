'use strict';
// Local browsing history. Stored only on this machine, wiped by "Clear everything".
const fs = require('fs');
const path = require('path');

const MAX = 3000;
let items = [];
let file = '';
let timer = null;
let enabled = () => true;

function init(dir, isEnabled) {
  file = path.join(dir, 'history.json');
  enabled = isEnabled;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    items = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    items = [];
  }
}

function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!enabled()) return;
    try { fs.writeFileSync(file, JSON.stringify(items)); } catch (_) { /* ignore */ }
  }, 800);
}

function add(url, title) {
  if (!enabled()) return;
  if (items[0] && items[0].url === url) {
    items[0].time = Date.now();
  } else {
    items.unshift({ url, title: title || url, time: Date.now() });
  }
  if (items.length > MAX) items.length = MAX;
  persist();
}

function setTitle(url, title) {
  if (!enabled() || !title) return;
  const it = items.slice(0, 20).find((i) => i.url === url);
  if (it) { it.title = title; persist(); }
}

function search(q) {
  q = String(q || '').toLowerCase().trim();
  const list = q
    ? items.filter((i) => i.url.toLowerCase().includes(q) || String(i.title).toLowerCase().includes(q))
    : items;
  return list.slice(0, 300);
}

function remove(time, url) {
  items = items.filter((i) => !(i.time === time && i.url === url));
  persist();
}

function clear() {
  items = [];
  clearTimeout(timer);
  try { fs.rmSync(file, { force: true }); } catch (_) { /* ignore */ }
}

module.exports = { init, add, setTitle, search, remove, clear };
