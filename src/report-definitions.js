const defaultReportDefinitions = [
  {
    id: "pdd-yesterday-trade-overview",
    name: "拼多多昨日交易概况",
    description: "交易概况页面，导出昨日汇总和昨日小时明细。",
    pageUrl:
      "https://mms.pinduoduo.com/sycm/stores_data/operation?currentKey=payOrdrAmt",
    requestMatch: "/sydney/api/mallTrade/queryMallTradeList",
    fileNamePrefix: "pdd-yesterday-trade-overview",
    queryDatePath: "result.yesterdayRtList.0.stateDate",
    defaultDateOffset: -1,
    sheets: [
      {
        name: "昨日汇总",
        mode: "last",
        sourcePath: "result.yesterdayRtList",
        columns: [
          { title: "日期", value: "$queryDate" },
          { title: "成交金额", path: "payOrdrAmt" },
          { title: "成交订单数", path: "payOrdrCnt" },
          { title: "成交买家数", path: "payOrdrUsrCnt" },
          { title: "客单价", path: "payOrdrAup" },
          { title: "成交转化率", path: "payUvRto", format: "percent" },
          { title: "成交老买家占比", path: "rpayUsrRtoDth", format: "percent" }
        ]
      },
      {
        name: "昨日小时明细",
        mode: "list",
        sourcePath: "result.yesterdayPerHourRtList",
        columns: [
          { title: "日期", value: "$queryDate" },
          { title: "小时", path: "hr" },
          { title: "小时订单数", path: "payOrdrCnt" },
          { title: "小时买家数", path: "payOrdrUsrCnt" },
          { title: "小时成交金额", path: "payOrdrAmt" }
        ]
      }
    ]
  }
];

module.exports = {
  defaultReportDefinitions
};
