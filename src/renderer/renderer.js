let appConfig = null;
let activeReport = null;
let latestCapture = null;
let combinedSession = null;

const formFields = {};

function isCombinedReport(report) {
  return report?.type === "combined" || report?.raw?.type === "combined";
}

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

function createBlankCombinedReport() {
  const id = `combined-${Date.now()}`;
  return {
    id,
    type: "combined",
    name: "新组合报表",
    description: "",
    fileNamePrefix: id,
    raw: {
      id,
      type: "combined",
      name: "新组合报表",
      description: "",
      fileNamePrefix: id,
      summarySheetName: "汇总",
      sources: []
    }
  };
}

function getCombinedReports() {
  return (appConfig?.reports || []).filter((report) => isCombinedReport(report));
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
  document.getElementById("entry-url").textContent = isCombinedReport(report)
    ? "组合报表：按数据来源逐页采集并合并导出。"
    : `接口关键字：${report.requestMatch || "未填写"}`;
}

function fillForm(report) {
  const raw = report.raw || {};
  formFields.name.value = raw.name || "";
  formFields.description.value = raw.description || "";
  formFields.fileNamePrefix.value = raw.fileNamePrefix || "";

  const combined = isCombinedReport(report);
  document.querySelectorAll(".single-report-field").forEach((element) => {
    element.hidden = combined;
  });
  document.getElementById("combined-fields").hidden = !combined;

  if (combined) {
    formFields.combinedSummarySheetName.value = raw.summarySheetName || "汇总";
    renderCombinedSources(raw.sources || []);
    return;
  }

  formFields.pageUrl.value = raw.pageUrl || "";
  formFields.requestMatch.value = raw.requestMatch || "";
  formFields.queryDatePath.value = raw.queryDatePath || "";
  formFields.defaultDateOffset.value =
    raw.defaultDateOffset == null ? "" : String(raw.defaultDateOffset);
  formFields.sheetsJson.value = JSON.stringify(raw.sheets || [], null, 2);
  formFields.addToCombinedStatus.textContent = "";
  renderAssociationEditor();
}

function getEditableSummarySheets() {
  try {
    const sheets = JSON.parse(formFields.sheetsJson.value);
    return Array.isArray(sheets)
      ? sheets.filter((sheet) => ["last", "object"].includes(sheet.mode))
      : [];
  } catch (_error) {
    return [];
  }
}

function getCurrentAssociation() {
  const combinedReport = getReportById(formFields.targetCombinedReport.value);
  return (
    combinedReport?.raw?.sources?.find(
      (source) => source.reportId === activeReport?.id
    ) || null
  );
}

function populateCombinedReportTargets() {
  const select = formFields.targetCombinedReport;
  const currentValue = select.value;
  const combinedReports = getCombinedReports();
  select.innerHTML = "";

  if (combinedReports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "请先新建并保存组合报表";
    select.appendChild(option);
    formFields.addToCombinedButton.disabled = true;
    return;
  }

  for (const report of combinedReports) {
    const option = document.createElement("option");
    option.value = report.id;
    option.textContent = report.name;
    select.appendChild(option);
  }

  if (combinedReports.some((report) => report.id === currentValue)) {
    select.value = currentValue;
  }
  formFields.addToCombinedButton.disabled = false;
}

function renderAssociationEditor() {
  populateCombinedReportTargets();
  const association = getCurrentAssociation();
  const sheets = getEditableSummarySheets();
  const select = formFields.sourceSummarySheet;
  select.innerHTML = "";

  for (const sheet of sheets) {
    const option = document.createElement("option");
    option.value = sheet.name;
    option.textContent = sheet.name;
    select.appendChild(option);
  }

  if (
    association?.summarySheetName &&
    sheets.some((sheet) => sheet.name === association.summarySheetName)
  ) {
    select.value = association.summarySheetName;
  }

  formFields.sourceIncludeDetails.checked = Boolean(association?.includeDetails);
  renderAssociationColumns(association?.columns);
}

function renderAssociationColumns(selectedColumns) {
  const sheet = getEditableSummarySheets().find(
    (item) => item.name === formFields.sourceSummarySheet.value
  );
  const picker = formFields.sourceSummaryColumns;
  picker.innerHTML = "";

  if (!sheet) {
    picker.textContent =
      "当前 Sheets JSON 中没有 mode 为 last 或 object 的汇总 Sheet。";
    return;
  }

  const selectedSet = Array.isArray(selectedColumns)
    ? new Set(selectedColumns)
    : null;

  for (const column of sheet.columns || []) {
    if (column.value === "$queryDate") {
      continue;
    }
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = column.title;
    checkbox.checked = selectedSet ? selectedSet.has(column.title) : true;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(column.title));
    picker.appendChild(label);
  }

  const note = document.createElement("span");
  note.textContent = "日期列将自动输出";
  picker.appendChild(note);
}

