'use strict';
(() => {
  const A = window.webyApi;
  const $ = (id) => document.getElementById(id);
  const p = new URLSearchParams(location.search);
  const code = Number(p.get('code'));
  const url = p.get('url') || '';
  const desc = (p.get('desc') || '').replace(/^net::/, '');
  let msg = 'Check your connection and try again.';
  if (code <= -200 && code > -300) {
    $('h').textContent = 'Connection is not secure';
    msg = 'Weby blocked this page because its security certificate could not be trusted.';
  } else if (code === -105 || code === -137) {
    msg = "The server's address could not be found. Check the spelling.";
  } else if (code === -106 || code === -109) {
    msg = 'You appear to be offline.';
  } else if (code === -2 || code === -20) {
    msg = 'This address was blocked.';
  } else if (/^https:/i.test(url) && (code === -107 || code === -113)) {
    msg = 'This site does not support a secure (HTTPS) connection. Weby never falls back to plain HTTP.';
  }
  $('d').textContent = msg;
  $('u').textContent = (url ? url + '  ' : '') + (desc ? '(' + desc + ')' : '');
  $('retry').addEventListener('click', () => A.retry(url));
  $('home').addEventListener('click', () => A.open('weby://home/'));
})();
