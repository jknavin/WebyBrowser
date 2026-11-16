'use strict';
// Preload for every tab. Exposes a tiny API ONLY to internal weby:// pages.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'weby:') {
  contextBridge.exposeInMainWorld('webyApi', {
    getSettings: () => ipcRenderer.invoke('settings:get'),
    updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
    searchHistory: (q) => ipcRenderer.invoke('history:search', q),
    removeHistory: (time, url) => ipcRenderer.invoke('history:remove', time, url),
    clearAll: () => ipcRenderer.invoke('privacy:clear-all'),
    stats: () => ipcRenderer.invoke('stats:get'),
    open: (url) => ipcRenderer.invoke('page:open', url),
    retry: (url) => ipcRenderer.invoke('page:retry', url),
  });
}
