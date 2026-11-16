'use strict';
const { app, BrowserWindow, Menu, ipcMain, protocol, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Portable build: keep every byte of data next to the .exe, not in AppData.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'WebyData'));
}

// Hardening switches (must be set before ready).
app.commandLine.appendSwitch('disable-features', 'Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions,AutofillServerCommunication,PrivacySandboxSettings4');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-domain-reliability');

protocol.registerSchemesAsPrivileged([
  { scheme: 'weby', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const settings = require('./src/core/settings');
const history = require('./src/core/history');
const blocker = require('./src/core/blocker');
const privacy = require('./src/core/privacy');
const tabs = require('./src/core/tabs');
const printer = require('./src/print/print');

const SRC = path.join(__dirname, 'src');
const PAGES = path.join(SRC, 'pages');
const PRINT = path.join(SRC, 'print');
const PAGE_HOSTS = new Set(['home', 'history', 'settings', 'error']);
const PRINT_FILES = new Set(['print.html', 'print.css', 'print-ui.js']);
const PAGE_EXT = new Set(['.html', '.css', '.js']);

let win = null;
let ses = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const url = argv.find((a) => /^https?:\/\//i.test(a));
    if (url && tabs) tabs.create(url);
  });
}

// ---------- weby:// protocol ----------
function serve(req) {
  let u;
  try { u = new URL(req.url); } catch (_) { return new Response('Bad request', { status: 400 }); }
  if (u.hostname === 'preview') {
    const buf = printer.getPreview();
    if (!buf) return new Response('No preview', { status: 404 });
    return new Response(buf, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  }
  let root, file;
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (u.hostname === 'print') {
    root = PRINT;
    file = rel || 'print.html';
    if (!PRINT_FILES.has(file)) return new Response('Not found', { status: 404 });
  } else if (PAGE_HOSTS.has(u.hostname)) {
    root = PAGES;
    file = rel || u.hostname + '.html';
    if (!PAGE_EXT.has(path.extname(file))) return new Response('Not found', { status: 404 });
  } else {
    return new Response('Not found', { status: 404 });
  }
  const full = path.normalize(path.join(root, file));
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(full).toString());
}

// ---------- clear everything ----------
let clearing = false;
async function clearAll() {
  if (clearing) return;
  clearing = true;
  try {
    tabs.closeAll(false);
    await privacy.clearEverything(ses);
    tabs.create('weby://home/');
    send('toast', 'Everything cleared');
  } finally {
    clearing = false;
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- keyboard ----------
function handleKey(input) {
  if (input.type !== 'keyDown') return false;
  const ctrl = input.control || input.meta;
  const k = (input.key || '').toLowerCase();
  const a = tabs.actions;
  if (ctrl && !input.shift && !input.alt) {
    if (k === 't') { tabs.create('weby://home/'); return true; }
    if (k === 'w') { const t = tabs.active(); if (t) tabs.close(t.id); return true; }
    if (k === 'l') { send('focus-url'); return true; }
    if (k === 'r') { a.reload(); return true; }
    if (k === 'p') { openPrint(); return true; }
    if (k === 'f') { send('open-panel', 'find'); return true; }
    if (k === 'h') { tabs.create('weby://history/'); return true; }
    if (k === 'tab') { tabs.cycle(1); return true; }
    if (k === '=' || k === '+') { a.zoomIn(); return true; }
    if (k === '-') { a.zoomOut(); return true; }
    if (k === '0') { a.zoomReset(); return true; }
    if (/^[1-9]$/.test(k)) {
      const ids = tabs.list();
      const id = k === '9' ? ids[ids.length - 1] : ids[Number(k) - 1];
      if (id) tabs.activate(id);
      return true;
    }
  }
  if (ctrl && input.shift && !input.alt) {
    if (k === 'tab') { tabs.cycle(-1); return true; }
    if (k === 'r') { a.hardReload(); return true; }
    if (k === 'delete') { clearAll(); return true; }
    if (k === 'y') { send('open-panel', 'youtube'); return true; }
    if (k === '+') { a.zoomIn(); return true; }
  }
  if (input.alt && !ctrl) {
    if (k === 'arrowleft') { a.back(); return true; }
    if (k === 'arrowright') { a.forward(); return true; }
    if (k === 'd') { send('focus-url'); return true; }
    if (k === 'home') { a.home(); return true; }
  }
  if (!ctrl && !input.alt && !input.shift) {
    if (k === 'f5') { a.reload(); return true; }
    if (k === 'f6') { send('focus-url'); return true; }
    if (k === 'f11') { win.setFullScreen(!win.isFullScreen()); return true; }
    if (k === 'escape') { send('open-panel', 'closeFind'); return false; }
  }
  return false;
}

function openPrint() {
  const t = tabs.active();
  if (t) printer.open(win, t.view.webContents);
}

// ---------- menu ----------
function showMenu() {
  const a = tabs.actions;
  Menu.buildFromTemplate([
    { label: 'New tab', accelerator: 'Ctrl+T', click: () => tabs.create('weby://home/') },
    { label: 'History', accelerator: 'Ctrl+H', click: () => tabs.create('weby://history/') },
    { label: 'Settings', click: () => tabs.create('weby://settings/') },
    { type: 'separator' },
    { label: 'Print…', accelerator: 'Ctrl+P', click: openPrint },
    { label: 'Find in page', accelerator: 'Ctrl+F', click: () => send('open-panel', 'find') },
    { label: 'YouTube focus tool', accelerator: 'Ctrl+Shift+Y', click: () => send('open-panel', 'youtube') },
    { type: 'separator' },
    { label: 'Zoom in', click: a.zoomIn },
    { label: 'Zoom out', click: a.zoomOut },
    { label: 'Reset zoom', click: a.zoomReset },
    { label: 'Full screen', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
    { type: 'separator' },
    { label: 'Clear everything', accelerator: 'Ctrl+Shift+Del', click: clearAll },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]).popup({ window: win });
}

// ---------- IPC ----------
function trusted(e) {
  if (!win || win.isDestroyed()) return false;
  if (e.sender === win.webContents) return true;
  const url = (e.senderFrame && e.senderFrame.url) || '';
  return url.startsWith('weby://');
}

function registerIpc() {
  ipcMain.handle('settings:get', (e) => (trusted(e) ? settings.get() : null));
  ipcMain.handle('settings:update', (e, patch) => {
    if (!trusted(e) || !patch || typeof patch !== 'object') return null;
    const next = settings.update(patch);
    if (patch.youtube) tabs.reapplyYouTube();
    return next;
  });
  ipcMain.handle('history:search', (e, q) => (trusted(e) ? history.search(q) : []));
  ipcMain.handle('history:remove', (e, time, url) => { if (trusted(e)) history.remove(time, url); });
  ipcMain.handle('stats:get', (e) => (trusted(e) ? { blocked: blocker.total() } : { blocked: 0 }));
  ipcMain.handle('privacy:clear-all', async (e) => { if (trusted(e)) await clearAll(); });
  ipcMain.handle('page:open', (e, url) => {
    if (!trusted(e)) return;
    const t = tabs.byWebContents(e.sender);
    if (t) tabs.navigate(t.id, String(url || ''));
  });
  ipcMain.handle('page:retry', (e, url) => {
    if (!trusted(e)) return;
    const t = tabs.byWebContents(e.sender);
    if (t) tabs.navigate(t.id, String(url || 'weby://home/'));
  });
  ipcMain.on('shell:layout', (e, l) => { if (e.sender === win.webContents) tabs.setLayout(l); });

  ipcMain.handle('shell:action', async (e, name, arg) => {
    if (e.sender !== win.webContents) return;
    const a = tabs.actions;
    switch (name) {
      case 'newTab': tabs.create('weby://home/'); break;
      case 'closeTab': tabs.close(arg); break;
      case 'activate': tabs.activate(arg); break;
      case 'navigate': tabs.navigate(null, String(arg || '')); break;
      case 'back': a.back(); break;
      case 'forward': a.forward(); break;
      case 'reload': a.reload(); break;
      case 'stop': a.stop(); break;
      case 'home': a.home(); break;
      case 'print': openPrint(); break;
      case 'menu': showMenu(); break;
      case 'clearAll': await clearAll(); break;
      case 'find': a.find(arg && arg.text, arg); break;
      case 'stopFind': a.stopFind(); break;
      default: break;
    }
  });
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0f1115',
    title: 'Weby Browser',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1115', symbolColor: '#e8eaf0', height: 38 },
    webPreferences: {
      session: ses,
      preload: path.join(SRC, 'shell', 'shell-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (e, input) => { if (handleKey(input)) e.preventDefault(); });
  win.on('closed', () => { win = null; });

  tabs.init({ win, ses, settings, onFocusUrlBar: () => send('focus-url') });
  tabs.setKeyHandler(handleKey);
  win.loadFile(path.join(SRC, 'shell', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    const first = process.argv.find((a) => /^https?:\/\//i.test(a));
    tabs.create(first || 'weby://home/');
  });
}

app.whenReady().then(() => {
  const s = settings.load();
  history.init(app.getPath('userData'), () => settings.get().saveHistory && !settings.get().ramOnly);
  blocker.init(path.join(SRC, 'data'));

  if (s.secureDns) {
    try {
      app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: ['https://dns.quad9.net/dns-query'] });
    } catch (_) { /* older runtime */ }
  }

  ses = privacy.getSession(s.ramOnly);
  privacy.harden(ses, settings);
  ses.protocol.handle('weby', serve);
  ses.on('will-download', (_e, item) => {
    item.once('done', (_ev, st) => { if (st === 'completed') send('toast', 'Download complete'); });
  });

  registerIpc();
  createWindow();
});

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.on('before-quit', (e) => {
  if (quitting || !settings.get().clearOnExit) return;
  e.preventDefault();
  quitting = true;
  privacy.clearEverything(ses).finally(() => app.exit(0));
});

app.on('window-all-closed', () => app.quit());
