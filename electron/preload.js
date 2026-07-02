/**
 * preload.js — Electron preload script
 * Exposes a safe IPC bridge (window.electronAPI) to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close:    () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // File dialogs (native)
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),

  // Platform info
  platform: process.platform,
  version:  process.env.npm_package_version || '1.0.0',

  // Backend port (set by main process)
  getBackendPort: () => ipcRenderer.invoke('app:getBackendPort'),

  // Tray / app
  hideToTray: () => ipcRenderer.invoke('app:hideToTray'),

  // Listen for backend-ready event from main
  onBackendReady: (cb) => ipcRenderer.on('backend:ready', (_event, port) => cb(port)),
  onBackendError: (cb) => ipcRenderer.on('backend:error', (_event, msg) => cb(msg)),

  // Downloader IPC listeners & actions
  startDownload: () => ipcRenderer.send('download:start'),
  onDownloadProgress: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },
  onDownloadStatus: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on('download:status', listener);
    return () => ipcRenderer.removeListener('download:status', listener);
  },
  onDownloadError: (cb) => {
    const listener = (_event, error) => cb(error);
    ipcRenderer.on('download:error', listener);
    return () => ipcRenderer.removeListener('download:error', listener);
  },
  onDownloadSuccess: (cb) => {
    const listener = (_event) => cb();
    ipcRenderer.on('download:success', listener);
    return () => ipcRenderer.removeListener('download:success', listener);
  },
});
