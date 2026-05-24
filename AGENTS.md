# AGENTS.md

本文件用于约束在本仓库内工作的 AI 代理、自动化助手和协作者。目标不是介绍产品，而是减少误改、重复劳动和无效重构，让后续工作优先沿着当前项目的真实结构推进。

---

## 1. 项目目标

本项目是一个 Windows 桌面工具，当前主要目标是：

- 让用户在 Electron 内嵌页面中登录拼多多商家后台
- 监听页面真实发出的接口请求与响应
- 根据报表配置把接口响应导出为 Excel
- 允许用户在软件内维护报表配置，而不是每次都改代码

当前重点不是做通用爬虫框架，也不是做多平台统一系统。  
当前重点是：**把拼多多后台报表导出这条链路做稳，并把新增报表的成本降下来。**

---

## 2. 当前技术栈

- Node.js
- Electron
- xlsx
- 原生 HTML / CSS / JS

当前没有使用：

- React
- Vue
- TypeScript
- 数据库

除非用户明确要求，或现有结构已经不足以支撑需求，否则不要主动引入新的大型框架。

---

## 3. 关键目录与职责

### 根目录

- `package.json`
  - 项目依赖
  - Electron 入口
  - 打包脚本

- `package-lock.json`
  - 锁定依赖版本

- `AGENTS.md`
  - 当前文件，代理约束说明

### `src/`

- `src/main.js`
  - Electron 主进程
  - 创建窗口
  - 挂载 webview 网络监听
  - 读取和保存本地报表配置
  - Excel 导出逻辑

- `src/preload.js`
  - 渲染进程与主进程之间的桥接层
  - 只暴露前端需要的最小 IPC 能力

- `src/report-definitions.js`
  - 默认报表定义
  - 当本地 `reports.json` 不存在或损坏时回退使用

- `src/renderer/index.html`
  - 软件主界面

- `src/renderer/renderer.js`
  - 前端交互逻辑
  - 配置编辑
  - 报表选择
  - 运行面板状态联动

- `src/renderer/styles.css`
  - 主界面样式

---

## 4. 配置存储原则

本项目当前采用两层配置来源：

### 默认配置

位于：

- `src/report-definitions.js`

用途：

- 作为首次启动时的默认报表集合
- 作为本地配置损坏时的回退配置

### 用户本地配置

位于 Electron `userData` 目录下的：

- `reports.json`

用途：

- 软件内“配置中心”的真实持久化来源
- 用户新增、编辑、删除报表后，写入这里

约束：

- 不要把运行中生成的 `reports.json` 写回项目源码目录
- 不要把用户本地配置和默认配置混写在一起
- 修改配置读取逻辑时，必须保留“默认配置回退”能力

---

## 5. 报表定义结构

每个报表定义当前应至少包含以下字段：

- `id`
- `name`
- `description`
- `pageUrl`
- `requestMatch`
- `fileNamePrefix`
- `queryDatePath`
- `defaultDateOffset`
- `sheets`

### 字段说明

- `id`
  - 唯一标识
  - 保存、删除、匹配缓存时都依赖它
  - 一旦用户已有本地配置，不要轻易改旧 ID

- `name`
  - UI 展示名称

- `description`
  - UI 描述

- `pageUrl`
  - 程序切换到该报表时应打开的页面

- `requestMatch`
  - 用于匹配接口 URL 的关键词
  - 当前捕获逻辑依赖 `url.includes(requestMatch)`
  - 不要写得过短，否则容易误匹配

- `fileNamePrefix`
  - 导出 Excel 默认文件名前缀

- `queryDatePath`
  - 从响应 JSON 中提取报表日期的路径

- `defaultDateOffset`
  - 当 `queryDatePath` 取不到值时使用
  - 例如 `-1` 表示昨天

- `sheets`
  - Excel Sheet 定义数组

### 每个 Sheet 至少包含

- `name`
- `mode`
- `sourcePath`
- `columns`

### Sheet 字段说明

- `name`
  - Excel sheet 名

- `mode`
  - `list`：导出数组全部项
  - `last`：导出数组最后一项

- `sourcePath`
  - 响应 JSON 中的数组路径

- `columns`
  - Excel 列定义

### 每个 Column 常见字段

- `title`
- `path`
- `value`
- `format`

说明：

- `title`：Excel 列名
- `path`：从行对象里取值的路径
- `value: "$queryDate"`：直接使用捕获出的查询日期
- `format: "percent"`：把数值按百分比文本格式输出

---

## 6. 修改优先级

新增功能时，遵循以下优先级：

1. 能通过新增或修改报表配置解决的，优先只改配置
2. 配置无法表达的，再改 `renderer.js`
3. 只有捕获逻辑、导出逻辑、配置读写逻辑不够时，才改 `main.js`

换句话说：

- **不要每加一个报表就重写主流程**
- **不要把本应属于配置的数据再次写死进代码**

---

## 7. UI 改动原则

当前 UI 重点是“能配置、能运行、能导出”，不是做复杂视觉系统。

允许做的增强：

- 提高配置编辑可用性
- 增强状态提示
- 增加最近捕获记录预览
- 增加字段路径辅助
- 增加 Sheet / Column 可视化编辑器

不建议无端做的事：

- 全量重写样式体系
- 为了“更现代”引入前端框架
- 在没有需求的前提下做复杂动画和组件系统

如果要调整界面结构，优先保证：

- 左侧配置区仍然容易操作
- 右侧运行区仍然保留内嵌页面
- 导出按钮与当前报表状态联动清晰

