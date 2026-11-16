'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weby', {
  action: (name, arg) => ipcRenderer.invoke('shell:action', name, arg),
  layout: (l) => ipcRenderer.send('shell:layout', l),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusUrl: (cb) => ipcRenderer.on('focus-url', () => cb()),
  onToast: (cb) => ipcRenderer.on('toast', (_e, m) => cb(m)),
  onOpenPanel: (cb) => ipcRenderer.on('open-panel', (_e, p) => cb(p)),
});
