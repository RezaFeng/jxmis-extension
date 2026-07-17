# Esbuild 构建与 src 架构迁移

## Why

项目已经把 WBS 计划、日报匹配、周报上下文等纯逻辑拆成可测试 module，但运行时代码仍以根目录 UMD/IIFE 脚本、`window.Cw*` 全局变量和手工注入顺序组织。随着 page/content/background 之间的消息和 AI 流式生命周期持续增长，当前结构让构建、加载、测试和维护成本重新集中在 `content.js` 与 `page-batch-work.js`。

现在引入 esbuild，把源码迁入 `src/`，用六个明确的运行入口封装 Chrome 扩展的硬隔离环境，并把页面 DOM、Chrome API、JXMIS 请求和 AI 流分别留在可替换 adapter 后面。目标不是单纯缩短文件，而是让核心工作流通过小 interface 获得更高 leverage、locality 和可测试性。

## What

交付一个以 `src/` 为唯一源码、以 `dist/` 为唯一 Chrome 加载目录的 Manifest V3 扩展：

- 使用 esbuild 构建六个浏览器入口：
  - `background.js`
  - `content.js`
  - `popup.js`
  - `page-daily-approval.js`
  - `page-batch-work.js`
  - `page-weekly-approval.js`
- `src/` 内全部使用 ESM；浏览器产物使用 IIFE，保持 page-context 普通脚本注入方式。
- 目录先按 Chrome 运行环境分组，再按业务功能分组。
- page bundle 静态导入其纯逻辑和 page adapter，不再依赖 `window.Cw*` 或多个脚本的加载顺序。
- 集中 page/content/background 的消息协议，并对关键消息做最小运行时校验。
- 将 Node 测试迁移到 ESM，并补齐核心工作流、content bridge、background SSE 的契约测试。
- 使用离线 Playwright fixture 验证构建后的扩展加载、页面识别、bundle 注入和消息链路；真实 JXMIS 只做手动 UAT。
- 提供 build、watch、test、Playwright、package 命令；生成目录与发布 ZIP 不提交 Git。
- 迁移完成后删除根目录旧运行时脚本、临时兼容输出和 UMD 全局入口。

最终目录目标：

```text
.
├── .ai/specs/
├── docs/
├── scripts/
│   ├── build.mjs
│   ├── package.mjs
│   └── serve-fixtures.mjs
├── src/
│   ├── entries/
│   │   ├── background.js
│   │   ├── content.js
│   │   ├── popup.js
│   │   ├── page-daily-approval.js
│   │   ├── page-batch-work.js
│   │   └── page-weekly-approval.js
│   ├── background/
│   │   ├── ai-client.js
│   │   ├── ai-stream.js
│   │   ├── config-store.js
│   │   └── runtime.js
│   ├── content/
│   │   ├── ai-bridge.js
│   │   ├── automation-registry.js
│   │   ├── message-router.js
│   │   ├── page-script-loader.js
│   │   ├── runtime.js
│   │   └── status-control.js
│   ├── page/
│   │   ├── shared/
│   │   │   ├── jxmis-transport.js
│   │   │   └── weekly-detail.js
│   │   ├── daily-approval/
│   │   ├── batch-work/
│   │   │   ├── batch-work.js
│   │   │   ├── current-week-execution-plan.js
│   │   │   ├── daily-actual.js
│   │   │   ├── page-adapter.js
│   │   │   ├── wbs-plan.js
│   │   │   ├── weekly-context.js
│   │   │   └── weekly-summary.js
│   │   └── weekly-approval/
│   ├── popup/
│   │   ├── popup.css
│   │   └── popup.html
│   ├── shared/
│   │   ├── ai-request-body.js
│   │   ├── defaults.js
│   │   └── protocol.js
│   └── manifest.json
├── test/
│   ├── fixtures/
│   ├── integration/
│   ├── unit/
│   └── extension.spec.js
├── package.json
└── playwright.config.js
```

允许实施时根据实际职责微调文件名，但不得改变运行环境优先的目录原则，也不得重新引入跨 bundle 的运行时全局依赖。

### 目标 module interface