function createCombinedSourceRow(source = {}) {
  const row = document.createElement("article");
  row.className = "combined-source-row";
  row.source = { ...source, columns: [...(source.columns || [])] };

  const header = document.createElement("div");
  header.className = "combined-source-header";

  const title = document.createElement("h2");
  title.textContent = source.label || "未命名来源";

  const removeButton = document.createElement("button");
  removeButton.className = "small-button";
  removeButton.type = "button";
  removeButton.textContent = "移除";
  removeButton.addEventListener("click", () => {
    row.remove();
  });

  header.appendChild(title);
  header.appendChild(removeButton);

  const summary = document.createElement("p");
  summary.className = "combined-source-summary";
  const detailText = source.includeDetails ? "；附带明细 Sheet" : "";
  summary.textContent = `汇总 Sheet：${source.summarySheetName || "未选择"}；字段：${
    (source.columns || []).join("、") || "未选择"
  }${detailText}`;

  row.appendChild(header);
  row.appendChild(summary);
  return row;
}

function renderCombinedSources(sources) {
  const container = document.getElementById("combined-sources");
  container.innerHTML = "";
  for (const source of sources) {
    container.appendChild(createCombinedSourceRow(source));
  }
}

function readCombinedSources() {
  return [...document.querySelectorAll(".combined-source-row")].map(
    (row) => row.source
  );
}

function resetCaptureState(message) {
  latestCapture = null;
  document.getElementById("export-report").disabled = true;
  document.getElementById("capture-status").textContent = message;
}

function renderCombinedStatus() {
  const container = document.getElementById("combined-source-status");
  const progress = document.getElementById("combined-progress");
  container.innerHTML = "";

  if (!combinedSession) {
    progress.textContent = "开始后将依次打开各数据来源页面。";
    return;
  }

  const finished = combinedSession.states.filter((state) =>
    ["confirmed", "skipped"].includes(state.status)
  ).length;

  progress.textContent =
    finished === combinedSession.states.length
      ? "采集流程已结束，可以导出组合报表。"
      : `正在处理第 ${combinedSession.currentIndex + 1} / ${
          combinedSession.states.length
        } 个来源。`;

  for (const state of combinedSession.states) {
    const item = document.createElement("div");
    item.className = "combined-status-item";

    const name = document.createElement("strong");
    name.textContent = state.source.label;

    const status = document.createElement("span");
    const statusText = {
      pending: "等待处理",
      collecting: "页面已打开，请在页面中触发所需数据",
      captured: `已捕获数据，日期：${state.queryDate || "未知"}`,
      confirmed: `已确认，日期：${state.queryDate || "未知"}`,
      skipped: "已跳过，导出时对应汇总字段留空"
    };
    status.textContent = statusText[state.status] || state.status;

    item.appendChild(name);
    item.appendChild(status);
    container.appendChild(item);
  }
}

function resetCombinedSession() {
  combinedSession = null;
  document.getElementById("confirm-combined-source").disabled = true;
  document.getElementById("skip-combined-source").disabled = true;
  document.getElementById("export-combined").disabled = true;
  renderCombinedStatus();
}

function updateRunMode(report) {
  const combined = isCombinedReport(report);
  document.getElementById("single-page-actions").hidden = combined;
  document.getElementById("combined-run-panel").hidden = !combined;
  if (!combined) {
    resetCombinedSession();
  }
}

async function openCurrentCombinedSource(webview) {
  const state = combinedSession?.states[combinedSession.currentIndex];
  if (!state) {
    document.getElementById("confirm-combined-source").disabled = true;
    document.getElementById("skip-combined-source").disabled = true;
    document.getElementById("export-combined").disabled = false;
    renderCombinedStatus();
    return;
  }

  const sourceReport = getReportById(state.source.reportId);
  state.status = "collecting";
  document.getElementById("confirm-combined-source").disabled = true;
  document.getElementById("skip-combined-source").disabled = false;
  document.getElementById("capture-status").textContent =
    `正在采集：${state.source.label}。请在页面内触发目标接口。`;
  webview.setAttribute("src", sourceReport.pageUrl);
  renderCombinedStatus();
}

async function startCombinedCollection(webview) {
  const raw = activeReport?.raw || {};
  const sources = raw.sources || [];

  if (!isCombinedReport(activeReport) || sources.length === 0) {
    document.getElementById("combined-progress").textContent =
      "请先保存至少包含一个来源的组合报表配置。";
    return;
  }

  await window.desktopApp.clearCaptures({
    webContentsId: webview.getWebContentsId(),
    reportIds: sources.map((source) => source.reportId)
  });

  combinedSession = {
    currentIndex: 0,
    captures: {},
    states: sources.map((source) => ({
      source,
      status: "pending",
      queryDate: ""
    }))
  };

  document.getElementById("export-combined").disabled = true;
  await openCurrentCombinedSource(webview);
}

