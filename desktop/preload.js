'use strict'
// The only bridge between the pages and the app: start-up progress for the splash, and a few calls the main process checks.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roomiaDesktop', {
  desktop: true,
  onStatus: cb => {
    if (typeof cb !== 'function') return
    ipcRenderer.on('roomia:status', (_e, s) => cb({ text: String(s?.text ?? ''), fraction: typeof s?.fraction === 'number' ? s.fraction : null }))
  },
  engine: () => ipcRenderer.invoke('roomia:engine'),
  openProjects: () => ipcRenderer.invoke('roomia:open-projects'),
  report: () => ipcRenderer.invoke('roomia:report'),
  openExternal: url => ipcRenderer.invoke('roomia:open-external', String(url)),
  // 14 Nov: installs (or repairs) the SketchUp extension in every SketchUp of this PC, then says how to use it
  installSketchup: () => ipcRenderer.invoke('roomia:install-sketchup'),
})
