# 批量报工周报上下文模块

## Why

`page-batch-work.js` 仍有 2000 多行，周报上下文读取、日报/WBS/AI/保存编排混在同一个文件里。先抽出周报上下文读取，能用较低风险减少 `runBatchWork` 前置复杂度，并为后续拆日报匹配、AI 总结和保存编排铺路。

## What

交付一个可测试的 `weekly-context` 模块，承载批量报工进入主流程前需要的周报上下文读取与日期范围规范化。

完成标准：

- `page-batch-work.js` 不再内联实现周报上下文读取规则，只保留调用入口或薄 adapter。
- 新模块可被页面脚本通过全局对象调用，也可被 Node 测试 `require`。
- `runBatchWork` 调用语义不变，仍能拿到同 shape 的 context。
- 新增测试覆盖 week range、控制值读取、按 `wkId/projectId` 选择周报行、缺 projectId 报错等关键规则。

## Context

**Relevant files:**

- `page-batch-work.js` — 批量报工主脚本；当前包含 `readControlValue`、`parseWkIdFromLocation`、`normalizeWeekRange`、`fetchWeeklyById`、`fetchWeeklyRowsByProject`、`getWeeklyContext`。
- `weekly-detail.js` — 已共享 `normalizeWeeklyDetail`，新模块应复用它，不重新实现周报详情 shape normalization。
- `jxmis-transport.js` — 已共享 `fetchJson/getBaseUrl` 等页面传输能力；新模块应通过注入的 adapter 使用，不直接耦合全局 fetch 细节。
- `content.js` — 负责向页面注入 work 页面依赖脚本；新增模块需要加入 work 自动化脚本注入顺序。
- `manifest.json` — 需要把新增页面模块加入 `web_accessible_resources`。
- `test/weekly-detail.test.js`、`test/wbs-plan.test.js`、`test/ai-request-body.test.js` — 现有 UMD/IIFE + Node `require` 测试模式参考。
- `docs/项目架构优化建议.md` — 本轮来源：候选一“深化批量报工 module”。

**Patterns to follow:**

- 新模块使用现有 UMD/IIFE 风格：
  - Node 环境：`module.exports = factory()`
  - 页面环境：挂到 `root.CwWeeklyContext`
- 页面脚本不使用 ES module，不引入构建工具。
- 业务纯逻辑放进模块；DOM、`window.location`、`fetchJson`、`getBaseUrl` 通过依赖注入或薄 adapter 提供。
- 保持现有中文错误文案，除非需要补充更明确的错误。

**Key decisions already made:**

- 本轮只抽“周报上下文读取”，不拆日报实际匹配、WBS 计划、AI 流式总结、DataTables 写入和保存编排。
- `normalizeWeeklyDetail` 已由 `weekly-detail.js` 承担，本轮不重复造 normalization。
- 不做目录迁移到 `src/`，继续在根目录增加直接加载脚本。
- 影响面已初查：
  - `getWeeklyContext` 上游：`runBatchWork` 直接调用，`run` 间接受影响，风险 `CRITICAL`。
  - `readControlValue`、`parseWkIdFromLocation`、`normalizeWeekRange`、`fetchWeeklyById`、`fetchWeeklyRowsByProject` 都属于 `getWeeklyContext` 前置链路。

## Constraints

**Must:**

- 修改目标函数前重新确认影响分析，遇到 HIGH/CRITICAL 风险必须先向用户说明。
- 保持 `getWeeklyContext` 返回 shape 兼容：
  - `wkId`
  - `projectId`
  - `projectName`
  - `prodPerson`
  - `prodPersonName`
  - `projectManager`
  - `projectManagerName`
  - `weekDate`
  - `weekStart`
  - `weekEnd`
  - `startDate`
  - `endDate`
- 保持 `page-batch-work.js` 外部消息协议和 `runBatchWork` 入口不变。
- 新增脚本必须在 `page-batch-work.js` 之前注入。
- 提交前运行 `npm test`、相关 `node --check`、`git diff --check` 和变更检测。

**Must not:**

- 不改 AI 周报总结 page/content/background 流程。
- 不改当前周执行表写入、DataTables change store 或 `WkFormJS.saveAll()`。
- 不改 WBS 计划生成规则。
- 不引入 npm 依赖、构建工具或 TypeScript。
- 不提交无关的 docs/skills/config 既有脏文件。

**Out of scope:**

- `content.js` controls 独立测试。
- `weekly-summary` stream lifecycle 深化。
- `page-batch-work.js` 保存编排拆分。
- 目录结构迁移。

## Tasks

### T1: 新增 weekly-context 纯逻辑模块

**Do:** 新增 `weekly-context.js`，迁入并整理以下逻辑：

- `parseDate`
- `formatDate`
- `addDays`
- `mondayOf`
- `normalizeWeekRange`
- `parseWkIdFromLocation`
- `readControlValue`
- 周报行选择逻辑
- `createWeeklyContext` 或等价函数

DOM 查询、location、fetch 函数通过参数传入，避免纯逻辑直接依赖真实页面。

**Files:** `weekly-context.js`, `test/weekly-context.test.js`

**Verify:** `npm test`；`node --check weekly-context.js test/weekly-context.test.js`

### T2: 接入 page-batch-work

**Do:** 在 `page-batch-work.js` 中用 `window.CwWeeklyContext` 替换内联周报上下文读取实现。保留必要薄 wrapper，例如把 `document`、`window.location`、`fetchJson`、`getBaseUrl`、`window.CwWeeklyDetail.normalizeWeeklyDetail` 注入给新模块。

**Files:** `page-batch-work.js`, `weekly-context.js`

**Verify:** `node --check page-batch-work.js weekly-context.js`；`npm test`

### T3: 更新脚本加载声明

**Do:** 在 `content.js` 的 work automation scripts 中把 `weekly-context.js` 放在 `page-batch-work.js` 之前；在 `manifest.json` 的 `web_accessible_resources` 中加入 `weekly-context.js`。

**Files:** `content.js`, `manifest.json`

**Verify:** `node --check content.js page-batch-work.js weekly-context.js`；手动检查 work 注入顺序为 transport/detail/context/work。

### T4: 回归与提交

**Do:** 跑完整验证，检查 staged 范围，只提交本轮相关文件。

**Files:** `weekly-context.js`, `page-batch-work.js`, `content.js`, `manifest.json`, `test/weekly-context.test.js`

**Verify:**

- `npm test`
- `node --check weekly-context.js page-batch-work.js content.js`
- `git diff --check -- weekly-context.js page-batch-work.js content.js manifest.json test/weekly-context.test.js`
- 变更检测确认影响范围符合预期；如果检测工具返回整个既有脏工作区，使用 staged diff 证明提交范围。

## Done

- [x] `weekly-context.js` 可在页面和 Node 测试中加载。
- [x] `page-batch-work.js` 不再内联周报上下文读取规则。
- [x] 新测试覆盖周报上下文关键规则。
- [x] `npm test` 通过。
- [x] `node --check weekly-context.js page-batch-work.js content.js` 通过。
- [x] `manifest.json` 和 `content.js` 注入顺序正确。
- [x] 本轮未修改 AI、WBS、日报匹配、保存编排行为。
