'use strict';
(() => {
  const A = window.webyApi;
  const $ = (id) => document.getElementById(id);
  let timer = null;

  async function load() {
    const items = await A.searchHistory($('q').value);
    const list = $('list');
    list.textContent = '';
    $('empty').hidden = items.length > 0;
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'item';
      const t = document.createElement('div');
      t.className = 't';
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = it.title || it.url;
      a.addEventListener('click', (e) => { e.preventDefault(); A.open(it.url); });
      const s = document.createElement('small');
      s.textContent = it.url;
      t.append(a, s);
      const time = document.createElement('time');
      time.textContent = new Date(it.time).toLocaleString();
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Remove';
      del.addEventListener('click', async () => { await A.removeHistory(it.time, it.url); load(); });
      row.append(t, time, del);
      list.appendChild(row);
    }
  }

  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 150); });
  $('clr').addEventListener('click', async () => { await A.clearAll(); load(); });
  load();
})();
