const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const XLSX = require("xlsx");
const { defaultReportDefinitions } = require("./report-definitions");

let mainWindow;
let activeReports = [];

const captureCache = new Map();
const pendingRequestMap = new Map();

function getReportsConfigPath() {
  return path.join(app.getPath("userData"), "reports.json");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadReportsFromDisk() {
  const configPath = getReportsConfigPath();

  if (!fs.existsSync(configPath)) {
    activeReports = clone(defaultReportDefinitions);
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    activeReports = Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : clone(defaultReportDefinitions);
  } catch (_error) {
    activeReports = clone(defaultReportDefinitions);
  }
}

function saveReportsToDisk() {
  const configPath = getReportsConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(activeReports, null, 2), "utf8");
}

function getReportDefinitionMap() {
  return Object.fromEntries(activeReports.map((report) => [report.id, report]));
}

function isCombinedReport(report) {
  return report?.type === "combined";
}

function getByPath(target, pathExpression) {
  if (!pathExpression) {
    return target;
  }

  return String(pathExpression)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => {
      if (current == null) {
        return undefined;
      }

      return current[key];
    }, target);
}

function formatValue(value, column) {
  if (value == null) {
    return "";
  }

  if (column.format === "percent" && typeof value === "number") {
    return `${(value * 100).toFixed(2)}%`;
  }

  return value;
}

function fallbackDate(offsetDays) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCaptureDate(reportDefinition, responseData) {
  const pathValue = getByPath(responseData, reportDefinition.queryDatePath);
  if (pathValue) {
    return pathValue;
  }

  if (reportDefinition.defaultDateOffset != null) {
    return fallbackDate(reportDefinition.defaultDateOffset);
  }

  return fallbackDate(-1);
}

function matchReportsByUrl(url) {
  return activeReports.filter(
    (definition) =>
      !isCombinedReport(definition) &&
      typeof definition.requestMatch === "string" &&
      definition.requestMatch &&
      url.includes(definition.requestMatch)
  );
}

function buildSheetRows(sheetDefinition, capture) {
  const sourceValue = getByPath(capture.data, sheetDefinition.sourcePath);
  let rows = [];

  if (sheetDefinition.mode === "object") {
    if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)) {
      rows = [sourceValue];
    }
  } else if (sheetDefinition.mode === "last") {
    if (Array.isArray(sourceValue) && sourceValue.length > 0) {
      rows = [sourceValue[sourceValue.length - 1]];
    }
  } else if (Array.isArray(sourceValue)) {
    rows = sourceValue;
  }

  if (rows.length === 0) {
    throw new Error(`Sheet ${sheetDefinition.name} 没有可导出的数据。`);
  }

  return rows.map((row) => {
    const result = {};

    for (const column of sheetDefinition.columns) {
      const value =
        column.value === "$queryDate"
          ? capture.queryDate
          : getByPath(row, column.path);

      result[column.title] = formatValue(value, column);
    }

    return result;
  });
}

function buildWorkbook(reportDefinition, capture) {
  const workbook = XLSX.utils.book_new();

  for (const sheetDefinition of reportDefinition.sheets || []) {
    const rows = buildSheetRows(sheetDefinition, capture);
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetDefinition.name);
  }

  return workbook;
}

function createEmptySheet(columns) {
  const headers = (columns || []).map((column) => column.title);
  return XLSX.utils.aoa_to_sheet([headers]);
}