- 日报审核 module：`createDailyApprovalAutomation(adapters)` 返回只包含 `run()` 的 interface。分页、payload、确认状态和顺序审批隐藏在 implementation 内。
- 周报审核 module：`createWeeklyApprovalAutomation(adapters)` 返回只包含 `preview()` 与 `run(selection)` 的 interface。详情复查、状态判断和批复传输隐藏在 implementation 内。
- 批量报工 module：`createBatchWorkAutomation(adapters)` 返回只包含 `run(mode)` 的 interface。`summary/hours/plan/all` 的保存顺序、日报匹配、AI 总结和下周计划编排隐藏在 implementation 内。
- content runtime module：`startContentRuntime(adapters)` 负责页面识别、bundle 注入、控件状态和消息路由；每类页面的挂载位置仍由专用 adapter 处理。
- background runtime module：`registerBackgroundRuntime(adapters)` 负责配置、模型查询、cache 和 AI port 生命周期。
- protocol module：暴露消息常量、构造函数和解析/校验函数；调用方不直接拼接 `source/type/requestId`。

生产 adapter 使用真实 `window/document/fetch/chrome.runtime/DataTablesUtil/WkFormJS`；测试 adapter 使用 fake DOM、fake fetch、fake port 和内存状态。测试从上述 interface 进入，不穿透 implementation 私有函数。

## Context

**Relevant files:**

- `package.json` — 当前只有 `node --test`，需要增加 ESM、构建、监听、验证和打包命令。
- `manifest.json` — 当前直接指向根目录脚本，并公开多个 UMD module；迁移后源文件移动到 `src/manifest.json`，构建时生成生产或测试 manifest。
- `content.js` — 当前包含页面识别、脚本注入、控件、消息桥和 AI port；将拆为 content runtime 内部 module。
- `background.js` — 当前包含配置、模型请求、cache、SSE 解析和 port 生命周期；将拆为 background runtime 内部 module。
- `popup.js`、`popup.html`、`popup.css` — 迁移到 ESM entry 与 `src/popup/` 静态资源。
- `page-batch-approve.js` — 日报审核 page-context implementation。
- `page-batch-weekly-approve.js` — 周报审核 page-context implementation。
- `page-batch-work.js` — 批量报工 page-context 编排、DOM/DataTables adapter 和 AI 页面状态。
- `jxmis-transport.js`、`weekly-detail.js` — page 环境共享 adapter/normalization，当前使用 UMD。
- `wbs-plan.js`、`daily-actual.js`、`current-week-execution-plan.js`、`weekly-context.js`、`weekly-summary.js` — 已有纯逻辑 module，迁移为 ESM 并保留行为。
- `ai-request-body.js`、`defaults.js` — background/popup 可复用的共享逻辑。
- `test/*.test.js` — 当前 CommonJS `node:test` 测试，迁移到 ESM 并按 test surface 重新组织。
- `README.md` — 当前要求从仓库根目录加载扩展，需要改为 `dist/`。
- `docs/项目架构优化建议.md` — 旧架构快照，需要记录建议落实状态和剩余风险。
- `.gitignore` — 已有用户修改；只能保留并追加生成目录规则。

**Patterns to follow:**

- `wbs-plan.js`、`daily-actual.js` — 纯规则返回结果、不直接操作 DOM 的模式继续保留，但去掉 UMD 包装。
- `weekly-context.js` — 依赖通过 adapter 注入的模式继续保留，避免 module 内创建不可替换的页面依赖。
- `test/current-week-execution-plan.test.js` — 从稳定输入验证可观察结果的测试方式继续保留。
- `.ai/specs/content-automation-registry.md` — automation 注册表的既有设计意图继续保留，不退回按页面复制注入逻辑。
- `.ai/specs/jxmis-transport-adapter.md` — transport 只处理传输和协议，不吸收日报、周报或 WBS 业务规则。

**Key decisions already made:**

