'use strict';
// Enhanced Ctrl+P: live preview, clean/reader layouts, ink saver, printer picker, save as PDF.
const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const PRELOAD = path.join(__dirname, 'print-preload.js');
let state = null; // { win, wc, source, preview: Buffer|null, version }

const PAGE_SIZES = { A4: 'A4', A3: 'A3', A5: 'A5', Letter: 'Letter', Legal: 'Legal', Tabloid: 'Tabloid' };

// ----- page prep: runs inside the source tab, fully reversible -----
const PREP_JS = (mode) => `(() => {
  const clean = () => {
    document.querySelectorAll('[data-weby-hide],[data-weby-main]').forEach((e) => {
      e.removeAttribute('data-weby-hide'); e.removeAttribute('data-weby-main');
    });
  };
  clean();
  const mode = ${JSON.stringify(mode)};
  if (mode === 'original') return { ok: true };
  const score = (el) => {
    const t = (el.innerText || '').trim().length;
    const links = [...el.querySelectorAll('a')].reduce((n, a) => n + (a.innerText || '').length, 0);
    return t - links * 1.5;
  };
  let main = document.querySelector('article') || document.querySelector('main, [role="main"]');
  if (!main || score(main) < 400) {
    let best = null, bestScore = 0;
    document.querySelectorAll('div, section, article').forEach((el) => {
      const s = score(el);
      const depthPenalty = el.querySelectorAll('div').length * 2;
      if (s - depthPenalty > bestScore && s > 400) { best = el; bestScore = s - depthPenalty; }
    });
    if (best) main = best;
  }
  if (!main || score(main) < 200) return { ok: false };
  main.setAttribute('data-weby-main', '1');
  let node = main;
  while (node && node !== document.body && node.parentElement) {
    [...node.parentElement.children].forEach((sib) => {
      if (sib !== node && sib.tagName !== 'SCRIPT' && sib.tagName !== 'STYLE') sib.setAttribute('data-weby-hide', '1');
    });
    node = node.parentElement;
  }
  return { ok: true };
})();`;

const CLEANUP_JS = `document.querySelectorAll('[data-weby-hide],[data-weby-main]').forEach((e) => { e.removeAttribute('data-weby-hide'); e.removeAttribute('data-weby-main'); });`;

