let appConfig = null;
let activeReport = null;
let latestCapture = null;

const formFields = {};

function getReportById(reportId) {
  return appConfig?.reports?.find((report) => report.id === reportId) || null;
}

function createBlankReport() {
  const id = `report-${Date.now()}`;
  return {
    id,
    name: "新报表",
    description: "",
    pageUrl: "",
    requestMatch: "",
    fileNamePrefix: id,
    queryDatePath: "",
    defaultDateOffset: "-1",
    sheetNames: [],
    raw: {
      id,
      name: "新报表",
      description: "",
      pageUrl: "",
      requestMatch: "",
      fileNamePrefix: id,
      queryDatePath: "",
      defaultDateOffset: -1,
      sheets: [
        {
          name: "Sheet1",
          mode: "list",
          sourcePath: "",
          columns: [{ title: "示例列", path: "" }]
        }
      ]
    }
  };
}

function refreshReportSelect() {
  const select = document.getElementById("report-select");
  const currentId = activeReport?.id || "";

  select.innerHTML = "";
  for (const report of appConfig.reports) {
    const option = document.createElement("option");
    option.value = report.id;
    option.textContent = report.name;
    select.appendChild(option);
  }

  if (currentId && getReportById(currentId)) {
    select.value = currentId;
  } else if (appConfig.reports[0]) {
    select.value = appConfig.reports[0].id;
  }
}

function renderReportMeta(report) {
  document.getElementById("report-description").textContent =
    report.description || "";
  document.getElementById("report-config-path").textContent =
    `配置文件：${appConfig.reportsConfigPath}`;
  document.getElementById("entry-url").textContent =
    `接口关键词：${report.requestMatch || "未填写"}`;
}

function fillForm(report) {
  const raw = report.raw || {};
  formFields.id.value = raw.id || "";
  formFields.name.value = raw.name || "";
  formFields.description.value = raw.description || "";
  formFields.pageUrl.value = raw.pageUrl || "";
  formFields.requestMatch.value = raw.requestMatch || "";
  formFields.fileNamePrefix.value = raw.fileNamePrefix || "";
  formFields.queryDatePath.value = raw.queryDatePath || "";
  formFields.defaultDateOffset.value =
    raw.defaultDateOffset == null ? "" : String(raw.defaultDateOffset);
  formFields.sheetsJson.value = JSON.stringify(raw.sheets || [], null, 2);
}

function resetCaptureState(message) {
  latestCapture = null;
  document.getElementById("export-report").disabled = true;
  document.getElementById("capture-status").textContent = message;
}

async function loadActiveReportIntoWebview(webview) {
  if (!activeReport) {
    return;
  }

  renderReportMeta(activeReport);
  fillForm(activeReport);
  resetCaptureState("等待当前报表页面发出目标接口...");
  document.getElementById("export-status").textContent =
    "导出完成后会显示保存路径。";

  if (activeReport.pageUrl) {
    webview.setAttribute("src", activeReport.pageUrl);
  }
}

function readFormReport() {
  const id = formFields.id.value.trim();
  const name = formFields.name.value.trim();
  const pageUrl = formFields.pageUrl.value.trim();
  const requestMatch = formFields.requestMatch.value.trim();
  const fileNamePrefix = formFields.fileNamePrefix.value.trim();
  const queryDatePath = formFields.queryDatePath.value.trim();
  const defaultDateOffsetText = formFields.defaultDateOffset.value.trim();

  let sheets;
  try {
    sheets = JSON.parse(formFields.sheetsJson.value);
  } catch (error) {
    throw new Error(`Sheets JSON 解析失败：${error.message}`);
  }

  return {
    id,
    name,
    description: formFields.description.value.trim(),
    pageUrl,
    requestMatch,
    fileNamePrefix,
    queryDatePath,
    defaultDateOffset:
      defaultDateOffsetText === "" ? undefined : Number(defaultDateOffsetText),
    sheets
  };
}

async function replaceConfig(newConfig) {
  appConfig = newConfig;
  refreshReportSelect();
  activeReport = getReportById(document.getElementById("report-select").value);
  if (!activeReport && appConfig.reports[0]) {
    activeReport = appConfig.reports[0];
  }
}

