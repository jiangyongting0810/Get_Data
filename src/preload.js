const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  getLatestCapture: (payload) => ipcRenderer.invoke("capture:get-latest", payload),
  exportReport: (payload) => ipcRenderer.invoke("report:export", payload),
  saveReport: (payload) => ipcRenderer.invoke("reports:save", payload),
  deleteReport: (payload) => ipcRenderer.invoke("reports:delete", payload),
  resetDefaultReports: () => ipcRenderer.invoke("reports:reset-defaults"),
  onCaptureStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("capture:status", listener);
    return () => ipcRenderer.removeListener("capture:status", listener);
  }
});
