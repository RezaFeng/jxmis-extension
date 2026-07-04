# 日报实际匹配模块

## Why

`page-batch-work.js` 中日报实际工时、完成率、实际结束时间的匹配规则仍和页面请求、DataTables 写入、批量报工编排混在一起，缺少可测试接口。上一轮已将 WBS 计划生成抽成 `wbs-plan.js` 并建立 Node 测试，本轮继续用同一模式把日报匹配纯逻辑模块化。

## What

交付一个可被页面脚本和 Node 测试共同使用的日报匹配模块：

- 新增 `daily-actual.js`，UMD 风格导出：浏览器挂载 `window.CwDailyActual`，Node 使用 `require("../daily-actual")`。
- 将日报行规范化、周报执行行匹配、实际工时/完成率/实际结束时间解析逻辑迁入模块。
- `page-batch-work.js` 保留 fetch、分页、进度消息、DataTables 写入和 `runBatchWork` 编排，只调用 `window.CwDailyActual`。
- 新增 `node:test` 覆盖关键匹配规则。

完成标准：现有批量报工外部入口不变；页面脚本加载方式仍不引入构建工具；测试覆盖 WBS/person 精确匹配、name fallback、歧义、重复消费、fallback、完成率和结束时间最新值。

## Context

**Relevant files:**

- `page-batch-work.js` — 当前包含日报拉取、日报行规范化、匹配 resolver、当前周执行表写入、AI summary、WBS 下周计划和保存编排。
- `daily-actual.js` — 本轮新增，承载日报实际数据到周报执行行的纯匹配逻辑。
- `content.js` — 当前负责按页面注入 `wbs-plan.js` 和 `page-batch-work.js`；本轮需要在 work 页面注入 `daily-actual.js`。
- `manifest.json` — 需要把 `daily-actual.js` 加入 `web_accessible_resources`。
- `test/wbs-plan.test.js` — 上一轮 Node 测试风格参考。
- `wbs-plan.js` — UMD 模块模式参考。
- `docs/项目架构优化建议.md` — 本轮优化来源，尤其是“日报实际工时匹配”和“DOM/DataTables 操作留在 adapter 边缘”。

**Patterns to follow:**

- 沿用 `wbs-plan.js` 的 UMD 风格：CommonJS `module.exports` + 浏览器全局挂载。
- 沿用 `node:test` + `node:assert/strict`，不引入外部依赖。
- `page-batch-work.js` 中保留原有 wrapper 函数名或等价 adapter，降低调用点变更。
- 页面脚本仍通过 `content.js` 注入，不引入打包流程。

**Key decisions already made:**

- 只抽纯匹配/解析逻辑，不抽 `fetchTaskDetailPage`、分页并发、`post` 进度消息或 DataTables 写入。
- `resolveDailyActualHours`、`resolveDailyFinishRate`、`resolveDailyRealEndTime` 一起迁入模块，因为它们共享 resolver 状态和匹配规则。
- 测试只覆盖匹配规则，不测试 JXMIS endpoint、翻页、并发、content/page 消息或真实页面写入。
- 完成后独立提交，建议提交名：`refactor: modularize daily actual matching`。

## Constraints

**Must:**

- 修改任何现有函数前，先做影响分析；如果 GitNexus MCP 仍不可用，记录 fallback 到本地调用点搜索的原因和结果。
- 保持 `runBatchWork` 外部行为、页面按钮、消息协议和保存顺序不变。
- 保持日报 fetch/page traversal 逻辑在 `page-batch-work.js`。
- 保持 AI summary、WBS 计划、周报详情 normalization 不在本轮重构范围内。
- 只暂存并提交本轮相关文件，避开工作区已有无关变更。

**Must not:**

- 不引入 Jest/Vitest、打包器、TypeScript 或 npm 依赖。
- 不修改真实 JXMIS 请求 URL、分页策略或并发数。
- 不移动 DataTables 写入、`WkFormJS.saveAll()` 或 DOM adapter。
- 不重构 AI 周报总结链路。
- 不抽取 `normalizeWeeklyDetail`。
- 不顺手做 shared transport adapter。

**Out of scope:**

- JXMIS 接口兼容性改造。
- content 自动化注册框架。
- shared transport module。
- 目录迁移到 `src/`。
- 真实浏览器自动化测试。

## Tasks

### T1: 建立 daily actual 纯逻辑模块

**Do:** 新增 `daily-actual.js`，迁入/复制纯函数所需逻辑：文本规范化、日期/时间解析辅助、周报人员与任务名提取、日报人员与任务名提取、日报行规范化、resolver 创建、WBS/person 匹配、name/person fallback 匹配、三类字段解析函数。

**Files:** `daily-actual.js`

**Verify:** `node --check daily-actual.js`

### T2: 接入页面脚本

**Do:** 在 `manifest.json` 添加 `daily-actual.js` 为可访问资源；在 `content.js` 的 work 页面注入顺序中确保 `daily-actual.js` 早于 `page-batch-work.js`；在 `page-batch-work.js` 中让现有日报匹配相关 wrapper 调用 `window.CwDailyActual`。

**Files:** `manifest.json`, `content.js`, `page-batch-work.js`

**Verify:** `node --check content.js page-batch-work.js`；手动检查 work 页面注入顺序为 `wbs-plan.js`、`daily-actual.js`、`page-batch-work.js`。

### T3: 覆盖日报匹配规则

**Do:** 新增 `test/daily-actual.test.js`，覆盖：

- 按 WBS + 人员匹配并聚合多条日报 `realHour`。
- 按任务名 + 人员 fallback 匹配。
- 同一人员/任务名在周报行里出现多次时，name fallback 判为 `ambiguousNameMatch`。
- 已使用的 WBS/person 或 name/person key 不重复消费。
- 无日报匹配 fallback 到计划值。
- 匹配到日报但 `realHour <= 0` fallback 到计划值。
- 完成率取最新有效 `realFinishRate`。
- 实际结束时间取最新有效日报时间。
- 缺周报人员 fallback。

**Files:** `test/daily-actual.test.js`, `daily-actual.js`

**Verify:** `npm test`

### T4: 全量验证与提交

**Do:** 运行本轮相关语法检查、测试和变更检测；只暂存本轮文件并提交。

**Files:** `daily-actual.js`, `content.js`, `manifest.json`, `page-batch-work.js`, `test/daily-actual.test.js`

**Verify:** `node --check content.js page-batch-work.js daily-actual.js test/daily-actual.test.js`；`npm test`；提交前运行 GitNexus/codebase-memory 变更检测，若 MCP transport 仍失败，在最终说明中明确记录。

## Done

- [x] 日报匹配纯逻辑可通过 `require("../daily-actual")` 测试。
- [x] work 页面注入 `daily-actual.js` 早于 `page-batch-work.js`。
- [x] `page-batch-work.js` 不再承载三类 resolver 的主要实现细节，只保留页面 adapter/编排。
- [x] `npm test` 通过。
- [x] `node --check content.js page-batch-work.js daily-actual.js test/daily-actual.test.js` 通过。
- [x] 未修改 AI summary、WBS 计划、transport adapter、`normalizeWeeklyDetail`。
- [ ] 本轮独立提交，且不包含工作区已有无关变更。

备注：实现前影响分析和提交前变更检测尝试调用 codebase-memory MCP，均因 `Transport closed` 失败；本轮 fallback 到本地调用点搜索确认影响范围集中在 `page-batch-work.js` 当前周填充路径。
