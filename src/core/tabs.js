'use strict';
// Tab manager: one WebContentsView per tab, laid out under the shell UI.
const { WebContentsView, shell } = require('electron');
const path = require('path');
const blocker = require('./blocker');
const history = require('./history');
const privacy = require('./privacy');
const yt = require('./youtube');

const PAGE_PRELOAD = path.join(__dirname, '..', 'shell', 'page-preload.js');
const HOME = 'weby://home/';

let win = null;
let ses = null;
let settings = null;
let onFocusUrlBar = () => {};
let onPopup = () => {};
let tabs = []; // { id, view, title, url, loading, favicon, fullscreen, ytCss }
let activeId = null;
let nextId = 1;
let layout = { top: 82, right: 0 };
let pushTimer = null;

function init(opts) {
  win = opts.win;
  ses = opts.ses;
  settings = opts.settings;
  onFocusUrlBar = opts.onFocusUrlBar || onFocusUrlBar;
  win.on('resize', applyBounds);
  win.on('maximize', applyBounds);
  win.on('unmaximize', applyBounds);
  win.on('enter-full-screen', applyBounds);
  win.on('leave-full-screen', applyBounds);
}

// ---------- input -> URL ----------
function resolveInput(text) {
  text = String(text || '').trim();
  if (!text) return HOME;
  if (/^weby:\/\//i.test(text)) return text;
  if (/^(https?):\/\//i.test(text)) return text;
  if (/^(file|javascript|data|vbscript|blob|chrome|devtools|view-source):/i.test(text)) {
    return settings.searchUrl(text);
  }
  if (!/\s/.test(text) && (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text))) {
    return 'http://' + text;
  }
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return 'https://' + text;
  return settings.searchUrl(text);
}

// ---------- layout ----------
function applyBounds() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  for (const t of tabs) {
    if (t.fullscreen) t.view.setBounds({ x: 0, y: 0, width: w, height: h });
    else {
      t.view.setBounds({
        x: 0,
        y: layout.top,
        width: Math.max(0, w - layout.right),
        height: Math.max(0, h - layout.top),
      });
    }
  }
}

function setLayout(l) {
  layout = {
    top: Math.max(0, Math.round(Number(l && l.top) || 82)),
    right: Math.max(0, Math.round(Number(l && l.right) || 0)),
  };
  applyBounds();
}

// ---------- state push to shell ----------
function snapshot() {
  const a = get(activeId);
  return {
    activeId,
    tabs: tabs.map((t) => {
      const wc = t.view.webContents;
      return {
        id: t.id,
        title: t.title || 'New Tab',
        url: t.url,
        loading: t.loading,
        favicon: t.favicon || '',
        blocked: blocker.count(wc.id),
        youtube: yt.isYouTube(t.url),
      };
    }),
    nav: a
      ? {
          canBack: a.view.webContents.navigationHistory.canGoBack(),
          canForward: a.view.webContents.navigationHistory.canGoForward(),
          zoom: Math.round(a.view.webContents.getZoomFactor() * 100),
        }
      : { canBack: false, canForward: false, zoom: 100 },
    totalBlocked: blocker.total(),
  };
}

function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('state', snapshot());
  }, 40);
}

// ---------- lookup ----------
function get(id) { return tabs.find((t) => t.id === id) || null; }
function active() { return get(activeId); }

// ---------- YouTube / cosmetic injection ----------
async function applyInjections(t) {
  const wc = t.view.webContents;
  if (wc.isDestroyed()) return;
  const url = wc.getURL();
  if (url.startsWith('weby://')) return;
  try {
    if (t.ytCss) { try { await wc.removeInsertedCSS(t.ytCss); } catch (_) { /* gone */ } t.ytCss = null; }
    if (yt.isYouTube(url)) {
      const o = settings.get().youtube;
      t.ytCss = await wc.insertCSS(yt.css(o));
      await wc.executeJavaScript(`window.__webyOpts=${JSON.stringify(o)};`);
      await wc.executeJavaScript(yt.script(o));
    }
    if (!t.cosmetic) t.cosmetic = true;
    await wc.insertCSS(blocker.cosmeticCSS);
  } catch (_) { /* page navigated away */ }
}