- 在新分支 `refactor/esbuild-src-migration` 实施。
- bundler 使用 esbuild，不引入 Vite 或前端框架。
- `dist/`、`dist-test/`、Playwright 报告和发布 ZIP 不提交 Git；Chrome 加载 `dist/`。
- 六个运行入口分别构建，三个 page bundle 不合并成一个全量 bundle。
- `src/` 和 Node 测试统一使用 ESM；浏览器输出使用 IIFE。
- 目录以运行环境为一级，以业务功能为二级；顶层 `shared/` 只放真正跨运行环境的代码。
- 消息协议集中到 `src/shared/protocol.js`，构建时分别内联到各 bundle。
- 采用增量迁移，每个任务完成后 `dist/` 必须仍可运行。
- Playwright 只访问本地 fixture；真实 JXMIS 登录页不进入自动化测试。
- 迁移结束后删除旧根目录 implementation，不保留长期兼容 shim 或双实现。
- 规格共 8 个原子任务，每个任务独立验证和提交。
- 新增 devDependencies 限于 `esbuild`、`@playwright/test` 和用于跨平台生成 ZIP 的 `archiver`；不得引入应用运行时依赖。

## Constraints

**Must:**

- 修改任何现有 function/module 前，按项目要求先运行 GitNexus upstream impact analysis，并向用户报告 direct callers、affected processes 和 risk level；HIGH/CRITICAL 必须先警告再编辑。
- 每个任务提交前运行 `gitnexus_detect_changes()`；若 GitNexus MCP 不可用，必须先恢复/刷新索引，不能静默跳过。
- 创建分支时保留当前工作树内所有用户修改，不覆盖、不回滚、不混入任务提交。
- 保持 Manifest V3，保持现有 permissions、host permissions、页面匹配范围和 page-context 执行语义。
- page 自动化代码必须继续运行在 JXMIS 页面上下文；content script 只负责注入、UI 和跨环境桥接。
- 构建输出文件名稳定，不使用内容 hash，确保 manifest 和注入器可以静态引用。
- esbuild 浏览器 target 至少覆盖当前 Chrome MV3；禁止生成 `eval` 或依赖远程代码。
- `npm run build` 必须先清理输出，再生成完整可加载的 `dist/`；失败时不得留下看似完整的旧产物。
- `npm run dev` 使用 esbuild watch；`npm run package` 以生产模式重建后生成 ZIP。
- 测试 manifest 只能生成到 `dist-test/`，仅测试构建额外允许 `http://127.0.0.1/*`；生产 manifest 不得包含 localhost 权限。
- 保持现有 JXMIS endpoint、请求参数、header、payload、状态判断、延迟策略和错误文案语义。
- 保持批量报工当前保存顺序：当前周执行数据与周报总结先保存，再生成/校验下周计划，满足条件时再触发后续保存。
- AI stream 必须覆盖 status、reasoning、chunk、done、error、disconnect 和 abort；同一时间只允许一个活动请求。
- 迁移测试时优先通过深 module 的外部 interface 验证行为；只有真实 adapter 才直接测试 DOM、Chrome API 或 SSE 解析。
- 更新 `package-lock.json`，保证全新 checkout 可通过 `npm ci` 安装。
- 保留 `.gitignore` 当前内容，只追加 `node_modules/`、`dist/`、`dist-test/`、`release/`、`playwright-report/`、`test-results/` 等生成目录。
- 所有新增文档使用中文；代码标识符和文件名使用 ASCII。

**Must not:**

- 不改变日报审核、批量报工、周报审核、popup 配置或项目负责人覆盖功能的业务行为。
- 不把 JXMIS 业务 endpoint 塞进通用 transport module。
- 不为每个小函数建立独立 adapter；只有生产与测试两种实现确实存在时才建立 seam。
- 不让测试依赖内部私有函数、构建后的 bundle 内部变量或 `window.Cw*`。
- 不在多个 bundle 之间依赖共享全局变量或隐式脚本加载顺序。
- 不提交 `dist/`、`dist-test/`、ZIP、Playwright 浏览器缓存、截图或报告。
- 不在 Playwright 中请求真实 `jxmis.cyberwing.cn`、读取真实账号、复用用户 Cookie 或执行真实审批/保存。
- 不顺手修改与迁移无关的业务功能、文档或用户工作树内容。
- 不在规格确认前创建实施分支、修改运行时代码或提交变更。

**Out of scope:**

- TypeScript 迁移。
- React/Vue/Svelte 等 UI 框架。
- Chrome Web Store 发布、签名、自动上传或 CI/CD。
- 真实 JXMIS 登录自动化和线上接口 E2E。
- 改造 JXMIS 页面本身、替换 DataTables 或 `WkFormJS`。
- 修改 AI provider 的业务参数、prompt 内容或模型选择逻辑。
- 新增日报、周报、WBS 或项目负责人相关业务能力。

