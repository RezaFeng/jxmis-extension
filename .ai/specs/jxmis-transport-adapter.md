# JXMIS 页面传输 Adapter

## Why

`page-batch-approve.js`、`page-batch-weekly-approve.js`、`page-batch-work.js` 仍重复维护 `post`、`getWebapp`、`getBaseUrl`、`assertOk`、`fetchJson` 和 delay helper。前两轮已验证 UMD 共享脚本模式可行，本轮把跨页面脚本的传输/协议基础设施集中，降低三条自动化流程的 helper 漂移风险。

## What

交付一个共享的 JXMIS 页面传输 adapter：

- 新增 `jxmis-transport.js`，UMD 风格导出：浏览器挂载 `window.CwJxmisTransport`，Node 使用 `require("../jxmis-transport")`。
- 三个 page 脚本保留原 helper 名称作为 wrapper，内部委托 `window.CwJxmisTransport`。
- `content.js` 在所有 page script 前注入 `jxmis-transport.js`。
- `manifest.json` 将 `jxmis-transport.js` 加入 `web_accessible_resources`。
- 新增 Node 测试覆盖 adapter 行为，不做真实 JXMIS 请求。

完成标准：日报审批、批量报工、周报审核的业务函数和消息协议不变；fetch 行为统一；测试覆盖 base URL、message payload、HTTP 错误、网络错误、fetch options、delay 计算。

## Context

**Relevant files:**

- `page-batch-approve.js` — 日报审批页面脚本，当前有本地 `post`、`sleep`、`randomDelay`、`getWebapp`、`getBaseUrl`、`assertOk`。
- `page-batch-weekly-approve.js` — 周报审核页面脚本，当前有本地 transport helper 和 `fetchJson`。
- `page-batch-work.js` — 批量报工页面脚本，当前有本地 `post`、`getWebapp`、`getBaseUrl`、`assertOk`、`fetchJson`。
- `content.js` — 负责注入 page script；本轮需要确保 transport 早于三个 page script。
- `manifest.json` — 需要声明 `jxmis-transport.js` 为页面可访问资源。
- `wbs-plan.js`、`daily-actual.js` — UMD 共享模块和注入顺序参考。
- `test/wbs-plan.test.js`、`test/daily-actual.test.js` — Node 测试风格参考。
- `docs/项目架构优化建议.md` — 本轮来源：P1 “抽出 JXMIS 页面传输 adapter”。

**Patterns to follow:**

- 沿用 `wbs-plan.js` / `daily-actual.js` 的 UMD 风格。
- 页面脚本仍保持 IIFE 和原 helper 函数名，降低调用点变动。
- 使用 `node:test` + `node:assert/strict`，不引入依赖。
- 共享模块只做传输/协议基础设施，不承载业务 endpoint。

**Key decisions already made:**

- 只抽基础设施，不抽 `fetchCurrentUserId`、`fetchWeeklyById`、`fetchProjectPlanDetails`、`approveOne`、`runBatchWork` 等业务方法。
- `fetchJson` 统一采用更严格版本：`cache: "no-store"`，网络错误包含 `label` 和 `url`。
- 测试只用 fake window/fetch/response，不访问真实 JXMIS。
- 完成后独立提交，建议提交名：`refactor: add JXMIS transport adapter`。

## Constraints

**Must:**

- 修改现有 helper 前先做影响分析；如果 GitNexus/codebase-memory MCP 仍不可用，记录 fallback 到本地调用点搜索。
- 保持三个 page script 的业务入口、消息 type/source、请求 URL 参数组装不变。
- 保留原 helper 函数名，逐步委托到 `CwJxmisTransport`。
- `jxmis-transport.js` 必须在 `page-batch-approve.js`、`page-batch-weekly-approve.js`、`page-batch-work.js` 前注入。
- 只暂存并提交本轮相关文件，避开工作区已有无关变更。

**Must not:**

- 不引入构建工具、ES module 加载、TypeScript 或 npm 依赖。
- 不抽业务 endpoint 方法。
- 不改日报/周报/WBS 请求参数。
- 不重构 content message bridge、AI summary、weekly normalization、WBS 或 daily actual 模块。
- 不做真实网络测试。