function reapplyYouTube() {
  for (const t of tabs) if (yt.isYouTube(t.url)) applyInjections(t);
}

// ---------- create / close ----------
function create(input, opts) {
  const o = opts || {};
  const url = privacy.upgrade(resolveInput(input), settings);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload: PAGE_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  const t = { id: nextId++, view, title: '', url, loading: false, favicon: '', fullscreen: false, ytCss: null };
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.setVisualZoomLevelLimits(1, 3).catch(() => {});

  wc.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:|^weby:/i.test(u)) create(u, { activate: true, after: t.id });
    return { action: 'deny' };
  });

  wc.on('page-title-updated', (_e, title) => { t.title = title; history.setTitle(t.url, title); push(); });
  wc.on('page-favicon-updated', (_e, favs) => { t.favicon = favs[0] || ''; push(); });
  wc.on('did-start-loading', () => { t.loading = true; push(); });
  wc.on('did-stop-loading', () => { t.loading = false; push(); });
  wc.on('did-start-navigation', (_e, u, _inPlace, isMain) => { if (isMain) blocker.resetTab(wc.id); });
  const onNav = (_e, u, _a, _b) => {
    t.url = wc.getURL() || u;
    if (!t.url.startsWith('weby://') && /^https?:/i.test(t.url)) history.add(t.url, wc.getTitle());
    push();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', (e, u, isMain) => { if (isMain) onNav(e, u); applyInjections(t); });
  wc.on('dom-ready', () => applyInjections(t));
  wc.on('did-finish-load', () => { applyInjections(t); push(); });

  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return; // -3 = aborted
    const q = new URLSearchParams({ code: String(code), desc, url: failedUrl });
    wc.loadURL('weby://error/?' + q.toString()).catch(() => {});
  });
  // Re-try HTTP if HTTPS-first upgrade failed on a plain-http site? No: stay strict, show the error page.

  wc.on('will-navigate', (e, u) => {
    if (/^(file|javascript|data|vbscript|chrome|devtools):/i.test(u)) e.preventDefault();
  });
  wc.on('enter-html-full-screen', () => { t.fullscreen = true; win.setFullScreen(true); applyBounds(); });
  wc.on('leave-html-full-screen', () => { t.fullscreen = false; win.setFullScreen(false); applyBounds(); });
  wc.on('context-menu', (_e, params) => onContext(t, params));
  wc.on('zoom-changed', push);
  wc.on('before-input-event', (e, input) => { if (handleKey(e, input)) e.preventDefault(); });
  wc.on('render-process-gone', () => { t.title = 'Page crashed'; push(); });

  // insert after a given tab or at the end
  const idx = o.after ? tabs.findIndex((x) => x.id === o.after) + 1 : tabs.length;
  tabs.splice(idx > 0 ? idx : tabs.length, 0, t);
  win.contentView.addChildView(view);
  view.setVisible(false);
  applyBounds();
  wc.loadURL(url).catch(() => {});
  if (o.activate !== false) activate(t.id);
  push();
  return t.id;
}

function activate(id) {
  const t = get(id);
  if (!t) return;
  activeId = id;
  for (const x of tabs) x.view.setVisible(x.id === id);
  // keep active on top
  win.contentView.addChildView(t.view);
  applyBounds();
  if (!t.view.webContents.isDestroyed()) {
    if (t.url === HOME || t.url === '' || t.url === 'about:blank') onFocusUrlBar();
    else t.view.webContents.focus();
  }
  push();
}