## Tasks

### T1: Esbuild 构建与产物骨架

**Do:** 新建 `scripts/build.mjs` 和 `scripts/package.mjs`，安装锁定的 devDependencies，建立 development/test/production 三种构建模式。第一阶段仍以现有根目录脚本为输入，完整复制 manifest 与 popup 静态资源，保证 `dist/` 行为与当前直接加载根目录一致。增加固定输出名、清理后构建、watch、测试 manifest、ZIP 打包和失败退出；补充构建脚本测试或可验证的产物断言。

开发构建保留可调试 source map，测试构建输出到 `dist-test/` 并只在 manifest 中追加 localhost match，package 构建启用生产压缩且不携带 source map。`npm run build`、`npm run dev`、`npm run build:test`、`npm run package`、`npm run test:unit`、`npm run test:e2e`、`npm run verify` 的职责必须清晰且不循环调用。

**Files:** `package.json`, `package-lock.json`, `.gitignore`, `scripts/build.mjs`, `scripts/package.mjs`, `src/manifest.json`, `src/popup/popup.html`, `src/popup/popup.css`, `test/unit/build-output.test.js`

**Verify:** `npm ci && npm run build && npm run build:test && npm run test:unit`;检查 `dist/manifest.json` 不含 localhost、`dist-test/manifest.json` 只增加 localhost、两个目录所引用文件均存在；`npm run package` 生成可解压且根目录含 `manifest.json` 的 ZIP。

**Commit:** `T1: add esbuild build pipeline`

### T2: 共享消息协议 module

**Do:** 新建 `src/shared/protocol.js`，集中 daily/work/weekly/project-manager/AI/cache 的 source、type、请求与响应结构。提供消息构造、source/type/requestId 校验和 AI stream 事件解析；未知或畸形消息返回明确的无效结果，不抛出导致 content runtime 中断的异常。先保持旧调用方可运行，协议 module 在后续任务逐入口接入。

协议 interface 必须小于当前散落字符串集合：调用方只学习消息类别和 payload，不重复知道 `source/type/requestId` 拼装规则。测试覆盖合法消息、额外字段、缺少 requestId、错误 source/type、未知 AI event 和 cache response。

**Files:** `src/shared/protocol.js`, `test/unit/protocol.test.js`

**Verify:** `npm run test:unit -- test/unit/protocol.test.js && npm run build`

**Commit:** `T2: centralize extension message protocol`

### T3: 纯逻辑 module 与单元测试迁移

**Do:** 将 `jxmis-transport`、weekly detail、WBS plan、daily actual、current-week execution plan、weekly context、weekly summary、AI request body 和 defaults 移入目标 `src/` 目录，去掉 UMD/IIFE 和 `module.exports`，改为 ESM named exports。把现有 CommonJS 测试迁移到 `test/unit/` ESM，并在 `package.json` 设置 `"type": "module"`。

迁移期间构建脚本可为尚未迁移的 page script 临时生成 `Cw*` 兼容 global 输出，但兼容规则必须集中在构建配置，并在 T8 删除。不得在 ESM 源码内写回 UMD wrapper。保持现有 72 项行为测试，并删除只验证 wrapper/global 的测试。

**Files:** `src/page/shared/*.js`, `src/page/batch-work/*.js`, `src/shared/ai-request-body.js`, `src/shared/defaults.js`, `test/unit/*.test.js`, `package.json`, `scripts/build.mjs`

**Verify:** `npm run test:unit && npm run build && npm run build:test`;测试数量不得少于迁移前 72 项，除非删除项已由更深 module interface 的测试明确替代。

**Commit:** `T3: migrate shared logic to ESM`

### T4: 日报与周报审核 page bundle

**Do:** 将日报审核和周报审核分别迁移为 `createDailyApprovalAutomation(adapters)`、`createWeeklyApprovalAutomation(adapters)` 深 module，并由两个 page entry 在页面上下文安装消息监听。复用 ESM transport、weekly detail 和 protocol；收敛 GET/POST headers、HTTP 错误和 delay adapter，但日报/周报 endpoint 与业务判断留在各自 implementation。

