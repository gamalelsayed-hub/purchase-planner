'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  cfg: () => ipcRenderer.invoke('cfg:get'),
  chooseDir: (title) => ipcRenderer.invoke('cfg:chooseDir', title),
  setDataDir: (dir, mode) => ipcRenderer.invoke('cfg:setDataDir', dir, mode),
  loadDb: () => ipcRenderer.invoke('db:load'),
  statDb: () => ipcRenderer.invoke('db:stat'),
  saveDb: (json, opts) => ipcRenderer.invoke('db:save', json, opts),
  snapshot: (label) => ipcRenderer.invoke('db:snapshot', label),
  acquireLock: (user, name) => ipcRenderer.invoke('lock:acquire', user, name),
  releaseLock: () => ipcRenderer.invoke('lock:release'),
  onLockLost: (cb) => ipcRenderer.on('lock:lost', (_e, l) => cb(l)),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  openUrl: (url) => ipcRenderer.invoke('app:openUrl', url),
  openExcel: (opts) => ipcRenderer.invoke('file:openExcel', opts),
  openMany: (opts) => ipcRenderer.invoke('file:openMany', opts),
  saveExcel: (spec, name) => ipcRenderer.invoke('file:saveExcel', spec, name),
  savePdf: (name, landscape) => ipcRenderer.invoke('file:savePdf', name, landscape),
  print: () => ipcRenderer.invoke('file:print'),
  exportBackup: (json) => ipcRenderer.invoke('backup:export', json),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  attachAdd: (no) => ipcRenderer.invoke('attach:add', no),
  attachOpen: (no, file) => ipcRenderer.invoke('attach:open', no, file),
  attachRemove: (no, file) => ipcRenderer.invoke('attach:remove', no, file),
  attachFolder: (no) => ipcRenderer.invoke('attach:folder', no),
  openFolder: (which) => ipcRenderer.invoke('app:openFolder', which)
});
