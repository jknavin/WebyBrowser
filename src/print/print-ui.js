'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.webyPrint;
  const HINTS = {
    original: 'Prints the page exactly as it looks on screen.',
    clean: 'Removes menus, sidebars, popups and ads, and keeps the main content.',
    reader: 'Article only, in a clean serif layout. Best for reading and saving paper.',
  };
  let layout = 'clean';
  let timer = null;
  let seq = 0;

  function opts() {
    return {
      layout,
      printer: $('printer').value,
      systemDialog: $('systemDialog').checked,
      paper: $('paper').value,
      landscape: $('landscape').value === '1',
      margins: $('margins').value,
      scale: Number($('scale').value) || 100,
      pageRanges: $('pageRanges').value,
      copies: Number($('copies').value) || 1,
      duplex: $('duplex').value,
      inkSaver: $('inkSaver').checked,
      noImages: $('noImages').checked,
      color: $('color').checked,
      background: $('background').checked,
      showLinks: $('showLinks').checked,
      headerFooter: $('headerFooter').checked,
    };
  }

  function status(msg, cls) {
    const s = $('status');
    s.textContent = msg || '';
    s.className = 'status' + (cls ? ' ' + cls : '');
  }

  async function refresh() {
    const mine = ++seq;
    $('busy').classList.add('show');
    const r = await P.preview(opts());
    if (mine !== seq) return; // a newer request superseded this one
    $('busy').classList.remove('show');
    if (!r || !r.ok) {
      $('pages').textContent = 'Preview failed';
      status((r && r.error) || 'Could not build preview', 'bad');
      return;
    }
    status('');
    $('pages').textContent = r.pages ? `${r.pages} page${r.pages === 1 ? '' : 's'}` : 'Preview ready';
    $('pdf').src = `weby://preview/doc.pdf?v=${r.version}#toolbar=0&navpanes=0&view=FitH`;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 350);
  }

  async function busyAction(btn, fn) {
    const all = document.querySelectorAll('.actions button');
    all.forEach((b) => { b.disabled = true; });
    status('Working…');
    try { await fn(); } finally { all.forEach((b) => { b.disabled = false; }); }
  }

  async function init() {
    const info = await P.init();
    if (!info) { status('Print is unavailable', 'bad'); return; }
    $('doc-title').textContent = info.title || info.url;
    for (const p of info.papers) {
      const o = document.createElement('option');
      o.value = o.textContent = p;
      $('paper').appendChild(o);
    }
    for (const p of info.printers) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.display + (p.isDefault ? ' (default)' : '');
      $('printer').appendChild(o);
    }
    refresh();
  }

  document.querySelectorAll('#layout button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#layout button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      layout = b.dataset.v;
      $('layout-hint').textContent = HINTS[layout];
      schedule();
    });
  });

  for (const id of ['paper', 'landscape', 'margins', 'scale', 'pageRanges', 'inkSaver', 'noImages', 'background', 'showLinks', 'headerFooter']) {
    $(id).addEventListener(id === 'scale' || id === 'pageRanges' ? 'input' : 'change', schedule);
  }

  $('btn-print').addEventListener('click', (e) => busyAction(e.currentTarget, async () => {
    const r = await P.print(opts());
    if (r && r.ok) { status('Sent to printer', 'ok'); setTimeout(() => P.close(), 700); }
    else status((r && r.error) ? `Print failed: ${r.error}` : 'Print cancelled', 'bad');
  }));

  $('btn-save').addEventListener('click', (e) => busyAction(e.currentTarget, async () => {
    const r = await P.save(opts());
    if (r && r.ok) status('Saved PDF', 'ok');
    else if (r && r.canceled) status('');
    else status((r && r.error) || 'Could not save PDF', 'bad');
  }));

  $('btn-cancel').addEventListener('click', () => P.close());
  init();
})();
