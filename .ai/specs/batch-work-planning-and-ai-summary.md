# 批量报工计划与 AI 总结模块化

## Why

`page-batch-work.js` 的 `runBatchWork` 仍同时处理当前周执行表变更、AI 周报总结、保存编排和下周计划，核心流程 locality 仍不稳定。下一轮先把当前周变更计划和 page 侧 AI 总结生命周期抽成可测试模块，继续压缩 `runBatchWork` 的业务细节。

## What

交付两个可被页面脚本和 Node 测试共同使用的纯逻辑模块：

- 当前周执行表变更计划模块：给定周报执行行、日报 resolver 输出和现有表单值，产出 next values、是否 changed、summary row。
- AI 周报总结 page 侧模块：集中 prompt、cache payload、request state、stream chunk 聚合、done/error 处理和保存决策。

完成标准：`runBatchWork` 仍保持外部入口、消息协议和保存顺序不变；DOM/DataTables 写入、`WkFormJS.saveAll()`、content/background/popup 运行环境 adapter 不迁入纯逻辑模块；新增测试覆盖核心规则。

## Context

**Relevant files:**

- `page-batch-work.js` — 当前批量报工核心脚本；`runBatchWork` 仍有当前周表格变更、AI 总结、保存编排和下周计划调用。
- `daily-actual.js` — 已抽出的日报实际工时/完成率/实际结束时间 resolver，当前周变更计划应复用其输出，不复制匹配规则。
- `wbs-plan.js` — 已抽出的下周 WBS 计划纯逻辑模块，UMD 导出模式参考。
- `weekly-detail.js` — 已抽出的周报详情 normalization 模块，UMD 导出模式参考。
- `content.js` — 注入共享脚本，并转发 AI summary chunk/done/error；本轮只增加新 page 模块注入，不重构 message bridge。
- `manifest.json` — 需要把新增共享模块加入 `web_accessible_resources`。
- `test/daily-actual.test.js`、`test/wbs-plan.test.js`、`test/weekly-detail.test.js` — Node 内置测试风格参考。
- `background.js`、`popup.js`、`defaults.js` — AI summary 跨环境链路相关文件；本轮只作为上下文，不主动修改。
- `docs/项目架构优化建议.md` — 本轮来源：P0 批量报工 module 深化和 P2 AI 周报总结 seam。

**Patterns to follow:**

- 沿用 `wbs-plan.js` / `daily-actual.js` / `weekly-detail.js` 的 UMD 风格：浏览器挂载 `window.CwXxx`，Node 使用 `require(...)`。
- 页面脚本保留现有 wrapper 函数名或同名 adapter，降低调用点变更。
- 使用 `node:test` + `node:assert/strict`，不引入依赖。
- DOM/DataTables 操作留在 `page-batch-work.js` 边缘；纯模块只返回计划/状态。

**Key decisions already made:**

- 不引入构建工具、ES module 加载、TypeScript 或 npm 依赖。
- 不改变 `CW_BATCH_WORK_*`、`CW_WEEKLY_SUMMARY_*` 消息 type/source。
- 不修改真实 JXMIS endpoint、请求参数、保存顺序或按钮入口。
- AI summary 只先抽 page 侧生命周期；`content.js` / `background.js` / `popup.js` 仍是运行环境 adapter。
- 当前周执行表模块先处理“计划生成”，不直接写 DOM、DataTables change store 或调用 `saveAll()`。

## Constraints

**Must:**

- 修改任何现有函数前先做影响分析；若 GitNexus MCP 不可用，使用 codebase-memory trace/search 并记录结果。
- 保持 `runBatchWork` 外部返回 shape 和保存行为兼容。
- 保持日报 resolver、WBS 计划、weekly detail 已有模块接口兼容。
- 每个任务完成后运行相关 `node --check` 和 `npm test`。
- 只暂存/提交本轮相关文件，避开工作区已有无关改动。

**Must not:**

- 不移动目录到 `src/`。
- 不重构 content message bridge 或 background SSE 解析。
- 不改 popup 配置 UI、OpenAI-compatible API 参数或默认 prompt。
- 不把 DOM、jQuery、DataTables、`WkFormJS.saveAll()` 放进纯逻辑模块。
- 不重写 `runBatchWork` 全流程；每次只替换一个自然边界。