async function advanceCombinedCollection(webview, status) {
  const state = combinedSession?.states[combinedSession.currentIndex];
  if (!state) {
    return;
  }

  if (status === "skipped") {
    delete combinedSession.captures[state.source.reportId];
  }
  state.status = status;
  combinedSession.currentIndex += 1;
  await openCurrentCombinedSource(webview);
}

async function loadActiveReportIntoWebview(webview) {
  if (!activeReport) {
    return;
  }

  renderReportMeta(activeReport);
  fillForm(activeReport);
  updateRunMode(activeReport);
  resetCombinedSession();
  resetCaptureState("等待当前报表页面发出目标接口...");
  document.getElementById("export-status").textContent =
    "导出完成后会显示保存路径。";

  if (!isCombinedReport(activeReport) && activeReport.pageUrl) {
    webview.setAttribute("src", activeReport.pageUrl);
  }
}

function readFormReport() {
  const id = activeReport?.raw?.id || activeReport?.id || `report-${Date.now()}`;
  const name = formFields.name.value.trim();
  const pageUrl = formFields.pageUrl.value.trim();
  const requestMatch = formFields.requestMatch.value.trim();
  const fileNamePrefix = formFields.fileNamePrefix.value.trim();

  if (isCombinedReport(activeReport)) {
    return {
      id,
      type: "combined",
      name,
      description: formFields.description.value.trim(),
      fileNamePrefix,
      summarySheetName: formFields.combinedSummarySheetName.value.trim(),
      sources: readCombinedSources()
    };
  }

  const queryDatePath = formFields.queryDatePath.value.trim();
  const defaultDateOffsetText = formFields.defaultDateOffset.value.trim();
  const defaultDateOffset =
    defaultDateOffsetText === "" ? undefined : Number(defaultDateOffsetText);

  if (defaultDateOffset != null && !Number.isInteger(defaultDateOffset)) {
    throw new Error("默认日期偏移必须是整数。");
  }

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
    defaultDateOffset,
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
  formFields.combinedSummarySheetName = document.getElementById(
    "combined-summary-sheet-name"
  );
  formFields.targetCombinedReport = document.getElementById(
    "target-combined-report"
  );
  formFields.sourceSummarySheet = document.getElementById("source-summary-sheet");
  formFields.sourceSummaryColumns = document.getElementById(
    "source-summary-columns"
  );
  formFields.sourceIncludeDetails =
    document.getElementById("source-include-details");
  formFields.addToCombinedButton = document.getElementById("add-to-combined");
  formFields.addToCombinedStatus = document.getElementById(
    "add-to-combined-status"
  );

  const reportSelect = document.getElementById("report-select");
  const reloadButton = document.getElementById("reload-page");
  const openPageButton = document.getElementById("open-page");
  const exportButton = document.getElementById("export-report");
  const newReportButton = document.getElementById("new-report");
  const newCombinedReportButton = document.getElementById("new-combined-report");
  const saveReportButton = document.getElementById("save-report");
  const deleteReportButton = document.getElementById("delete-report");
  const resetDefaultsButton = document.getElementById("reset-defaults");
  const captureStatus = document.getElementById("capture-status");
  const exportStatus = document.getElementById("export-status");
  const configStatus = document.getElementById("config-status");
  const webview = document.getElementById("pdd-webview");
  const startCombinedButton = document.getElementById("start-combined");
  const confirmCombinedButton = document.getElementById("confirm-combined-source");
  const skipCombinedButton = document.getElementById("skip-combined-source");
  const exportCombinedButton = document.getElementById("export-combined");

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
    updateRunMode(blankReport);
    resetCombinedSession();
    configStatus.textContent = "已生成新报表草稿，填写后点击保存。";
    resetCaptureState("新报表草稿尚未保存。");
  });

  newCombinedReportButton.addEventListener("click", () => {
    const blankReport = createBlankCombinedReport();
    activeReport = blankReport;
    fillForm(blankReport);
    renderReportMeta(blankReport);
    updateRunMode(blankReport);
    resetCombinedSession();
    configStatus.textContent =
      "已生成组合报表草稿，保存后即可从单页报表加入数据。";
    resetCaptureState("组合报表草稿尚未保存。");
  });

  formFields.targetCombinedReport.addEventListener("change", () => {
    renderAssociationEditor();
  });

  formFields.sourceSummarySheet.addEventListener("change", () => {
    renderAssociationColumns();
  });

  formFields.sheetsJson.addEventListener("input", () => {
    if (!isCombinedReport(activeReport)) {
      renderAssociationEditor();
    }
  });

  formFields.addToCombinedButton.addEventListener("click", async () => {
    try {
      if (!activeReport || isCombinedReport(activeReport)) {
        return;
      }

      const targetCombinedId = formFields.targetCombinedReport.value;
      if (!targetCombinedId) {
        throw new Error("请先新建并保存一个组合报表。");
      }

      const summarySheetName = formFields.sourceSummarySheet.value;
      const columns = [
        ...formFields.sourceSummaryColumns.querySelectorAll("input:checked")
      ].map((checkbox) => checkbox.value);

      if (!summarySheetName || columns.length === 0) {
        throw new Error("请选择汇总 Sheet，并至少勾选一个汇总字段。");
      }

      const report = readFormReport();
      const previousReportId = getReportById(activeReport.id)?.id;
      let newConfig = await window.desktopApp.saveReport({
        report,
        previousReportId
      });
      await replaceConfig(newConfig);

      const targetCombined = getReportById(targetCombinedId);
      if (!targetCombined) {
        throw new Error("目标组合报表不存在，请重新选择。");
      }

      const combinedRaw = JSON.parse(JSON.stringify(targetCombined.raw));
      const source = {
        label: report.name,
        reportId: report.id,
        summarySheetName,
        columns,
        includeDetails: formFields.sourceIncludeDetails.checked
      };

      const sourceIndex = combinedRaw.sources.findIndex(
        (item) => item.reportId === report.id
      );
      if (sourceIndex >= 0) {
        combinedRaw.sources[sourceIndex] = source;
      } else {
        combinedRaw.sources.push(source);
      }

      newConfig = await window.desktopApp.saveReport({
        report: combinedRaw,
        previousReportId: targetCombined.id
      });
      await replaceConfig(newConfig);

      activeReport = getReportById(report.id);
      reportSelect.value = activeReport.id;
      await loadActiveReportIntoWebview(webview);
      formFields.targetCombinedReport.value = targetCombinedId;
      renderAssociationEditor();

      formFields.addToCombinedStatus.textContent = `已加入组合报表：${targetCombined.name}`;
      configStatus.textContent = `已保存配置：${activeReport.name}`;
    } catch (error) {
      formFields.addToCombinedStatus.textContent = `加入失败：${error.message}`;
    }
  });

  saveReportButton.addEventListener("click", async () => {
    try {
      const report = readFormReport();
      const previousReportId = getReportById(activeReport?.id)?.id;
      const newConfig = await window.desktopApp.saveReport({
        report,
        previousReportId
      });
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
    try {
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
    } catch (error) {
      configStatus.textContent = `删除失败：${error.message}`;
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

  startCombinedButton.addEventListener("click", async () => {
    await startCombinedCollection(webview);
  });

  confirmCombinedButton.addEventListener("click", async () => {
    const state = combinedSession?.states[combinedSession.currentIndex];
    if (state?.status !== "captured") {
      return;
    }
    await advanceCombinedCollection(webview, "confirmed");
  });

  skipCombinedButton.addEventListener("click", async () => {
    await advanceCombinedCollection(webview, "skipped");
  });

  exportCombinedButton.addEventListener("click", async () => {
    if (!combinedSession || !isCombinedReport(activeReport)) {
      return;
    }

    exportCombinedButton.disabled = true;
    exportStatus.textContent = "正在导出组合 Excel...";
    try {
      const result = await window.desktopApp.exportReport({
        reportId: activeReport.id,
        captures: combinedSession.captures
      });
      exportStatus.textContent = result.canceled
        ? "已取消导出。"
        : `导出完成：${result.filePath}`;
    } catch (error) {
      exportStatus.textContent = `导出失败：${error.message}`;
    } finally {
      exportCombinedButton.disabled = false;
    }
  });

  webview.addEventListener("did-start-loading", () => {
    captureStatus.textContent = "页面加载中，等待目标接口返回...";
  });

  window.desktopApp.onCaptureStatus(async (payload) => {
    if (!activeReport) {
      return;
    }

    if (isCombinedReport(activeReport)) {
      const state = combinedSession?.states[combinedSession.currentIndex];
      if (!state || payload?.reportId !== state.source.reportId) {
        return;
      }

      if (!payload?.ok) {
        captureStatus.textContent = payload?.message || "接口监听异常。";
        return;
      }

      const capture = await window.desktopApp.getLatestCapture({
        webContentsId: webview.getWebContentsId(),
        reportId: state.source.reportId
      });

      if (!capture) {
        captureStatus.textContent =
          "已命中目标接口，但暂时拿不到响应体。";
        return;
      }

      combinedSession.captures[state.source.reportId] = capture;
      state.status = "captured";
      state.queryDate = capture.queryDate;
      captureStatus.textContent = `已捕获 ${state.source.label}，确认后进入下一来源，或选择跳过。`;
      confirmCombinedButton.disabled = false;
      renderCombinedStatus();
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
