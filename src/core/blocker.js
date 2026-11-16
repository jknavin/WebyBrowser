'use strict';
// Network-level ad + tracker blocking, plus URL cleaning. Runs fully offline.
const fs = require('fs');
const path = require('path');

const hosts = new Set();
let blockedCount = 0;
const perTab = new Map(); // webContents id -> count

function loadFile(p) {
  try {
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      let line = raw.trim().toLowerCase();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      line = line.replace(/^0\.0\.0\.0\s+|^127\.0\.0\.1\s+/, '');
      line = line.replace(/^\|\|/, '').replace(/\^.*$/, '');
      if (line.includes('/')) continue; // domain rules only
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(line)) hosts.add(line);
    }
  } catch (_) { /* file optional */ }
}

function init(dataDir) {
  loadFile(path.join(dataDir, 'blocklist.txt'));
  loadFile(path.join(dataDir, 'blocklist.extra.txt'));
}

function hostBlocked(host) {
  host = host.toLowerCase();
  while (host) {
    if (hosts.has(host)) return true;
    const i = host.indexOf('.');
    if (i < 0) return false;
    host = host.slice(i + 1);
  }
  return false;
}

// Path patterns for ad endpoints on otherwise legitimate hosts.
const PATH_RULES = [
  /^https?:\/\/[^/]*youtube\.com\/api\/stats\/ads/i,
  /^https?:\/\/[^/]*youtube\.com\/pagead\//i,
  /^https?:\/\/[^/]*youtube\.com\/ptracking/i,
  /^https?:\/\/[^/]*youtube\.com\/youtubei\/v1\/player\/ad_break/i,
  /^https?:\/\/[^/]*youtube\.com\/get_midroll_info/i,
  /^https?:\/\/[^/]*youtube\.com\/api\/stats\/qoe/i,
  /^https?:\/\/[^/]*google\.com\/pagead\//i,
  /^https?:\/\/[^/]*google\.com\/ads\//i,
  /^https?:\/\/[^/]*facebook\.com\/tr[/?]/i,
  /^https?:\/\/[^/]*\/(ads?|adserver|adframe|banners?)\/[^?]*\.(js|gif|png|jpg|html)/i,
  /[?&]ad_type=|[?&]adunit=|\/pagead\/|\/adview\?|\/ad_status\.js/i,
];

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
  'mc_eid', 'mc_cid', '_hsenc', '_hsmi', 'igshid', 'igsh', 'twclid', 'ttclid',
  'li_fat_id', 'vero_id', 'oly_enc_id', 'oly_anon_id', 'rb_clickid', 's_cid',
  'spm', 'ref_src', 'ref_url', 'si', 'pp', 'mkt_tok', 'trk', 'trkcampaign',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_brand', 'utm_social', 'utm_social-type',
  '__s', 'sc_cid', 'wickedid', 'ncid', 'cmpid', 'zanpid',
]);

function shouldBlock(url, resourceType, firstPartyHost) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return false;
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    // Never block the page the user deliberately opened.
    if (resourceType === 'mainFrame') return false;
  }
  // Don't block a site's own domain just because it is in the list
  // (e.g. user visits a list entry directly through a subframe on same site).
  if (firstPartyHost && (u.hostname === firstPartyHost || u.hostname.endsWith('.' + firstPartyHost))) {
    if (!PATH_RULES.some((r) => r.test(url))) return false;
  }
  if (hostBlocked(u.hostname)) return true;
  return PATH_RULES.some((r) => r.test(url));
}

function cleanUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { return url; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) {
      u.searchParams.delete(k);
      changed = true;
    }
  }
  return changed ? u.toString() : url;
}

function attach(ses, settings) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const wcId = details.webContentsId;
    let fp = '';
    try {
      if (details.referrer) fp = new URL(details.referrer).hostname;
    } catch (_) { /* ignore */ }
    if (shouldBlock(details.url, details.resourceType, fp)) {
      blockedCount++;
      if (wcId) perTab.set(wcId, (perTab.get(wcId) || 0) + 1);
      return cb({ cancel: true });
    }
    if (details.resourceType === 'mainFrame' && settings.get().stripTrackingParams) {
      const cleaned = cleanUrl(details.url);
      if (cleaned !== details.url) return cb({ redirectURL: cleaned });
    }
    cb({});
  });

  // Strip referrers, client hints and identifiers from outgoing requests.
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) {
      const l = k.toLowerCase();
      if (l === 'x-client-data' || l === 'x-requested-with') delete h[k];
    }
    h['DNT'] = '1';
    h['Sec-GPC'] = '1';
    cb({ requestHeaders: h });
  });
}

const cosmeticCSS = `
  ins.adsbygoogle, iframe[src*="doubleclick.net"], iframe[src*="googlesyndication"],
  div[id^="google_ads_"], div[id^="div-gpt-ad"], [data-ad-slot], [data-google-query-id],
  a[href*="doubleclick.net"], a[href*="googleadservices"],
  .ad-banner, .ad-container, .ad-slot, .adsbox, .ads-banner, .advert, .advertisement,
  .sponsored-ad, .taboola, #taboola-below-article, .OUTBRAIN, .ob-widget
  { display: none !important; }
`;

function count(id) { return id ? perTab.get(id) || 0 : blockedCount; }
function total() { return blockedCount; }
function resetTab(id) { perTab.delete(id); }

module.exports = { init, attach, count, total, resetTab, cosmeticCSS, cleanUrl, shouldBlock };