**Out of scope:**

- 浏览器 E2E 自动化测试。
- AI 模型配置体验优化。
- 下周 WBS 计划算法变更。
- 周报审核流程变更。
- 目录结构迁移和打包流程。

## Tasks

### T1: 当前周执行变更计划模块

**Do:** 新增 `current-week-execution-plan.js`，提供纯函数计算单行当前周执行表的 `nextValues`、`hasChanged` 和 summary row。输入包括 `rowData`、`planDate`、`planEndTime`、resolver 调用结果和 row index；输出不包含 DOM 节点、DataTables store 或 jQuery 对象。`page-batch-work.js` 保留表格遍历和 DOM 写入，只调用该模块生成计划。

**Files:** `current-week-execution-plan.js`, `page-batch-work.js`, `content.js`, `manifest.json`, `test/current-week-execution-plan.test.js`

**Verify:** `node --check current-week-execution-plan.js page-batch-work.js content.js test/current-week-execution-plan.test.js`; `npm test`; Manual: 批量报工当前周执行表仍能写入完成率、实际结束时间、实际工时、是否继续、状态和备注。

### T2: AI 周报总结 page 生命周期模块

**Do:** 新增 `weekly-summary.js`，迁入/包装 page 侧纯逻辑：`createUserPrompt`、`createSummaryCacheKey`、cache payload 构造、requestId 生成、pending request 初始状态、chunk 聚合、done/error 状态转换、空 summary 校验和保存决策。`page-batch-work.js` 保留 `post`、content bridge、field 写入和 `saveWeeklySummary` adapter。

**Files:** `weekly-summary.js`, `page-batch-work.js`, `content.js`, `manifest.json`, `test/weekly-summary.test.js`

**Verify:** `node --check weekly-summary.js page-batch-work.js content.js test/weekly-summary.test.js`; `npm test`; Manual: AI summary chunk 能流式回填字段，done 后 resolve，error 后显示失败并不吞掉异常。

### T3: 收敛 runBatchWork 编排

**Do:** 在 T1/T2 模块接入后，整理 `runBatchWork` 为高层编排：读取当前周表格、加载周报上下文、加载日报实际数据、应用当前周变更计划、生成 AI 总结、保存当前周、生成下周计划、保存下周计划。只移动局部 helper 或命名中间结果，不改变执行顺序。

**Files:** `page-batch-work.js`

**Verify:** `node --check page-batch-work.js`; `npm test`; Manual: 日报实际数据 fallback、AI 总结失败、无当前周更新、无下周插入、missing majorPerson 五类路径仍返回/提示原有语义。

### T4: 全量验证与提交

**Do:** 运行语法检查、测试、变更检测和 scoped diff review；只暂存本 spec 相关文件并提交。若 codebase-memory/GitNexus 变更检测返回整个脏工作区，需要同时用 `git diff --cached --name-only` 证明提交范围。

**Files:** 本 spec 相关新增模块、测试、`page-batch-work.js`, `content.js`, `manifest.json`

**Verify:** `npm test`; `git diff --check`; `git diff --cached --name-only`; codebase-memory `detect_changes` 或说明 fallback。

## Done

- [ ] 当前周执行表变更计划可通过 Node 测试验证。
- [ ] AI 周报总结 page 侧 prompt/cache/request/chunk/done/error 逻辑可通过 Node 测试验证。
- [ ] `runBatchWork` 高层编排更短，DOM/DataTables 写入仍在页面 adapter 边缘。
- [ ] `npm test` 通过。
- [ ] `node --check content.js page-batch-work.js current-week-execution-plan.js weekly-summary.js test/current-week-execution-plan.test.js test/weekly-summary.test.js` 通过。
- [ ] 手动验证批量报工能写当前周执行表、生成 AI 周报总结、生成下周 WBS 计划并保存。
- [ ] 未修改 content/background/popup 的 AI runtime 协议、JXMIS endpoint、WBS 计划算法或目录结构。