测试通过 fake transport、fake clock 和内存消息 adapter 覆盖分页、空列表、顺序处理、失败继续/终止语义、周报负责人和状态复查、批复后复查。content 暂时只需把注入目标切到两个新 bundle；不得同时注入旧 page script。

**Files:** `src/entries/page-daily-approval.js`, `src/entries/page-weekly-approval.js`, `src/page/daily-approval/*.js`, `src/page/weekly-approval/*.js`, `src/page/shared/jxmis-transport.js`, `content.js` 或迁移中的注入配置, `scripts/build.mjs`, `src/manifest.json`, `test/integration/*approval*.test.js`

**Verify:** `npm run test:unit && node --test test/integration/*approval*.test.js && npm run build`;检查生产 manifest 只公开两个新审批 page bundle，不公开其内部 ESM module。

**Commit:** `T4: bundle approval page automations`

### T5: 批量报工深 module 与 page bundle

**Do:** 将批量报工迁移到 `src/page/batch-work/`，保留 `createBatchWorkAutomation(adapters).run(mode)` 这一外部 interface。将 DOM/DataTables、`WkFormJS`、JXMIS 请求、content bridge 与时钟实现放入生产 page adapter；日报匹配、当前周变更计划、周报总结状态和 WBS 计划保持为内部纯 module。删除 `window.Cw*` wrapper 和同文件 pass-through helper。

为 `summary/hours/plan/all` 建立工作流契约测试，验证调用顺序和可观察结果，尤其覆盖：缺少 AI 配置时 all 模式继续、summary 模式失败；当前周无修改；下周无插入；缺少 majorPerson 跳过下周保存；AI error/disconnect；当前周保存后才生成下周计划；同一日报数据同时供工时与总结使用。page entry 只负责创建生产 adapter、安装消息监听和报告顶层错误。

**Files:** `src/entries/page-batch-work.js`, `src/page/batch-work/*.js`, `src/page/shared/*.js`, `content.js` 或迁移中的注入配置, `scripts/build.mjs`, `src/manifest.json`, `test/integration/batch-work.test.js`

**Verify:** `npm run test:unit && node --test test/integration/batch-work.test.js && npm run build`;检查 work 页面只注入 `page-batch-work.js` 一个 bundle，构建产物中不存在 `CwWbsPlan/CwDailyActual/CwWeeklySummary/CwWeeklyContext` 全局引用。

**Commit:** `T5: bundle batch work automation`

### T6: Content、background 与 popup runtime 迁移

**Do:** 将 content、background、popup 迁入目标目录并建立三个 entry。content 使用 automation registry 声明 matcher、page bundle、控件 adapter 和 message handlers；共享 status control 只处理状态，不吸收各页面挂载细节。AI bridge 使用 protocol module 转发 status/reasoning/chunk/done/error/disconnect，并保证活动 port 清理和 stale request 隔离。

background 将配置/cache、模型请求、request body 和 SSE parser 分开；`registerBackgroundRuntime(adapters)` 安装 Chrome listeners。SSE parser 对 chunk 边界、多个 data 行、`[DONE]`、reasoning、正文、畸形 JSON、abort 和无正文完成提供稳定结果。popup 继续保持现有表单行为和 storage key。

移除 content 对旧共享脚本的逐个注入，最终 automation registry 每类页面只注入一个 page bundle。生产 manifest 的 `web_accessible_resources` 只列三个 page bundle。

**Files:** `src/entries/background.js`, `src/entries/content.js`, `src/entries/popup.js`, `src/background/*.js`, `src/content/*.js`, `src/popup/*`, `src/shared/*.js`, `src/manifest.json`, `scripts/build.mjs`, `test/unit/ai-stream.test.js`, `test/integration/content-runtime.test.js`, `test/integration/background-runtime.test.js`

**Verify:** `npm run test:unit && node --test test/integration/content-runtime.test.js test/integration/background-runtime.test.js && npm run build`;静态检查 manifest 只引用六个入口和 popup 静态资源。

**Commit:** `T6: migrate extension runtimes to src`

### T7: 离线 Playwright 扩展冒烟