function buildCss(o) {
  const parts = [];
  parts.push(`@media print {
    [data-weby-hide] { display: none !important; }
    ${o.layout !== 'original' ? `
    header, nav, footer, aside, [role="banner"], [role="navigation"], [role="complementary"], [role="dialog"],
    [aria-modal="true"], .cookie, .cookies, [class*="cookie-"], [id*="cookie"], [class*="consent"], [id*="consent"],
    [class*="newsletter"], [class*="subscribe"], [class*="popup"], [class*="modal"], [class*="share-"], [class*="social"],
    [class*="advert"], [class*="sponsor"], iframe, video, audio, ins.adsbygoogle, form[role="search"]
    { display: none !important; }
    *[style*="position: fixed"], *[style*="position:fixed"] { position: static !important; }` : ''}
    ${o.layout === 'reader' ? `
    [data-weby-main] { font-family: Georgia, 'Times New Roman', serif !important; font-size: 12pt !important; line-height: 1.6 !important; color: #000 !important; max-width: 100% !important; width: auto !important; margin: 0 !important; padding: 0 !important; float: none !important; }
    [data-weby-main] * { max-width: 100% !important; }
    [data-weby-main] h1, [data-weby-main] h2, [data-weby-main] h3 { font-family: Georgia, serif !important; line-height: 1.25 !important; break-after: avoid; }
    [data-weby-main] p { orphans: 3; widows: 3; }` : ''}
    ${o.noImages ? `img, picture, svg, canvas { display: none !important; }` : ''}
    ${o.inkSaver ? `* { background: transparent !important; background-image: none !important; box-shadow: none !important; text-shadow: none !important; color: #000 !important; }
    a { text-decoration: underline !important; }` : ''}
    ${o.showLinks ? `a[href^="http"]:not([href*="#"])::after { content: " (" attr(href) ")"; font-size: 0.8em; word-break: break-all; }` : ''}
    img, tr, pre, blockquote, figure { break-inside: avoid; }
  }`);
  return parts.join('\n');
}

function normalize(o) {
  o = o || {};
  const num = (v, min, max, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
  return {
    layout: ['original', 'clean', 'reader'].includes(o.layout) ? o.layout : 'clean',
    paper: PAGE_SIZES[o.paper] || 'A4',
    landscape: !!o.landscape,
    margins: ['default', 'none', 'minimum'].includes(o.margins) ? o.margins : 'default',
    scale: num(o.scale, 10, 200, 100),
    noImages: !!o.noImages,
    inkSaver: !!o.inkSaver,
    showLinks: !!o.showLinks,
    headerFooter: o.headerFooter !== false,
    background: !!o.background,
    color: o.color !== false,
    pageRanges: String(o.pageRanges || '').replace(/[^0-9,\-\s]/g, '').trim(),
    copies: Math.round(num(o.copies, 1, 99, 1)),
    duplex: ['simplex', 'longEdge', 'shortEdge'].includes(o.duplex) ? o.duplex : 'simplex',
    printer: String(o.printer || ''),
    systemDialog: !!o.systemDialog,
  };
}

const MARGIN_IN = { default: 0.4, minimum: 0.2, none: 0 };

async function withPrep(o, fn) {
  const wc = state.wc;
  let cssKey = null;
  try {
    await wc.executeJavaScript(PREP_JS(o.layout));
    cssKey = await wc.insertCSS(buildCss(o));
    return await fn();
  } finally {
    try { if (cssKey) await wc.removeInsertedCSS(cssKey); } catch (_) { /* gone */ }
    try { await wc.executeJavaScript(CLEANUP_JS); } catch (_) { /* gone */ }
  }
}

function pdfOptions(o) {
  const m = MARGIN_IN[o.margins];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const base = {
    landscape: o.landscape,
    pageSize: o.paper,
    scale: o.scale / 100,
    printBackground: o.background && !o.inkSaver,
    margins: { top: m + (o.headerFooter ? 0.25 : 0), bottom: m + (o.headerFooter ? 0.25 : 0), left: m, right: m },
    preferCSSPageSize: false,
    displayHeaderFooter: o.headerFooter,
  };
  if (o.headerFooter) {
    const title = esc((state.wc.getTitle() || '').slice(0, 80));
    const url = esc(state.wc.getURL().slice(0, 110));
    const date = new Date().toLocaleDateString();
    base.headerTemplate = `<div style="font-size:8px;width:100%;padding:0 0.4in;color:#555;display:flex;justify-content:space-between"><span>${title}</span><span>${date}</span></div>`;
    base.footerTemplate = `<div style="font-size:8px;width:100%;padding:0 0.4in;color:#555;display:flex;justify-content:space-between"><span>${url}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  }
  if (o.pageRanges) base.pageRanges = o.pageRanges;
  return base;
}

async function makePdf(o) {
  return withPrep(o, () => state.wc.printToPDF(pdfOptions(o)));
}

function countPages(buf) {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

function register() {
  ipcMain.handle('print:init', async (e) => {
    if (!state || e.sender !== state.win.webContents) return null;
    let printers = [];
    try { printers = await state.wc.getPrintersAsync(); } catch (_) { /* none */ }
    return {
      title: state.wc.getTitle(),
      url: state.wc.getURL(),
      printers: printers.map((p) => ({ name: p.name, display: p.displayName || p.name, isDefault: !!p.isDefault })),
      papers: Object.keys(PAGE_SIZES),
    };
  });

  ipcMain.handle('print:preview', async (e, raw) => {
    if (!state || e.sender !== state.win.webContents) return { ok: false };
    try {
      const o = normalize(raw);
      state.preview = await makePdf(o);
      state.version++;
      return { ok: true, version: state.version, pages: countPages(state.preview) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('print:save', async (e, raw) => {
    if (!state || e.sender !== state.win.webContents) return { ok: false };
    const o = normalize(raw);
    const safe = (state.wc.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'page';
    const r = await dialog.showSaveDialog(state.win, { defaultPath: safe + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const buf = await makePdf(o);
      fs.writeFileSync(r.filePath, buf);
      return { ok: true, path: r.filePath };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('print:print', async (e, raw) => {
    if (!state || e.sender !== state.win.webContents) return { ok: false };
    const o = normalize(raw);
    const m = o.margins === 'none' ? 'none' : o.margins === 'minimum' ? 'printableArea' : 'default';
    return withPrep(o, () => new Promise((resolve) => {
      state.wc.print({
        silent: !o.systemDialog,
        deviceName: o.printer || undefined,
        printBackground: o.background && !o.inkSaver,
        color: o.color && !o.inkSaver,
        landscape: o.landscape,
        scaleFactor: o.scale,
        copies: o.copies,
        pageSize: o.paper,
        margins: { marginType: m },
        duplexMode: o.duplex,
        pageRanges: o.pageRanges ? parseRanges(o.pageRanges) : undefined,
        header: o.headerFooter ? state.wc.getTitle().slice(0, 80) : undefined,
        footer: o.headerFooter ? state.wc.getURL().slice(0, 110) : undefined,
      }, (success, reason) => resolve({ ok: !!success, error: success ? '' : reason }));
    }));
  });

  ipcMain.on('print:close', (e) => {
    if (state && e.sender === state.win.webContents) state.win.close();
  });
}

function parseRanges(s) {
  const out = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const from = Math.max(0, Number(m[1]) - 1);
    out.push({ from, to: m[2] ? Math.max(from, Number(m[2]) - 1) : from });
  }
  return out.length ? out : undefined;
}

let registered = false;
function open(parent, wc) {
  if (!wc || wc.isDestroyed()) return;
  if (state && !state.win.isDestroyed()) { state.win.focus(); return; }
  if (!registered) { register(); registered = true; }
  const win = new BrowserWindow({
    parent,
    modal: true,
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'Print — Weby Browser',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      session: wc.session,
    },
  });
  win.setMenuBarVisibility(false);
  state = { win, wc, preview: null, version: 0 };
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { state = null; }); // preview buffer dropped with state
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { ev.preventDefault(); win.close(); }
  });
  win.loadURL('weby://print/');
}

function getPreview() {
  return state && state.preview ? state.preview : null;
}

module.exports = { open, getPreview };
