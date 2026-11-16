'use strict';
// Session hardening + the one-tap "Clear everything".
const { session } = require('electron');
const blocker = require('./blocker');
const history = require('./history');

const PARTITION = 'weby-main';
const SAFE_PERMS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

function getSession(ramOnly) {
  // Non-"persist:" partition = in-memory only (nothing written to disk).
  return session.fromPartition(ramOnly ? PARTITION : 'persist:' + PARTITION);
}

function harden(ses, settings, dohUrl) {
  // No Chrome-style identity: strip Electron/app tokens from the UA.
  const ua = ses.getUserAgent()
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\sweby-browser\/[\d.]+/i, '');
  ses.setUserAgent(ua);

  // Deny every powerful permission by default (camera, mic, location, notifications...).
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(SAFE_PERMS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => SAFE_PERMS.has(permission));
  ses.setDevicePermissionHandler(() => false);

  // Block third-party cookies by rewriting headers.
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
    const h = details.responseHeaders || {};
    if (settings.get().blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
      let firstParty = '';
      try { firstParty = new URL(details.referrer || '').hostname; } catch (_) { /* ignore */ }
      let host = '';
      try { host = new URL(details.url).hostname; } catch (_) { /* ignore */ }
      const same = firstParty && (host === firstParty || host.endsWith('.' + firstParty) || firstParty.endsWith('.' + host));
      if (!same) {
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') delete h[k];
      }
    }
    cb({ responseHeaders: h });
  });

  blocker.attach(ses, settings);
  ses.setSpellCheckerEnabled(false); // spellcheck can phone home
}

// Upgrade http:// -> https:// at navigation time. Returns the url to load.
function upgrade(url, settings) {
  if (!settings.get().httpsOnly) return url;
  try {
    const u = new URL(url);
    const local = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(u.hostname) || !u.hostname.includes('.');
    if (u.protocol === 'http:' && !local) { u.protocol = 'https:'; return u.toString(); }
  } catch (_) { /* ignore */ }
  return url;
}

async function clearEverything(ses) {
  history.clear();
  try { await ses.clearStorageData(); } catch (_) { /* ignore */ }
  try { await ses.clearCache(); } catch (_) { /* ignore */ }
  try { await ses.clearAuthCache(); } catch (_) { /* ignore */ }
  try { await ses.clearHostResolverCache(); } catch (_) { /* ignore */ }
  try { await ses.clearCodeCaches({}); } catch (_) { /* ignore */ }
  try { await ses.cookies.flushStore(); } catch (_) { /* ignore */ }
}

module.exports = { getSession, harden, upgrade, clearEverything };
