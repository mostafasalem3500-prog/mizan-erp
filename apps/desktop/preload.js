const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("mizanDesktop", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  chooseMode: (mode, cloudUrl) => ipcRenderer.invoke("choose-mode", { mode, cloudUrl }),
  retry: () => ipcRenderer.invoke("retry"),
  onStatus: (cb) => ipcRenderer.on("status", (_e, t) => cb(t)),
  isDesktop: true,
});
