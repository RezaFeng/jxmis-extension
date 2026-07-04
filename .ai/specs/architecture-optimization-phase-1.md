# 架构优化第一轮

## Why

当前项目根目录脚本扁平，`page-batch-work.js` 承载过多核心业务，`content.js` 和页面脚本存在重复状态控制与传输 helper。现在先用低风险重构和最小测试入口降低后续拆分风险，为批量报工核心逻辑模块化铺路。

## What

交付一组可独立提交的小步优化：

- `content.js` 三套按钮/status/running 状态控制收敛为共享实现。
- 三个 page 脚本的 transport helper 行为收敛，先不移动到共享文件。
- 引入最小 Node 内置测试脚手架，不引入 Jest/Vitest 或构建流程。
- 优先抽出并测试“下周 WBS 计划生成”纯逻辑，为后续拆 `runBatchWork` 做准备。

完成标准：现有 Chrome 扩展加载方式不变；核心页面自动化入口不变；新增测试能覆盖 WBS 计划生成关键规则；每个任务有明确验证步骤。

## Context

**Relevant files:**

- `content.js` — 注入页面按钮、维护三类 automation 的运行状态、处理 page script 消息与 background 通信。
- `page-batch-approve.js` — 日报批量审批页面脚本，包含 `post`、`sleep`、`randomDelay`、`getWebapp`、`getBaseUrl`、`assertOk` 等 helper。
- `page-batch-weekly-approve.js` — 周报批量审核页面脚本，包含类似 transport helper 和周报详情读取逻辑。
- `page-batch-work.js` — 批量报工核心脚本，包含 `runBatchWork`、`buildNextExecutionRows`、日报实际工时匹配、AI 周报总结、WBS 插入与保存编排。
- `manifest.json` — Chrome 扩展脚本加载声明；本轮不应改变加载机制，除非某个任务明确需要。
- `README.md` — 记录扩展功能与 WBS 计划生成规则，可作为手动回归清单来源。
- `docs/项目架构优化建议.md` — 本轮优化背景与候选方向。

**Patterns to follow:**

- 当前项目是无构建流程的 Chrome 扩展，脚本直接由 `manifest.json` 或 content script 注入。
- 页面脚本使用 IIFE 风格和页面上下文全局对象；重构时保持外部入口和消息协议不变。
- 小步提交：每个任务只处理一个自然边界，避免在同一提交中同时移动文件、改行为、补测试。

**Key decisions already made:**

- 第一阶段只做低风险复用，不做页面自动化注册框架。
- transport 先统一行为，不移动到共享文件。
- 测试脚手架使用 Node 内置 `node:test` 和 `assert`，不引入 Jest/Vitest。
- 批量报工拆分优先处理“下周 WBS 计划生成”，之后再处理日报实际工时匹配。
- `normalizeWeeklyDetail` 本轮只保留现状，后续再对比两个调用方的字段 invariant。
- AI 周报总结本轮不纳入架构优化。

## Constraints

**Must:**

- 修改任何函数、类、方法前，先按项目要求对目标符号运行影响分析，并向用户报告直接调用方、受影响流程和风险等级。
- 提交前运行变更检测，确认影响范围只包含预期符号和流程。
- 保持 Chrome 扩展现有加载方式和页面消息协议兼容。
- 保持 `runBatchWork`、日报审批、周报审批的外部触发方式不变。
- 优先保留现有命名和业务文案，除非任务明确要求修改。
- 每个任务完成后都要有命令验证或明确手动验证步骤。

**Must not:**

- 不引入构建工具、打包器、TypeScript 迁移或大型测试框架。
- 不在第一轮建立复杂页面自动化注册框架。
- 不把 transport helper 移动到共享文件，除非另开任务重新评估脚本加载机制。
- 不重构 AI summary 的 page/content/background/popup 跨环境链路。
- 不抽取 `normalizeWeeklyDetail` 共享模块。
- 不修改与当前任务无关的用户工作区变更。

**Out of scope:**