**Out of scope:**

- shared business API client。
- content 自动化注册框架。
- 目录迁移到 `src/`。
- 浏览器 E2E 自动化。
- 修复 JXMIS 页面自身 `frame.js` 错误。

## Tasks

### T1: 建立 transport 共享模块

**Do:** 新增 `jxmis-transport.js`，提供：

- `createMessage(sourcePage, type, message, extra)`
- `post(win, sourcePage, type, message, extra)` 或等价 API
- `sleep(win, ms)`
- `randomDelay(config, randomFn)`
- `getWebapp(storage)`
- `getBaseUrl(location, storage)`
- `assertOk(response, label)`
- `fetchJson(fetchFn, url, label)`

**Files:** `jxmis-transport.js`

**Verify:** `node --check jxmis-transport.js`

### T2: 覆盖 adapter 行为

**Do:** 新增 `test/jxmis-transport.test.js`，覆盖：

- `getWebapp` 默认 `/jxpmo`、`/` 返回空字符串、`jxpmo/` 规范为 `/jxpmo`、` /jxpmo/ ` 规范为 `/jxpmo`。
- `getBaseUrl` 拼接 `origin + webapp`。
- `createMessage` 包含 `source/type/message`，并合并 `extra`。
- `post` 调用 `window.postMessage(payload, "*")`。
- `assertOk` 对 ok response 原样返回；非 2xx 错误包含 label/status/statusText/text。
- `fetchJson` 使用统一 GET options，成功返回 JSON，网络错误包装 label 和 url。
- `randomDelay` 落在 `baseDelayMs` 到 `baseDelayMs + randomDelayMaxMs - 1`。

**Files:** `test/jxmis-transport.test.js`, `jxmis-transport.js`

**Verify:** `npm test`

### T3: 接入三个 page script

**Do:** 修改 `content.js` 和 `manifest.json` 注入/资源声明；在 `page-batch-approve.js`、`page-batch-weekly-approve.js`、`page-batch-work.js` 中保留原 helper 名称，内部委托 `window.CwJxmisTransport`。只替换等价 helper，不重写业务 endpoint。

**Files:** `content.js`, `manifest.json`, `page-batch-approve.js`, `page-batch-weekly-approve.js`, `page-batch-work.js`

**Verify:** `node --check content.js page-batch-approve.js page-batch-weekly-approve.js page-batch-work.js`；手动检查注入顺序。

### T4: 全量验证与提交

**Do:** 运行测试、语法检查、变更检测；只暂存本轮文件并提交。

**Files:** `jxmis-transport.js`, `test/jxmis-transport.test.js`, `content.js`, `manifest.json`, `page-batch-approve.js`, `page-batch-weekly-approve.js`, `page-batch-work.js`

**Verify:** `npm test`；`node --check content.js page-batch-approve.js page-batch-weekly-approve.js page-batch-work.js jxmis-transport.js test/jxmis-transport.test.js`；提交前运行 GitNexus/codebase-memory 变更检测，若 MCP transport 仍失败，在最终说明中明确记录。

## Done

- [x] `jxmis-transport.js` 可通过 `require("../jxmis-transport")` 测试。
- [x] 三个 page script 的原 helper 名称仍存在并委托 transport adapter。
- [x] `content.js` 注入 `jxmis-transport.js` 早于三个 page script。
- [x] `manifest.json` 包含 `jxmis-transport.js`。
- [x] `npm test` 通过。
- [x] `node --check content.js page-batch-approve.js page-batch-weekly-approve.js page-batch-work.js jxmis-transport.js test/jxmis-transport.test.js` 通过。
- [x] 未修改业务 endpoint、AI summary、WBS、daily actual、weekly normalization。
- [ ] 本轮独立提交，且不包含工作区已有无关变更。

备注：实现前影响分析尝试调用 codebase-memory MCP，因 `Transport closed` 失败；本轮 fallback 到本地调用点搜索，确认影响范围覆盖日报审批、周报审核、批量报工三条 page script helper 路径。