---

## 8. 网络捕获相关约束

当前实现依赖 Electron 的 debugger 网络监听，而不是页面内 monkey patch。

这是一个明确设计选择，原因是：

- 页面内劫持 `fetch/XHR` 不够稳定
- 后台页面实现可能变化
- Electron 网络层更接近真实请求

因此：

- 不要轻易退回到前端页面内重写 `fetch/XHR` 的方案
- 如果抓不到数据，优先检查 `requestMatch` 和目标页面是否真的发出了接口
- 修改捕获逻辑时，优先保持“响应体抓取”和“按报表 ID 缓存”这两条主线

当前缓存逻辑依赖：

- `webContents.id`
- `reportId`

不要把不同报表的捕获结果混在一起。

---

## 9. 导出逻辑约束

Excel 导出目前由 `xlsx` 完成。

修改导出逻辑时必须注意：

- 保持 sheet 顺序按配置数组顺序输出
- 不要默默丢弃空 sheet，应该抛出明确错误
- 百分比格式目前输出为文本，这个行为如果要改，需要确认旧报表是否受影响
- 默认文件名应继续包含：
  - 报表前缀
  - 日期

如果用户要求导出样式增强，可以做：

- 列宽设置
- 表头加粗
- 单元格格式优化

但不要先为了“美观”破坏现有可用性。

---

## 10. 新增报表的推荐流程

新增一个报表时，优先按这个顺序进行：

1. 确认页面 URL
2. 确认目标接口 URL 关键词
3. 确认返回 JSON 样本
4. 确认日期字段路径
5. 确认需要导出的 sheet 结构
6. 确认每列字段路径
7. 先写配置，再验证导出

如果只是新增报表，不要第一时间改主进程代码。

---

## 11. 调试顺序

如果“页面能打开，但抓不到数据”，按下面顺序排查：

1. 页面是否真的发出了目标接口
2. `requestMatch` 是否能命中目标 URL
3. 当前选中的报表是否与接口对应
4. 是否切错了页面或页面尚未加载到触发接口的状态

如果“抓到数据，但导出失败”，按下面顺序排查：

1. `sourcePath` 是否正确
2. `mode` 是否正确
3. `columns.path` 是否正确
4. 某个 sheet 是否实际为空

如果“软件内配置保存失败”，按下面顺序排查：

1. `id/name/pageUrl/requestMatch/fileNamePrefix` 是否为空
2. `sheets JSON` 是否是合法 JSON
3. `sheets` 是否至少有一个 sheet
4. 本地 `reports.json` 是否可写

---

## 12. 编码与文本注意事项

当前仓库已经出现过中文乱码迹象。后续修改时需要特别注意：

- 默认使用 UTF-8
- 不要用错误编码重新写入文件
- 改中文文案时，尽量一次性修完整块文本，避免新旧乱码混杂

如果发现某个文件中的中文已经乱码：

- 不要只修一两句
- 尽量顺手把该文件的界面文案整体恢复为正常中文

---

## 13. 文件修改策略

优先修改这些文件的职责边界：

- 报表默认值：`src/report-definitions.js`
- 配置读写与导出：`src/main.js`
- IPC 桥接：`src/preload.js`
- 配置中心交互：`src/renderer/renderer.js`
- 页面结构：`src/renderer/index.html`
- 样式：`src/renderer/styles.css`

不要把：

- 大量业务配置硬塞进 `renderer.js`
- 导出逻辑搬进前端
- 配置校验散落在多个文件里

---

## 14. 不要做的事

除非用户明确要求，否则不要：

- 引入 React / Vue / TypeScript
- 把项目重构成复杂工程化结构
- 改写为服务端架构
- 引入数据库
- 提交 `node_modules`
- 提交 `dist`
- 破坏当前已可用的导出链路

也不要为了“代码更漂亮”而做大范围无收益重构。

---

## 15. Git 与提交规则

提交时遵循：

- 小步提交
- 只提交和当前任务直接相关的文件
- 提交信息写清楚功能点

推荐提交信息风格：

- `Add in-app report configuration editor`
- `Make report export config-driven`
- `Fix capture matching for report definitions`

不推荐：

- `update`
- `fix bug`
- `change files`

---

## 16. 交付前最低检查

每次改完至少检查：

1. `node --check src/main.js`
2. `node --check src/preload.js`
3. `node --check src/renderer/renderer.js`
4. 关键路径是否仍然存在：
   - 读配置
   - 选报表
   - 打开页面
   - 捕获接口
   - 导出 Excel

如果当前环境无法做 GUI 实机验证，需要明确告诉用户：

- 哪些检查做了
- 哪些 GUI 行为还需要用户本机确认

---

## 17. 后续推荐方向

如果继续演进，优先级建议如下：

1. 修复和清理现有中文乱码文案
2. 把 `sheets JSON` 编辑升级为可视化编辑
3. 增加“最近捕获接口响应预览”
4. 增加“从捕获 JSON 辅助生成字段路径”
5. 增加报表导入 / 导出配置

在这些完成之前，不建议过早扩展到很多平台。

---

## 18. 面向未来代理的结论

接手本仓库时，默认做法应当是：

- 先理解当前报表配置结构
- 先看是否能通过配置解决问题
- 只有在配置表达不了需求时，才动主逻辑
- 保持“内嵌页面 -> 捕获接口 -> 配置导出 Excel”这条主线稳定

本仓库不是通用模板仓库。  
请以“稳住可用功能、降低新增报表成本”为第一原则。