async function bootstrap() {
  formFields.id = document.getElementById("report-id");
  formFields.name = document.getElementById("report-name");
  formFields.description = document.getElementById("report-description-input");
  formFields.pageUrl = document.getElementById("report-page-url");
  formFields.requestMatch = document.getElementById("report-request-match");
  formFields.fileNamePrefix = document.getElementById("report-file-name-prefix");
  formFields.queryDatePath = document.getElementById("report-query-date-path");
  formFields.defaultDateOffset = document.getElementById(
    "report-default-date-offset"
  );
  formFields.sheetsJson = document.getElementById("report-sheets-json");

  const reportSelect = document.getElementById("report-select");
  const reloadButton = document.getElementById("reload-page");
  const openPageButton = document.getElementById("open-page");
  const exportButton = document.getElementById("export-report");
  const newReportButton = document.getElementById("new-report");
  const saveReportButton = document.getElementById("save-report");
  const deleteReportButton = document.getElementById("delete-report");
  const resetDefaultsButton = document.getElementById("reset-defaults");
  const captureStatus = document.getElementById("capture-status");
  const exportStatus = document.getElementById("export-status");
  const configStatus = document.getElementById("config-status");
  const webview = document.getElementById("pdd-webview");

  appConfig = await window.desktopApp.getConfig();
  refreshReportSelect();

  activeReport = appConfig.reports[0] || null;
  if (!activeReport) {
    captureStatus.textContent = "当前没有可用的报表配置。";
    return;
  }

  reportSelect.value = activeReport.id;
  await loadActiveReportIntoWebview(webview);

  reportSelect.addEventListener("change", async (event) => {
    activeReport = getReportById(event.target.value);
    await loadActiveReportIntoWebview(webview);
  });

  newReportButton.addEventListener("click", () => {
    const blankReport = createBlankReport();
    activeReport = blankReport;
    fillForm(blankReport);
    renderReportMeta(blankReport);
    configStatus.textContent = "已生成新报表草稿，填写后点击保存。";
    resetCaptureState("新报表草稿尚未保存。");
  });

  saveReportButton.addEventListener("click", async () => {
    try {
      const report = readFormReport();
      const newConfig = await window.desktopApp.saveReport({ report });
      await replaceConfig(newConfig);
      activeReport = getReportById(report.id);
      reportSelect.value = activeReport.id;
      configStatus.textContent = `已保存配置：${activeReport.name}`;
      await loadActiveReportIntoWebview(webview);
    } catch (error) {
      configStatus.textContent = `保存失败：${error.message}`;
    }
  });

  deleteReportButton.addEventListener("click", async () => {
    if (!activeReport) {
      return;
    }

    const newConfig = await window.desktopApp.deleteReport({
      reportId: activeReport.id
    });
    await replaceConfig(newConfig);
    activeReport = appConfig.reports[0] || null;
    if (activeReport) {
      reportSelect.value = activeReport.id;
      configStatus.textContent = "已删除当前报表。";
      await loadActiveReportIntoWebview(webview);
    }
  });

  resetDefaultsButton.addEventListener("click", async () => {
    const newConfig = await window.desktopApp.resetDefaultReports();
    await replaceConfig(newConfig);
    activeReport = appConfig.reports[0] || null;
    if (activeReport) {
      reportSelect.value = activeReport.id;
      configStatus.textContent = "已恢复默认报表。";
      await loadActiveReportIntoWebview(webview);
    }
  });

  reloadButton.addEventListener("click", () => {
    resetCaptureState("页面已刷新，等待重新捕获当前报表接口。");
    exportStatus.textContent = "页面已刷新。";
    webview.reload();
  });

  openPageButton.addEventListener("click", () => {
    if (!activeReport?.pageUrl) {
      exportStatus.textContent = "当前报表还没有页面 URL。";
      return;
    }

    resetCaptureState("已切换到当前报表页面，等待接口响应。");
    webview.setAttribute("src", activeReport.pageUrl);
  });

  exportButton.addEventListener("click", async () => {
    if (!latestCapture || !activeReport) {
      exportStatus.textContent = "还没有当前报表的可导出数据。";
      return;
    }

    exportButton.disabled = true;
    exportStatus.textContent = "正在导出 Excel...";

    try {
      const result = await window.desktopApp.exportReport(latestCapture);
      exportStatus.textContent = result.canceled
        ? "已取消导出。"
        : `导出完成：${result.filePath}`;
    } catch (error) {
      exportStatus.textContent = `导出失败：${error.message}`;
    } finally {
      exportButton.disabled = false;
    }
  });

  webview.addEventListener("did-start-loading", () => {
    captureStatus.textContent = "页面加载中，等待目标接口返回...";
  });

  window.desktopApp.onCaptureStatus(async (payload) => {
    if (!activeReport) {
      return;
    }

    if (payload?.reportId && payload.reportId !== activeReport.id) {
      return;
    }

    if (!payload?.ok) {
      captureStatus.textContent = payload?.message || "接口监听异常。";
      return;
    }

    const capture = await window.desktopApp.getLatestCapture({
      webContentsId: webview.getWebContentsId(),
      reportId: activeReport.id
    });

    if (!capture) {
      captureStatus.textContent = "已命中目标接口，但暂时拿不到响应体。";
      return;
    }

    latestCapture = capture;
    captureStatus.textContent = `已捕获 ${payload.reportName}，日期：${payload.queryDate}。现在可以导出。`;
    exportButton.disabled = false;
  });
}

bootstrap().catch((error) => {
  document.getElementById("entry-url").textContent = `初始化失败：${error.message}`;
});