function close(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  try { win.contentView.removeChildView(t.view); } catch (_) { /* ignore */ }
  try { if (!t.view.webContents.isDestroyed()) t.view.webContents.close(); } catch (_) { /* ignore */ }
  if (!tabs.length) {
    create(HOME);
    return;
  }
  if (activeId === id) activate(tabs[Math.min(i, tabs.length - 1)].id);
  else push();
}

function closeAll(keepHome) {
  for (const t of [...tabs]) {
    try { win.contentView.removeChildView(t.view); } catch (_) { /* ignore */ }
    try { if (!t.view.webContents.isDestroyed()) t.view.webContents.close(); } catch (_) { /* ignore */ }
  }
  tabs = [];
  activeId = null;
  if (keepHome) create(HOME);
}

function cycle(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

function navigate(id, input) {
  const t = get(id || activeId);
  if (!t) return;
  const url = privacy.upgrade(resolveInput(input), settings);
  t.url = url;
  t.view.webContents.loadURL(url).catch(() => {});
  t.view.webContents.focus();
  push();
}

function withActive(fn) {
  const t = active();
  if (t && !t.view.webContents.isDestroyed()) fn(t.view.webContents, t);
}

const actions = {
  back: () => withActive((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()),
  forward: () => withActive((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()),
  reload: () => withActive((wc) => wc.reload()),
  hardReload: () => withActive((wc) => wc.reloadIgnoringCache()),
  stop: () => withActive((wc) => wc.stop()),
  home: () => navigate(activeId, HOME),
  zoomIn: () => withActive((wc) => { wc.setZoomFactor(Math.min(3, wc.getZoomFactor() + 0.1)); push(); }),
  zoomOut: () => withActive((wc) => { wc.setZoomFactor(Math.max(0.3, wc.getZoomFactor() - 0.1)); push(); }),
  zoomReset: () => withActive((wc) => { wc.setZoomFactor(1); push(); }),
  find: (text, opts) => withActive((wc) => {
    if (!text) return wc.stopFindInPage('clearSelection');
    wc.findInPage(text, { forward: !(opts && opts.backward), findNext: !!(opts && opts.next) });
  }),
  stopFind: () => withActive((wc) => wc.stopFindInPage('clearSelection')),
};

// ---------- keyboard shortcuts (shared with shell) ----------
let keyHandler = () => false;
function setKeyHandler(fn) { keyHandler = fn; }
function handleKey(_e, input) { return keyHandler(input); }

// ---------- context menu ----------
const { Menu } = require('electron');
function onContext(t, p) {
  const wc = t.view.webContents;
  const items = [];
  if (p.linkURL) {
    items.push({ label: 'Open link in new tab', click: () => create(p.linkURL, { activate: false, after: t.id }) });
    items.push({ label: 'Copy link address', click: () => require('electron').clipboard.writeText(blocker.cleanUrl(p.linkURL)) });
    items.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Open image in new tab', click: () => create(p.srcURL, { activate: true, after: t.id }) });
    items.push({ label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) });
    items.push({ type: 'separator' });
  }
  if (p.selectionText) {
    items.push({ role: 'copy' });
    const s = p.selectionText.trim().slice(0, 40);
    items.push({ label: `Search for “${s}”`, click: () => create(settings.searchUrl(p.selectionText.trim()), { activate: true, after: t.id }) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
  }
  items.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: actions.back },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: actions.forward },
    { label: 'Reload', click: actions.reload },
    { type: 'separator' },
    { label: 'Print…  (Ctrl+P)', click: () => require('../print/print').open(win, t.view.webContents) },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

module.exports = {
  init, create, activate, close, closeAll, cycle, navigate, setLayout, applyBounds,
  get, active, snapshot, push, actions, resolveInput, reapplyYouTube, setKeyHandler,
  byWebContents: (wc) => tabs.find((t) => t.view.webContents === wc) || null,
  list: () => tabs.map((t) => t.id),
  openExternal: shell.openExternal,
};
