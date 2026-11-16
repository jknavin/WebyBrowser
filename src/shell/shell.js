'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const W = window.weby;
  const TOP = 82;
  const FIND_H = 38;
  const PANEL_W = 300;

  let state = { tabs: [], activeId: null, nav: {}, totalBlocked: 0 };
  let settings = null;
  let findOpen = false;
  let ytOpen = false;
  let toastTimer = null;

  const act = (name, arg) => W.action(name, arg);

  function sendLayout() {
    W.layout({ top: TOP + (findOpen ? FIND_H : 0), right: ytOpen ? PANEL_W : 0 });
    $('findbar').hidden = !findOpen;
    $('ytpanel').hidden = !ytOpen;
    $('ytpanel').style.top = TOP + (findOpen ? FIND_H : 0) + 'px';
    $('ytbtn').classList.toggle('active', ytOpen);
  }

  function showHost(url) {
    if (!url || url.startsWith('weby://')) return '';
    return url;
  }

  function renderTabs() {
    const wrap = $('tabs');
    wrap.textContent = '';
    for (const t of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === state.activeId ? ' on' : '');
      el.title = t.title;
      if (t.loading) {
        const d = document.createElement('span'); d.className = 'dot'; el.appendChild(d);
      } else if (t.favicon && /^https?:|^data:/.test(t.favicon)) {
        const i = document.createElement('img'); i.src = t.favicon; i.alt = ''; i.onerror = () => i.remove(); el.appendChild(i);
      }
      const title = document.createElement('span'); title.className = 'title'; title.textContent = t.title || 'New Tab'; el.appendChild(title);
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close tab');
      x.addEventListener('click', (e) => { e.stopPropagation(); act('closeTab', t.id); });
      el.appendChild(x);
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); act('closeTab', t.id); }
        else if (e.button === 0) act('activate', t.id);
      });
      wrap.appendChild(el);
    }
  }

  function render() {
    renderTabs();
    const a = state.tabs.find((t) => t.id === state.activeId);
    $('back').disabled = !state.nav.canBack;
    $('forward').disabled = !state.nav.canForward;
    $('reload').textContent = a && a.loading ? '✕' : '⟳';
    $('reload').title = a && a.loading ? 'Stop' : 'Reload (Ctrl+R)';
    $('blocked').textContent = a ? a.blocked : 0;
    $('shield').title = `Blocked on this page: ${a ? a.blocked : 0}. Total this session: ${state.totalBlocked}`;
    const url = a ? a.url : '';
    if (document.activeElement !== $('url')) $('url').value = showHost(url);
    const secure = /^https:/i.test(url);
    $('lock').textContent = url.startsWith('weby://') ? '' : secure ? '🔒' : '⚠';
    $('lock').className = secure ? 'secure' : '';
    document.title = a && a.title ? `${a.title} — Weby` : 'Weby Browser';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function renderYt() {
    if (!settings) return;
    document.querySelectorAll('[data-yt]').forEach((c) => { c.checked = !!settings.youtube[c.dataset.yt]; });
  }

  // ----- events -----
  $('back').addEventListener('click', () => act('back'));
  $('forward').addEventListener('click', () => act('forward'));
  $('home').addEventListener('click', () => act('home'));
  $('reload').addEventListener('click', () => {
    const a = state.tabs.find((t) => t.id === state.activeId);
    act(a && a.loading ? 'stop' : 'reload');
  });
  $('newtab').addEventListener('click', () => act('newTab'));
  $('printbtn').addEventListener('click', () => act('print'));
  $('menu').addEventListener('click', () => act('menu'));
  $('shield').addEventListener('click', () => toast(`Blocked ${state.totalBlocked} ads & trackers this session`));
  $('clearall').addEventListener('click', async () => {
    await act('clearAll');
  });

  $('url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { act('navigate', $('url').value); $('url').blur(); }
    else if (e.key === 'Escape') { $('url').blur(); render(); }
  });
  $('url').addEventListener('focus', () => $('url').select());

  // find bar
  function openFind() { findOpen = true; sendLayout(); $('findinput').focus(); $('findinput').select(); }
  function closeFind() { findOpen = false; act('stopFind'); sendLayout(); }
  $('findinput').addEventListener('input', () => act('find', { text: $('findinput').value }));
  $('findinput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') act('find', { text: $('findinput').value, next: true, backward: e.shiftKey });
    else if (e.key === 'Escape') closeFind();
  });
  $('findnext').addEventListener('click', () => act('find', { text: $('findinput').value, next: true }));
  $('findprev').addEventListener('click', () => act('find', { text: $('findinput').value, next: true, backward: true }));
  $('findclose').addEventListener('click', closeFind);

  // youtube panel
  $('ytbtn').addEventListener('click', () => { ytOpen = !ytOpen; sendLayout(); });
  $('ytclose').addEventListener('click', () => { ytOpen = false; sendLayout(); });
  document.querySelectorAll('[data-yt]').forEach((c) => {
    c.addEventListener('change', async () => {
      settings = await W.updateSettings({ youtube: { [c.dataset.yt]: c.checked } });
      renderYt();
    });
  });
  $('ytfocus').addEventListener('click', async () => {
    settings = await W.updateSettings({
      youtube: { hideShorts: true, hideHomeFeed: true, hideRelated: true, hideComments: true, hideEndCards: true, hideExplore: true, noAutoplay: true, grayscale: false },
    });
    renderYt();
    toast('Focus mode on');
  });

  W.onState((s) => { state = s; render(); });
  W.onFocusUrl(() => { $('url').focus(); $('url').select(); });
  W.onToast(toast);
  W.onOpenPanel((p) => {
    if (p === 'find') openFind();
    else if (p === 'youtube') { ytOpen = !ytOpen; sendLayout(); }
    else if (p === 'closeFind') closeFind();
  });

  W.getSettings().then((s) => { settings = s; renderYt(); });
  sendLayout();
})();
