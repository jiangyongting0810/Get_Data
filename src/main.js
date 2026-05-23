const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const XLSX = require("xlsx");

const PDD_ENTRY_URL =
  "https://mms.pinduoduo.com/sycm/stores_data/operation?currentKey=payOrdrAmt";

let mainWindow;
const tradeCaptureCache = new Map();
const pendingTradeRequests = new Map();

function isTargetTradeRequest(url) {
  return typeof url === "string" && url.includes("/sydney/api/mallTrade/queryMallTradeList");
}

async function attachTradeDebugger(webContents) {
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

      if (isTargetTradeRequest(response?.url)) {
        pendingTradeRequests.set(requestId, response.url);
      }
      return;
    }

    if (method === "Network.loadingFinished") {
      const requestId = params?.requestId;

      if (!pendingTradeRequests.has(requestId)) {
        return;
      }

      const requestUrl = pendingTradeRequests.get(requestId);
      pendingTradeRequests.delete(requestId);

      try {
        const bodyResult = await webContents.debugger.sendCommand(
          "Network.getResponseBody",
          { requestId }
        );

        const bodyText = bodyResult?.base64Encoded
          ? Buffer.from(bodyResult.body, "base64").toString("utf8")
          : bodyResult.body;

        const data = JSON.parse(bodyText);
        tradeCaptureCache.set(webContents.id, {
          data,
          capturedAt: new Date().toISOString(),
          url: requestUrl,
          queryDate: getQueryDateFromTradeData(data)
        });

        mainWindow?.webContents.send("trade:capture-status", {
          ok: true,
          queryDate: getQueryDateFromTradeData(data)
        });
      } catch (error) {
        mainWindow?.webContents.send("trade:capture-status", {
          ok: false,
          message: `读取接口响应失败：${error.message}`
        });
      }
    }
  });

  webContents.once("destroyed", () => {
    tradeCaptureCache.delete(webContents.id);
  });
}

function getQueryDateFromTradeData(data) {
  const yesterdayList = data?.result?.yesterdayRtList;
  if (!Array.isArray(yesterdayList) || yesterdayList.length === 0) {
    return "";
  }

  const datedItem = yesterdayList.find((item) => item?.stateDate);
  if (datedItem?.stateDate) {
    return datedItem.stateDate;
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 1);
  return fallback.toISOString().slice(0, 10);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
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
      await attachTradeDebugger(webContents);
    } catch (error) {
      mainWindow?.webContents.send("trade:capture-status", {
        ok: false,
        message: `网络监听启动失败：${error.message}`
      });
    }
  });
}

app.whenReady().then(() => {
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

ipcMain.handle("app:get-config", async () => {
  return {
    pddEntryUrl: PDD_ENTRY_URL
  };
});

function formatPercent(value) {
  if (typeof value !== "number") {
    return "";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function normalizeDate(requestBody) {
  if (requestBody && typeof requestBody === "object" && requestBody.queryDate) {
    return requestBody.queryDate;
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 1);
  return fallback.toISOString().slice(0, 10);
}

function buildSummaryRows(data, queryDate) {
  const cumulativeList = data?.result?.yesterdayRtList;
  const summary = Array.isArray(cumulativeList)
    ? cumulativeList[cumulativeList.length - 1]
    : null;

  if (!summary) {
    throw new Error("昨天汇总数据不存在。");
  }

  return [
    {
      日期: queryDate,
      成交金额: summary.payOrdrAmt ?? "",
      成交订单数: summary.payOrdrCnt ?? "",
      成交买家数: summary.payOrdrUsrCnt ?? "",
      客单价: summary.payOrdrAup ?? "",
      成交转化率: formatPercent(summary.payUvRto),
      成交老买家占比: formatPercent(summary.rpayUsrRtoDth)
    }
  ];
}

function buildHourlyRows(data, queryDate) {
  const hourlyList = data?.result?.yesterdayPerHourRtList;

  if (!Array.isArray(hourlyList)) {
    throw new Error("昨天小时明细不存在。");
  }

  return hourlyList.map((item) => ({
    日期: queryDate,
    小时: item.hr ?? "",
    小时订单数: item.payOrdrCnt ?? "",
    小时买家数: item.payOrdrUsrCnt ?? "",
    小时成交金额: item.payOrdrAmt ?? ""
  }));
}

ipcMain.handle("report:export-yesterday", async (_event, payload) => {
  const data = payload?.data;
  const queryDate = normalizeDate(payload);

  if (!data?.success) {
    throw new Error("当前没有可导出的拼多多昨天数据。");
  }

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(
    buildSummaryRows(data, queryDate)
  );
  XLSX.utils.book_append_sheet(workbook, summarySheet, "昨日汇总");

  const hourlySheet = XLSX.utils.json_to_sheet(
    buildHourlyRows(data, queryDate)
  );
  XLSX.utils.book_append_sheet(workbook, hourlySheet, "昨日小时明细");

  const defaultPath = path.join(
    app.getPath("downloads"),
    `pdd-yesterday-report-${queryDate || "unknown"}.xlsx`
  );

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "导出拼多多昨日交易概况",
    defaultPath,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  XLSX.writeFile(workbook, filePath);

  return {
    canceled: false,
    filePath
  };
});

ipcMain.handle("trade:get-latest-capture", async (_event, payload) => {
  const webContentsId = payload?.webContentsId;

  if (!webContentsId || !tradeCaptureCache.has(webContentsId)) {
    return null;
  }

  return tradeCaptureCache.get(webContentsId);
});
