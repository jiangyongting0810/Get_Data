const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  exportYesterdayReport: (payload) =>
    ipcRenderer.invoke("report:export-yesterday", payload),
  getLatestCapture: (payload) => ipcRenderer.invoke("trade:get-latest-capture", payload),
  onCaptureStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("trade:capture-status", listener);
    return () => ipcRenderer.removeListener("trade:capture-status", listener);
  }
});
