'use strict';
(async () => {
  const A = window.webyApi;
  const $ = (id) => document.getElementById(id);
  const s = await A.getSettings();
  $('searchEngine').value = s.searchEngine;
  document.querySelectorAll('[data-k]').forEach((c) => {
    c.checked = !!s[c.dataset.k];
    c.addEventListener('change', async () => {
      await A.updateSettings({ [c.dataset.k]: c.checked });
      $('msg').textContent = 'Saved.';
    });
  });
  $('searchEngine').addEventListener('change', async () => {
    await A.updateSettings({ searchEngine: $('searchEngine').value });
    $('msg').textContent = 'Saved.';
  });
  $('clr').addEventListener('click', async () => {
    await A.clearAll();
    $('msg').textContent = 'Everything cleared.';
  });
})();
