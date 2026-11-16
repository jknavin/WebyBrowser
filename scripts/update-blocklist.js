'use strict';
// Optional: downloads a large public ad/tracker host list into src/data/blocklist.extra.txt.
// Runs at build time in CI. Failing is fine: the built-in list still ships.
const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCES = [
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  'https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/filter.txt',
];
const OUT = path.join(__dirname, '..', 'src', 'data', 'blocklist.extra.txt');

function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 4) {
        res.resume();
        return resolve(get(res.headers.location, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

(async () => {
  const lines = new Set();
  for (const src of SOURCES) {
    try {
      const text = await get(src);
      for (const l of text.split(/\r?\n/)) {
        const t = l.trim();
        if (t && !t.startsWith('#') && !t.startsWith('!')) lines.add(t);
      }
      console.log('ok  ', src);
    } catch (e) {
      console.log('skip', src, '-', e.message);
    }
  }
  if (lines.size) {
    fs.writeFileSync(OUT, [...lines].join('\n'));
    console.log('wrote', lines.size, 'entries');
  }
})();