- 目录迁移到 `src/`。
- 引入 npm 依赖或 CI。
- Chrome Web Store 发布配置。
- UI 视觉改版。
- JXMIS 接口协议变化适配。

## Tasks

### T1: 收敛 content 状态控制

**Do:** 在 `content.js` 内新增一个共享状态更新 helper，用配置参数覆盖 `statusId`、`buttonId`、running getter/setter、运行中文案、空闲文案。用它替换 `setDailyStatus`、`setWorkStatus`、`setWeeklyStatus` 内部重复实现，但保留这三个函数名作为调用入口。

**Files:** `content.js`

**Verify:** 手动检查三类入口仍调用原函数名；运行 `node --check content.js`。手动回归：日报按钮、批量报工按钮、周报审核按钮在 running true/false 时文案、disabled、opacity、cursor、status 颜色与重构前一致。

### T2: 收敛页面 transport helper 行为

**Do:** 对比 `page-batch-approve.js`、`page-batch-weekly-approve.js`、`page-batch-work.js` 中 `post`、`sleep`、`randomDelay`、`getWebapp`、`getBaseUrl`、`assertOk`、`fetchJson` 的行为。先只在各文件内部统一明显漂移的错误格式、headers、`cache: "no-store"`、fetch 失败包装等策略；保留必要差异并在代码或 spec 后续备注中说明。

**Files:** `page-batch-approve.js`, `page-batch-weekly-approve.js`, `page-batch-work.js`

**Verify:** `node --check page-batch-approve.js page-batch-weekly-approve.js page-batch-work.js`。手动回归：日报批量审批、周报批量审核、批量报工仍能启动并输出状态消息；HTTP 失败时错误文案包含操作 label 和响应状态。

### T3: 建立最小测试脚手架

**Do:** 新增最小 `package.json` 和测试目录，使用 Node 内置 `node:test`。只加入必要脚本，例如 `npm test` 运行 `node --test`。不引入外部依赖。先添加一个空壳或轻量 smoke test，验证测试命令可运行。

**Files:** `package.json`, `test/`

**Verify:** `npm test` 通过；现有运行时代码不依赖新增测试文件。

### T4: 抽出 WBS 计划生成纯逻辑

**Do:** 从 `page-batch-work.js` 中抽出 `buildNextExecutionRows` 及其直接纯逻辑依赖到可被 Node 测试加载的模块。页面脚本继续通过同名或等价 adapter 调用，外部行为不变。避免把 DOM、DataTables、`WkFormJS.saveAll()`、Chrome 消息桥带入纯逻辑模块。

**Files:** `page-batch-work.js`, 新增 WBS 计划模块文件, `test/`

**Verify:** `npm test` 和 `node --check page-batch-work.js` 通过。手动回归：批量报工仍能生成下周 WBS 执行计划并保存。

### T5: 覆盖 WBS 计划生成关键规则

**Do:** 为 WBS 计划生成补充测试 fixture，覆盖 README 和架构建议中列出的核心规则：日期范围相交、工作日/节假日、`待定` owner、无 owner 且无 duration 跳过、24 小时拆分、已存在行去重、生成完成时间为下周日 `17:30:00`。

**Files:** WBS 计划模块文件, `test/`

**Verify:** `npm test` 通过；测试失败信息能定位具体规则。

## Done

- [ ] 所有修改过的符号已完成影响分析，并记录风险等级。
- [ ] `node --check content.js page-batch-approve.js page-batch-weekly-approve.js page-batch-work.js` 通过。
- [ ] `npm test` 通过。
- [ ] 提交前变更检测确认影响范围符合预期。
- [ ] 手动验证日报批量审批可启动、进度更新、完成后刷新。
- [ ] 手动验证批量报工可写当前周执行表、生成下周 WBS 计划并保存。
- [ ] 手动验证周报批量审核可预览、确认、逐条审核、完成后刷新。
- [ ] 本轮没有修改 AI 周报总结链路、`normalizeWeeklyDetail` 共享逻辑或目录加载结构。
