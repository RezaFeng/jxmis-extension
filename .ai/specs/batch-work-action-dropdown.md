# 批量报工动作下拉菜单

## Why

当前“批量报工”只有一个完整流程入口，用户无法单独执行周报总结、本周工时或下周计划。需要把入口改成“一键报工”并增加局部动作，降低重复执行完整流程的风险。

## What

把批量报工按钮改成 split-button/dropdown：

- 主按钮文案改为“一键报工”，点击继续执行现有完整流程。
- 下拉菜单增加：
  - `仅填周报`：只触发大模型总结周报并保存当前周报；缺少大模型配置时报错。
  - `仅填工时`：只自动填写本周工时、完成率、实际结束时间并保存当前周报。
  - `仅填计划`：只自动填写下周 WBS 计划，不自动保存，提示用户手动保存。

完成标准：原完整流程行为兼容；新增模式通过消息 `mode` 分发；运行中主按钮、下拉按钮和菜单项都禁用；测试通过。

## Context

**Relevant files:**

- `content.js` — 创建批量报工按钮和状态文本，发送 `CW_BATCH_WORK_START`。
- `page-batch-work.js` — 接收 `CW_BATCH_WORK_START`，执行 `runBatchWork`、周报总结、本周工时、下周 WBS 计划与保存。
- `weekly-summary.js` — 已提供缺少大模型配置识别。
- `test/weekly-summary.test.js` — 当前测试覆盖 AI 配置错误识别。

**Patterns to follow:**

- 继续使用 content script 创建页面 DOM，不引入 CSS 文件或构建工具。
- 页面消息仍使用 `window.postMessage`，在现有 `CW_BATCH_WORK_START` 上增加 `mode` 字段。
- 保持 IIFE 风格和现有中文文案。
- 保持主按钮兼容：未传 `mode` 时等同完整流程。

**Key decisions already made:**

- 主按钮“一键报工”点击执行完整流程。
- 三个局部动作保存策略：
  - 仅填周报：保存。
  - 仅填工时：保存。
  - 仅填计划：不保存，提示手动保存。
- 完整流程中缺少大模型配置时跳过周报总结；`仅填周报` 缺少配置时报错。
- 下拉 UI 为主按钮 + 小箭头 + 菜单；点击页面其它位置关闭菜单。

## Constraints

**Must:**

- 修改 `ensureWorkButton`、`runBatchWork`、`run` 前做影响面检查并报告风险。
- 保持完整“一键报工”原有保存语义。
- `仅填计划` 不调用 `saveAll()`。
- 运行中禁用主按钮、下拉按钮、菜单项。
- 未传或未知 `mode` 回退为完整流程。

**Must not:**

- 不改日报审核、周报审核入口。
- 不改 AI 请求体 provider 配置。
- 不改 WBS 计划生成规则。
- 不引入新依赖。
- 不提交无关 docs/skills/config 既有脏文件。

**Out of scope:**

- 菜单视觉大改版。
- 对 JXMIS 原生按钮布局做额外适配。
- 将批量报工拆成新文件。

## Tasks

### T1: 更新 UI 和消息 mode

**Do:** 在 `content.js` 中把 `批量报工` 改成 `一键报工`，增加下拉按钮和菜单项；主按钮发送 `mode: "all"`，菜单项分别发送 `summary`、`hours`、`plan`。

**Files:** `content.js`

**Verify:** `node --check content.js`

### T2: 实现批量报工 mode 分发

**Do:** 在 `page-batch-work.js` 中新增 mode normalization 和局部执行函数：

- `all`：现有完整流程。
- `summary`：读取上下文和日报 taskDetail，生成周报总结并保存；缺配置报错。
- `hours`：读取日报实际数据，填写本周工时并保存。
- `plan`：生成下周 WBS 计划，不保存。

**Files:** `page-batch-work.js`

**Verify:** `node --check page-batch-work.js`

### T3: 验证与提交

**Do:** 跑测试和 diff 检查，只提交相关文件。

**Files:** `.ai/specs/batch-work-action-dropdown.md`, `content.js`, `page-batch-work.js`

**Verify:**

- `npm test`
- `node --check content.js page-batch-work.js`
- `git diff --check -- .ai/specs/batch-work-action-dropdown.md content.js page-batch-work.js`

## Done

- [x] 主按钮显示“一键报工”并执行完整流程。
- [x] 下拉菜单有 `仅填周报`、`仅填工时`、`仅填计划`。
- [x] `summary` 缺大模型配置时报错，不静默跳过。
- [x] `hours` 保存当前周报。
- [x] `plan` 填表但不自动保存，并提示手动保存。
- [x] `npm test` 通过。