function getUniqueSheetName(baseName, usedNames) {
  const sanitizedName = String(baseName || "Sheet").replace(/[\\/?*[\]:]/g, "-");
  let candidate = sanitizedName.slice(0, 31) || "Sheet";
  let suffixIndex = 1;

  while (usedNames.has(candidate)) {
    const suffix = `-${suffixIndex}`;
    candidate = `${sanitizedName.slice(0, 31 - suffix.length)}${suffix}`;
    suffixIndex += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function buildCombinedWorkbook(reportDefinition, capturesByReportId = {}) {
  const workbook = XLSX.utils.book_new();
  const reportDefinitionMap = getReportDefinitionMap();
  const summaryRow = {};
  const usedSheetNames = new Set();

  for (const source of reportDefinition.sources) {
    const sourceReport = reportDefinitionMap[source.reportId];
    const summarySheet = sourceReport.sheets.find(
      (sheet) => sheet.name === source.summarySheetName
    );
    const capture = capturesByReportId[source.reportId];
    const selectedTitles = new Set(source.columns);
    const selectedColumns = summarySheet.columns.filter((column) =>
      column.value !== "$queryDate" && selectedTitles.has(column.title)
    );
    const emptySummaryRow = Object.fromEntries(
      selectedColumns.map((column) => [column.title, ""])
    );
    const sourceSummaryRow = capture
      ? buildSheetRows(summarySheet, capture)[0] || emptySummaryRow
      : emptySummaryRow;

    summaryRow[`${source.label}-日期`] = capture?.queryDate || "";
    for (const column of selectedColumns) {
      summaryRow[`${source.label}-${column.title}`] = sourceSummaryRow[column.title];
    }
  }

  const summaryName = getUniqueSheetName(
    reportDefinition.summarySheetName || "汇总",
    usedSheetNames
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([summaryRow]),
    summaryName
  );

  for (const source of reportDefinition.sources) {
    if (!source.includeDetails) {
      continue;
    }

    const sourceReport = reportDefinitionMap[source.reportId];
    const capture = capturesByReportId[source.reportId];
    for (const sheetDefinition of sourceReport.sheets) {
      if (sheetDefinition.name === source.summarySheetName) {
        continue;
      }

      const sheet = capture
        ? XLSX.utils.json_to_sheet(buildSheetRows(sheetDefinition, capture))
        : createEmptySheet(sheetDefinition.columns);
      const sheetName = getUniqueSheetName(
        `${source.label}-${sheetDefinition.name}`,
        usedSheetNames
      );
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    }
  }

  return workbook;
}

async function attachWebviewDebugger(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }

  if (!webContents.debugger.isAttached()) {
    webContents.debugger.attach("1.3");
  }

  await webContents.debugger.sendCommand("Network.enable");

  webContents.debugger.on("message", async (_event, method, params) => {
    const requestId = params?.requestId;
    const pendingKey = `${webContents.id}:${requestId}`;

    if (method === "Network.responseReceived") {
      const { response } = params;
      const matchedReports = matchReportsByUrl(response?.url || "");

      if (matchedReports.length > 0) {
        pendingRequestMap.set(pendingKey, {
          url: response.url,
          reportIds: matchedReports.map((report) => report.id)
        });
      }
      return;
    }

    if (method === "Network.loadingFailed") {
      pendingRequestMap.delete(pendingKey);
      return;
    }

    if (method !== "Network.loadingFinished") {
      return;
    }

    if (!pendingRequestMap.has(pendingKey)) {
      return;
    }

    const pending = pendingRequestMap.get(pendingKey);
    pendingRequestMap.delete(pendingKey);

    try {
      const bodyResult = await webContents.debugger.sendCommand(
        "Network.getResponseBody",
        { requestId }
      );

      const bodyText = bodyResult?.base64Encoded
        ? Buffer.from(bodyResult.body, "base64").toString("utf8")
        : bodyResult.body;
      const data = JSON.parse(bodyText);
      const reportDefinitionMap = getReportDefinitionMap();

      for (const reportId of pending.reportIds) {
        const reportDefinition = reportDefinitionMap[reportId];
        if (!reportDefinition) {
          continue;
        }

        const capture = {
          reportId,
          url: pending.url,
          capturedAt: new Date().toISOString(),
          queryDate: getCaptureDate(reportDefinition, data),
          data
        };

        captureCache.set(`${webContents.id}:${reportId}`, capture);

        mainWindow?.webContents.send("capture:status", {
          ok: true,
          reportId,
          queryDate: capture.queryDate,
          reportName: reportDefinition.name
        });
      }
    } catch (error) {
      for (const reportId of pending.reportIds) {
        mainWindow?.webContents.send("capture:status", {
          ok: false,
          reportId,
          message: `读取接口响应失败：${error.message}`
        });
      }
    }
  });

  webContents.once("destroyed", () => {
    for (const key of [...captureCache.keys()]) {
      if (key.startsWith(`${webContents.id}:`)) {
        captureCache.delete(key);
      }
    }
    for (const key of [...pendingRequestMap.keys()]) {
      if (key.startsWith(`${webContents.id}:`)) {
        pendingRequestMap.delete(key);
      }
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1280,
    minHeight: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-attach-webview", async (_event, webContents) => {
    try {
      await attachWebviewDebugger(webContents);
    } catch (error) {
      mainWindow?.webContents.send("capture:status", {
        ok: false,
        message: `网络监听启动失败：${error.message}`
      });
    }
  });
}

function validateReportDefinition(report) {
  if (!report || typeof report !== "object") {
    throw new Error("报表配置不能为空。");
  }

  const requiredFields = ["id", "name", "fileNamePrefix"];
  for (const field of requiredFields) {
    if (typeof report[field] !== "string" || report[field].trim() === "") {
      throw new Error(`报表字段 ${field} 必填。`);
    }
  }

  if (report.description != null && typeof report.description !== "string") {
    throw new Error("报表字段 description 必须是文本。");
  }
  if (report.queryDatePath != null && typeof report.queryDatePath !== "string") {
    throw new Error("报表字段 queryDatePath 必须是文本。");
  }

  if (isCombinedReport(report)) {
    if (
      report.summarySheetName != null &&
      (typeof report.summarySheetName !== "string" || report.summarySheetName.trim() === "")
    ) {
      throw new Error("组合报表汇总 Sheet 名称不能为空。");
    }
    if (!Array.isArray(report.sources)) {
      throw new Error("组合报表数据来源配置无效。");
    }

    const sourceLabels = new Set();
    const sourceReportIds = new Set();
    const definitionMap = getReportDefinitionMap();
    for (const [sourceIndex, source] of report.sources.entries()) {
      const label = `第 ${sourceIndex + 1} 个数据来源`;
      if (!source || typeof source !== "object") {
        throw new Error(`${label} 配置无效。`);
      }
      if (typeof source.label !== "string" || source.label.trim() === "") {
        throw new Error(`${label} 名称必填。`);
      }
      if (sourceLabels.has(source.label)) {
        throw new Error(`数据来源名称不能重复：${source.label}。`);
      }
      sourceLabels.add(source.label);
      if (typeof source.reportId !== "string" || source.reportId.trim() === "") {
        throw new Error(`${label} 必须选择单页报表。`);
      }
      if (sourceReportIds.has(source.reportId)) {
        throw new Error(`组合报表中不能重复选择同一单页报表：${source.label}。`);
      }
      sourceReportIds.add(source.reportId);
      const sourceReport = definitionMap[source.reportId];
      if (!sourceReport || isCombinedReport(sourceReport)) {
        throw new Error(`${label} 引用的单页报表不存在。`);
      }
      const sourceSheet = sourceReport.sheets?.find(
        (sheet) => sheet.name === source.summarySheetName
      );
      if (!sourceSheet || !["last", "object"].includes(sourceSheet.mode)) {
        throw new Error(`${label} 必须选择 mode 为 last 或 object 的汇总 Sheet。`);
      }
      if (!Array.isArray(source.columns) || source.columns.length === 0) {
        throw new Error(`${label} 至少需要选择一个汇总字段。`);
      }
      if (
        source.columns.some(
          (title) =>
            !sourceSheet.columns.some(
              (column) => column.title === title && column.value !== "$queryDate"
            )
        )
      ) {
        throw new Error(`${label} 包含不存在的汇总字段。`);
      }
      if (typeof source.includeDetails !== "boolean") {
        throw new Error(`${label} 的附带明细选项无效。`);
      }
    }
    return;
  }

  for (const field of ["pageUrl", "requestMatch"]) {
    if (typeof report[field] !== "string" || report[field].trim() === "") {
      throw new Error(`报表字段 ${field} 必填。`);
    }
  }

  if (!Array.isArray(report.sheets) || report.sheets.length === 0) {
    throw new Error("至少需要一个 Sheet 配置。");
  }

  if (
    report.defaultDateOffset != null &&
    (!Number.isInteger(report.defaultDateOffset) || !Number.isFinite(report.defaultDateOffset))
  ) {
    throw new Error("默认日期偏移必须是整数。");
  }

  const sheetNames = new Set();
  for (const [sheetIndex, sheet] of report.sheets.entries()) {
    const label = `第 ${sheetIndex + 1} 个 Sheet`;
    if (!sheet || typeof sheet !== "object") {
      throw new Error(`${label} 配置无效。`);
    }
    if (!sheet.name || typeof sheet.name !== "string") {
      throw new Error(`${label} 名称必填。`);
    }
    if (sheet.name.length > 31 || /[\\/?*[\]:]/.test(sheet.name)) {
      throw new Error(`${label} 名称不符合 Excel 工作表命名规则。`);
    }
    if (sheetNames.has(sheet.name)) {
      throw new Error(`Sheet 名称不能重复：${sheet.name}。`);
    }
    sheetNames.add(sheet.name);

    if (!["list", "last", "object"].includes(sheet.mode)) {
      throw new Error(`${label} mode 仅支持 list、last 或 object。`);
    }
    if (!sheet.sourcePath || typeof sheet.sourcePath !== "string") {
      throw new Error(`${label} sourcePath 必填。`);
    }
    if (!Array.isArray(sheet.columns) || sheet.columns.length === 0) {
      throw new Error(`${label} 至少需要一列。`);
    }

    const columnTitles = new Set();
    for (const [columnIndex, column] of sheet.columns.entries()) {
      const columnLabel = `${label} 的第 ${columnIndex + 1} 列`;
      if (!column || typeof column !== "object") {
        throw new Error(`${columnLabel} 配置无效。`);
      }
      if (!column.title || typeof column.title !== "string") {
        throw new Error(`${columnLabel} title 必填。`);
      }
      if (columnTitles.has(column.title)) {
        throw new Error(`${label} 的列名不能重复：${column.title}。`);
      }
      columnTitles.add(column.title);

      const hasPath = typeof column.path === "string" && column.path.length > 0;
      const usesQueryDate = column.value === "$queryDate";
      if (!hasPath && !usesQueryDate) {
        throw new Error(`${columnLabel} 需要 path 或 value: "$queryDate"。`);
      }
      if (column.format != null && column.format !== "percent") {
        throw new Error(`${columnLabel} format 仅支持 percent。`);
      }
    }
  }
}

function listReportsForRenderer() {
  return activeReports.map((definition) => ({
    id: definition.id,
    type: definition.type || "single",
    name: definition.name,
    description: definition.description || "",
    pageUrl: definition.pageUrl,
    requestMatch: definition.requestMatch,
    fileNamePrefix: definition.fileNamePrefix,
    queryDatePath: definition.queryDatePath || "",
    defaultDateOffset:
      definition.defaultDateOffset == null ? "" : String(definition.defaultDateOffset),
    sheetNames: (definition.sheets || []).map((sheet) => sheet.name),
    raw: clone(definition)
  }));
}

app.whenReady().then(() => {
  loadReportsFromDisk();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:get-config", async () => ({
  reports: listReportsForRenderer(),
  reportsConfigPath: getReportsConfigPath()
}));

ipcMain.handle("capture:get-latest", async (_event, payload) => {
  const webContentsId = payload?.webContentsId;
  const reportId = payload?.reportId;

  if (!webContentsId || !reportId) {
    return null;
  }

  return captureCache.get(`${webContentsId}:${reportId}`) || null;
});

ipcMain.handle("capture:clear", async (_event, payload) => {
  const webContentsId = payload?.webContentsId;
  const reportIds = Array.isArray(payload?.reportIds) ? payload.reportIds : [];
  for (const reportId of reportIds) {
    captureCache.delete(`${webContentsId}:${reportId}`);
  }
  return { cleared: true };
});

ipcMain.handle("report:export", async (_event, payload) => {
  const reportDefinition = getReportDefinitionMap()[payload?.reportId];
  if (!reportDefinition) {
    throw new Error("未找到对应的报表配置。");
  }

  validateReportDefinition(reportDefinition);

  if (isCombinedReport(reportDefinition)) {
    const workbook = buildCombinedWorkbook(reportDefinition, payload?.captures);
    const defaultPath = path.join(
      app.getPath("downloads"),
      `${reportDefinition.fileNamePrefix}-${fallbackDate(0)}.xlsx`
    );
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `导出 ${reportDefinition.name}`,
      defaultPath,
      filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
    });
    if (canceled || !filePath) {
      return { canceled: true };
    }
    XLSX.writeFile(workbook, filePath);
    return { canceled: false, filePath };
  }

  if (!payload?.data?.success) {
    throw new Error("当前没有可导出的接口响应数据。");
  }

  const workbook = buildWorkbook(reportDefinition, payload);
  const defaultPath = path.join(
    app.getPath("downloads"),
    `${reportDefinition.fileNamePrefix}-${payload.queryDate || "unknown"}.xlsx`
  );

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: `导出 ${reportDefinition.name}`,
    defaultPath,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  XLSX.writeFile(workbook, filePath);
  return { canceled: false, filePath };
});

