'use strict';
(async () => {
  const A = window.webyApi;
  const $ = (id) => document.getElementById(id);
  const NAMES = { duckduckgo: 'DuckDuckGo', startpage: 'Startpage', brave: 'Brave Search', mojeek: 'Mojeek' };
  $('f').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('q').value.trim();
    if (v) A.open(v);
  });
  $('hist').addEventListener('click', () => A.open('weby://history/'));
  $('set').addEventListener('click', () => A.open('weby://settings/'));
  $('clr').addEventListener('click', async () => { await A.clearAll(); $('blocked').textContent = '0'; });
  const s = await A.getSettings();
  $('engine').textContent = NAMES[s.searchEngine] || s.searchEngine;
  const st = await A.stats();
  $('blocked').textContent = String(st.blocked);
})();