**Do:** 新建 Playwright 配置、本地 fixture server 和三个 JXMIS 页面 fixture。测试构建使用 `dist-test/manifest.json` 加载 unpacked extension，通过本地 URL 分别模拟日报审核、周报填报和周报审核页面。fixture 只实现自动化所需的 DOM、DataTables、`WkFormJS`、fetch 和消息行为，不复制真实业务页面。

测试至少验证：扩展成功加载；content matcher 选择正确 automation；每页只注入对应 page bundle；按钮和状态控件出现；点击触发 page 消息；一个批量报工 happy path 能观察到 fake `saveAll()`；AI chunk/done/error 能返回页面状态。测试必须断言没有向真实 JXMIS 域名发出请求。

**Files:** `playwright.config.js`, `scripts/serve-fixtures.mjs`, `test/fixtures/*`, `test/extension.spec.js`, `scripts/build.mjs`, `package.json`

**Verify:** `npx playwright install chromium && npm run test:e2e`;所有测试只访问 loopback 地址，失败时保留 trace 但不提交报告。

**Commit:** `T7: add offline extension smoke tests`

### T8: Legacy 清理与中文文档收尾

**Do:** 删除根目录旧运行时 JS、旧 manifest/popup 静态源、构建期 `Cw*` compatibility globals 和旧测试路径。确认 `src/` 是唯一 implementation，`dist/` 是唯一加载目录。更新 README 安装与命令；将架构优化建议改为历史建议落实状态；新增中文架构文档，说明六入口、运行环境、module interface、adapter seam、消息协议、测试边界和手动 UAT。

手动 UAT 清单必须覆盖日报批量审批、批量报工四种 mode、当前周/下周保存顺序、AI summary 的 done/error、周报批量审核、popup 配置和项目负责人覆盖。未实际执行的真实页面步骤只能标记“待人工执行”，不能写成已通过。

**Files:** 根目录旧运行时代码, `scripts/build.mjs`, `src/**`, `test/**`, `README.md`, `docs/项目架构优化建议.md`, `docs/项目架构说明.md`, `.gitignore`

**Verify:** `npm ci && npm run verify && npm run package && git diff --check`;使用 `rg` 确认源码不存在 `window.Cw`、UMD `module.exports = factory`、manifest 根脚本引用和旧 page script 注入；解压发布 ZIP 后所有 manifest 引用存在。

**Commit:** `T8: remove legacy runtime and document architecture`

## Done

- [ ] 在保留现有用户工作树修改的前提下，从 `refactor/esbuild-src-migration` 分支完成 T1-T8 原子提交。
- [ ] `npm ci` 在干净依赖环境安装成功。
- [ ] `npm run build` 生成可加载的 `dist/`，生产 manifest 不含 localhost 权限。
- [ ] `npm run build:test` 生成隔离的 `dist-test/`，只测试 manifest 允许 loopback fixture。
- [ ] `npm run test:unit` 覆盖迁移后的领域规则、protocol 和 SSE parser。
- [ ] 工作流契约测试覆盖日报审核、周报审核、批量报工、content bridge 和 background runtime。
- [ ] `npm run test:e2e` 在离线 Chromium fixture 中通过，且未请求真实 JXMIS。
- [ ] `npm run verify` 汇总构建、单元、契约和离线浏览器验证并通过。
- [ ] `npm run package` 生成可解压 ZIP，ZIP 根目录含有效 `manifest.json` 和全部六入口。
- [ ] Git 跟踪文件不包含 `dist/`、`dist-test/`、发布 ZIP、Playwright 报告或浏览器缓存。
- [ ] 根目录不再存在旧运行时 JS、旧 manifest/popup 源或 UMD compatibility shim。
- [ ] 源码不存在 `window.Cw*` 跨 bundle 全局依赖，page runtime 不依赖隐式脚本顺序。
- [ ] 生产 manifest 的 `web_accessible_resources` 只公开三个 page bundle。
- [ ] README、架构落实状态和新架构说明均为中文且与最终代码一致。
- [ ] 每个 T1-T8 提交前都完成 GitNexus change detection，提交只包含该任务预期范围。
- [ ] Manual：在真实已登录 JXMIS 中逐项执行文档 UAT；未执行前保持“待人工验证”状态。
