'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webyPrint', {
  init: () => ipcRenderer.invoke('print:init'),
  preview: (o) => ipcRenderer.invoke('print:preview', o),
  print: (o) => ipcRenderer.invoke('print:print', o),
  save: (o) => ipcRenderer.invoke('print:save', o),
  close: () => ipcRenderer.send('print:close'),
});