ipcMain.handle("reports:save", async (_event, payload) => {
  validateReportDefinition(payload?.report);
  const report = clone(payload.report);

  const previousReportId = payload?.previousReportId;
  if (previousReportId) {
    const previousIndex = activeReports.findIndex((item) => item.id === previousReportId);
    if (previousIndex < 0) {
      throw new Error("原报表配置已不存在，请重新选择后保存。");
    }
    if (
      report.id !== previousReportId &&
      activeReports.some((item) => item.id === report.id)
    ) {
      throw new Error(`报表 ID 已存在：${report.id}。`);
    }
    activeReports[previousIndex] = report;
  } else if (activeReports.some((item) => item.id === report.id)) {
    throw new Error(`报表 ID 已存在：${report.id}。`);
  } else {
    activeReports.push(report);
  }

  saveReportsToDisk();
  return {
    reports: listReportsForRenderer(),
    reportsConfigPath: getReportsConfigPath()
  };
});

ipcMain.handle("reports:delete", async (_event, payload) => {
  const reportId = payload?.reportId;
  const dependentReport = activeReports.find(
    (report) =>
      isCombinedReport(report) &&
      report.sources.some((source) => source.reportId === reportId)
  );
  if (dependentReport) {
    throw new Error(`该报表正被组合报表“${dependentReport.name}”使用，不能删除。`);
  }
  activeReports = activeReports.filter((item) => item.id !== reportId);

  if (activeReports.length === 0) {
    activeReports = clone(defaultReportDefinitions);
  }

  saveReportsToDisk();
  return {
    reports: listReportsForRenderer(),
    reportsConfigPath: getReportsConfigPath()
  };
});

ipcMain.handle("reports:reset-defaults", async () => {
  activeReports = clone(defaultReportDefinitions);
  saveReportsToDisk();
  return {
    reports: listReportsForRenderer(),
    reportsConfigPath: getReportsConfigPath()
  };
});
