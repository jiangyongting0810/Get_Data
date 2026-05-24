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
  return value.toISOString().slice(0, 10);
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

function matchReportByUrl(url) {
  return activeReports.find(
    (definition) =>
      typeof definition.requestMatch === "string" &&
      definition.requestMatch &&
      url.includes(definition.requestMatch)
  );
}

function buildSheetRows(sheetDefinition, capture) {
  const sourceValue = getByPath(capture.data, sheetDefinition.sourcePath);
  const rows =
    sheetDefinition.mode === "last"
      ? Array.isArray(sourceValue) && sourceValue.length > 0
        ? [sourceValue[sourceValue.length - 1]]
        : []
      : Array.isArray(sourceValue)
        ? sourceValue
        : [];

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

async function attachWebviewDebugger(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }

  if (!webContents.debugger.isAttached()) {
    webContents.debugger.attach("1.3");
  }

  await webContents.debugger.sendCommand("Network.enable");

  webContents.debugger.on("message", async (_event, method, params) => {
    if (method === "Network.responseReceived") {
      const { requestId, response } = params;
      const reportDefinition = matchReportByUrl(response?.url || "");

      if (reportDefinition) {
        pendingRequestMap.set(requestId, {
          url: response.url,
          reportId: reportDefinition.id
        });
      }
      return;
    }

    if (method !== "Network.loadingFinished") {
      return;
    }

    const requestId = params?.requestId;
    if (!pendingRequestMap.has(requestId)) {
      return;
    }

    const pending = pendingRequestMap.get(requestId);
    pendingRequestMap.delete(requestId);

    try {
      const bodyResult = await webContents.debugger.sendCommand(
        "Network.getResponseBody",
        { requestId }
      );

      const bodyText = bodyResult?.base64Encoded
        ? Buffer.from(bodyResult.body, "base64").toString("utf8")
        : bodyResult.body;
      const data = JSON.parse(bodyText);
      const reportDefinition = getReportDefinitionMap()[pending.reportId];

      if (!reportDefinition) {
        return;
      }

      const capture = {
        reportId: pending.reportId,
        url: pending.url,
        capturedAt: new Date().toISOString(),
        queryDate: getCaptureDate(reportDefinition, data),
        data
      };

      captureCache.set(`${webContents.id}:${pending.reportId}`, capture);

      mainWindow?.webContents.send("capture:status", {
        ok: true,
        reportId: pending.reportId,
        queryDate: capture.queryDate,
        reportName: reportDefinition.name
      });
    } catch (error) {
      mainWindow?.webContents.send("capture:status", {
        ok: false,
        reportId: pending.reportId,
        message: `读取接口响应失败：${error.message}`
      });
    }
  });

  webContents.once("destroyed", () => {
    for (const key of [...captureCache.keys()]) {
      if (key.startsWith(`${webContents.id}:`)) {
        captureCache.delete(key);
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

  const requiredFields = ["id", "name", "pageUrl", "requestMatch", "fileNamePrefix"];
  for (const field of requiredFields) {
    if (!report[field] || typeof report[field] !== "string") {
      throw new Error(`报表字段 ${field} 必填。`);
    }
  }

  if (!Array.isArray(report.sheets) || report.sheets.length === 0) {
    throw new Error("至少需要一个 Sheet 配置。");
  }
}

function listReportsForRenderer() {
  return activeReports.map((definition) => ({
    id: definition.id,
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

ipcMain.handle("report:export", async (_event, payload) => {
  const reportDefinition = getReportDefinitionMap()[payload?.reportId];
  if (!reportDefinition) {
    throw new Error("未找到对应的报表配置。");
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
  const report = clone(payload?.report);
  validateReportDefinition(report);

  const index = activeReports.findIndex((item) => item.id === report.id);
  if (index >= 0) {
    activeReports[index] = report;
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
