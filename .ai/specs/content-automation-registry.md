# Content 自动化注册表

## Why

`content.js` 已经收敛了三套 status 控制，但页面识别、脚本注入、面板挂载和消息处理仍按日报/批量报工/周报审核三段硬编码展开。下一轮先建立轻量自动化注册表，让新增或调整页面自动化时改配置和少量 handler，而不是复制整段控制流。

## What

交付 `content.js` 内部的注册表式编排：

- 每类页面自动化声明自己的 `matcher`、需注入脚本列表、`ensurePanel` 和 status control key。
- `ensureAutomation` 改为遍历注册表，按声明顺序注入脚本并挂载面板。
- 页面消息桥改为按 `source` 分发到 handler table，保留 AI summary 和 cache bridge 的现有行为。
- 不改变按钮 DOM 结构、文案、消息 type/source、刷新策略或页面脚本注入顺序。

完成标准：`content.js` 外部行为不变；三类自动化入口仍能按原页面识别和原按钮逻辑工作；代码中新增页面类型时不再需要改 `ensureAutomation` 的硬编码分支。

## Context

**Relevant files:**

- `content.js` — 当前目标文件，包含页面识别、脚本注入、按钮/状态、AI summary bridge、cache bridge 和 page message handling。
- `manifest.json` — `content.js` 仍作为唯一 content script 直接加载；本轮不改加载机制。
- `jxmis-transport.js`、`wbs-plan.js`、`daily-actual.js`、`current-week-execution-plan.js`、`weekly-summary.js`、`weekly-detail.js` — work 页面注入顺序必须保持。
- `page-batch-approve.js`、`page-batch-work.js`、`page-batch-weekly-approve.js` — 消息 source/type 的发送方；本轮不修改。
- `docs/项目架构优化建议.md` — 本轮来源：P1 “深化 content 自动化控制 module”。

**Patterns to follow:**

- 保持无构建流程；不新增 content script module 文件。
- 继续保留 `setDailyStatus`、`setWorkStatus`、`setWeeklyStatus` 包装函数，减少消息 handler 调用点变化。
- 注册表只描述“什么时候注入什么、挂载哪个面板”；具体 DOM 创建仍留在 `ensureDailyPanel`、`ensureWorkButton`、`ensureWeeklyApprovalPanel`。
- 消息 handler 用小函数表表达 source/type 分发，不引入复杂框架。

**Key decisions already made:**

- 不引入 jsdom 或测试依赖。
- 不抽 AI summary runtime bridge 到 background/popup 之外。
- 不改 `CW_DAILY_APPROVAL_*`、`CW_BATCH_WORK_*`、`CW_WEEKLY_APPROVAL_*`、`CW_WEEKLY_SUMMARY_*` 协议。
- 不把三类面板挂载逻辑强行统一成参数化 DOM builder。

## Constraints

**Must:**

- 修改 `ensureAutomation`、message listener 或状态相关函数前先运行影响分析。
- 保持 transport 和 work 页面共享脚本注入顺序：
  `jxmis-transport.js` 早于 page script；work 页面中 WBS/daily/current-week/weekly-summary/weekly-detail 早于 `page-batch-work.js`。
- 保持 hashchange 和 MutationObserver 仍调用 `ensureAutomation`。
- 保持日报完成后的 grid refresh/reload、周报完成后的 grid refresh/reload、批量报工 done/error 状态语义。
- 只暂存并提交本轮相关文件，避开工作区已有 docs/配置/skill 无关变更。

**Must not:**

- 不修改 `manifest.json` 的 content script 加载方式。
- 不修改 page script 业务逻辑或消息协议。
- 不引入 npm 依赖、构建工具、TypeScript 或 E2E 测试。
- 不调整按钮视觉样式、确认弹窗文案或状态文案。
- 不把 AI summary/cache bridge 改成新的 background 协议。

**Out of scope:**

- content script 单元测试框架。
- 页面面板 DOM builder 抽象。
- background/popup AI 配置体验。
- JXMIS transport adapter 继续重构。
- 目录迁移到 `src/`。

## Tasks

### T1: 建立自动化注册表

**Do:** 在 `content.js` 中新增 `AUTOMATIONS` 注册表，声明 daily/work/weekly 的 `matcher`、`scripts`、`ensurePanel`。将 `ensureAutomation` 改成遍历注册表：matcher 命中时按数组顺序调用 `injectPageScript`，再调用对应 `ensurePanel`。

**Files:** `content.js`

**Verify:** `node --check content.js`；手动检查注册表中的 work 脚本顺序与当前 `ensureAutomation` 完全一致。

### T2: 收敛 page message 分发

**Do:** 在 `content.js` 中新增按 source 组织的 handler table：daily handlers、work handlers、weekly handlers。将 `window.addEventListener("message", ...)` 改为校验 `event.source/data` 后查表分发。AI summary request、summary cache get/set、grid refresh/reload 行为保持原分支语义。

**Files:** `content.js`

**Verify:** `node --check content.js`；手动对照 handler table 覆盖原有全部 type：daily running/progress/done/error，work AI/cache/running/done/error，weekly running/preview/progress/done/error。

### T3: 全量验证与提交

**Do:** 运行语法检查、测试、变更检测和 scoped diff review；只暂存 `content.js` 并提交。如果 codebase-memory/GitNexus 变更检测返回整个脏工作区，需要同时用 `git diff --cached --name-only` 证明提交范围。

**Files:** `content.js`

**Verify:** `node --check content.js`; `npm test`; `git diff --check -- content.js`; codebase-memory `detect_changes` 或说明 fallback。

## Done

- [ ] `ensureAutomation` 由注册表驱动，三类页面脚本注入顺序不变。
- [ ] message listener 由 source/type handler table 分发，原有 type 覆盖完整。
- [ ] `node --check content.js` 通过。
- [ ] `npm test` 通过。
- [ ] 未修改 page script 业务逻辑、manifest content script 加载方式、AI summary/cache 协议。
- [ ] 本轮独立提交，且不包含工作区已有无关变更。
