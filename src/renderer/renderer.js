let latestCapture = null;

async function bootstrap() {
  const reloadButton = document.getElementById("reload-page");
  const exportButton = document.getElementById("export-report");
  const entryLabel = document.getElementById("entry-url");
  const captureStatus = document.getElementById("capture-status");
  const exportStatus = document.getElementById("export-status");
  const webview = document.getElementById("pdd-webview");

  const config = await window.desktopApp.getConfig();
  entryLabel.textContent = `拼多多后台入口：${config.pddEntryUrl}`;
  webview.setAttribute("src", config.pddEntryUrl);

  reloadButton.addEventListener("click", () => {
    latestCapture = null;
    exportButton.disabled = true;
    captureStatus.textContent = "页面已刷新，等待重新捕获昨天交易接口响应。";
    exportStatus.textContent = "页面已刷新，等待重新捕获昨天交易接口。";
    webview.reload();
  });

  exportButton.addEventListener("click", async () => {
    if (!latestCapture) {
      exportStatus.textContent = "还没有可导出的数据，请先登录并停留在交易概况页面。";
      return;
    }

    exportButton.disabled = true;
    exportStatus.textContent = "正在导出 Excel...";

    try {
      const result = await window.desktopApp.exportYesterdayReport(latestCapture);

      if (result.canceled) {
        exportStatus.textContent = "已取消导出。";
      } else {
        exportStatus.textContent = `导出完成：${result.filePath}`;
      }
    } catch (error) {
      exportStatus.textContent = `导出失败：${error.message}`;
    } finally {
      exportButton.disabled = false;
    }
  });

  webview.addEventListener("did-start-loading", () => {
    captureStatus.textContent = "页面加载中，等待拼多多后台接口返回...";
  });

  window.desktopApp.onCaptureStatus(async (payload) => {
    if (!payload?.ok) {
      captureStatus.textContent = payload?.message || "接口监听异常。";
      return;
    }

    const capture = await window.desktopApp.getLatestCapture({
      webContentsId: webview.getWebContentsId()
    });

    if (!capture) {
      captureStatus.textContent = "已监听到目标接口，但暂时拿不到响应体。";
      return;
    }

    latestCapture = capture;
    const queryDate = payload.queryDate || "昨天";
    captureStatus.textContent = `已捕获昨天交易数据，日期：${queryDate}。现在可以导出 Excel。`;
    exportButton.disabled = false;
  });
}

bootstrap().catch((error) => {
  const entryLabel = document.getElementById("entry-url");
  entryLabel.textContent = `初始化失败：${error.message}`;
});
