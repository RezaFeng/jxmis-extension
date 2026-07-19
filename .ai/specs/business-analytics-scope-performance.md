# 经营分析部门范围与查询性能优化

## Why

优化前，经营分析面板只在打开时加载组织和全量项目，部门下拉框未按当前周期日报投入过滤；正式查询又重复获取项目和当前周期日报，导致部门数量不准确、首查和切换部门产生冗余请求。需要在用户选择部门前完成准确的有效项目计算，并在当前面板内按数据依赖复用结果。

## What

打开经营分析面板后，按 Options 配置并行获取组织、项目和必要的当前周期日报，计算每个部门的有效项目数，仅展示有效部门；用户选择部门后手动查询。项目请求只组合 `currStatus` 与 `outsourcing`，项目和日报使用 2000 条分页；正式查询复用条件未变化的面板工作数据，首次查询再获取上一周期日报和项目明细。

完成后应满足：部门下拉框启用前范围已确定，零项目部门隐藏，全部部门显示有效项目总数，切换部门不重复获取项目和日报，日期变化只使依赖数据失效，部分明细结果可诊断和导出。

## Context

**Relevant files:**

- `src/page/business-analytics/jxpmo-data.js` - JXPMO 组织、项目、日报及项目明细请求和分页。
- `src/page/business-analytics/scope.js` - Options 本地筛选、部门精确分组和周期投入范围。
- `src/page/business-analytics/collector.js` - 初始化范围、面板工作集、正式查询、并发和失败重试。
- `src/content/business-analytics/controller.js` - 面板打开、日期失效、手动查询和消息状态。
- `src/content/business-analytics/report-view.js` - 部门下拉框、日期事件、按钮和加载状态。
- `src/analytics/html-export.js` - 部分报告状态和文件名标识。
- `test/unit/analytics-scope.test.js` - 有效项目和部门范围口径。
- `test/integration/analytics-data.test.js` - 请求组合、分页和规范化契约。
- `test/integration/analytics-collector.test.js` - 工作集复用、并发、部分失败和取消。
- `test/integration/analytics-history.test.js`、`test/integration/analytics-view.test.js` - 控制器与视图交互。
- `test/extension.spec.js` - 扩展端到端经营分析流程。

**Patterns to follow:**

- 延续 `createJxpmoAnalyticsData(adapters)` 和 `createAnalyticsCollector(adapters)` 的生产/测试 adapter seam。
- 所有 MAIN/ISOLATED 消息继续使用 `requestId`，新请求取消旧请求，迟到结果不得覆盖当前状态。
- 分页以服务端 `recordsTotal/recordsFiltered/total` 为准，短页和总数不一致必须报错。
- 正式明细失败沿用 `sourceStatus`、`failedRequests`、覆盖率和“仅重试失败项”语义。

**Key decisions already made:**

- Options 由页面运行时读取；修改 Options 后由用户刷新业务页面重新获取和生成数据。
- 服务端项目请求仅组合 Options 中的 `currStatus` 与 `outsourcing`；“不限”不发送参数。
- `attribute`、`classification` 始终在客户端筛选；合并后按 `projectId` 去重并再次应用完整筛选。
- 有效项目基础条件为静态筛选匹配且 `realExeuCost > 0`；负数、零、空值和非法值均排除。
- `onlyCurrentPeriodInput=true` 时还要求当前周期 `realHour` 合计大于 0；为 `false` 时初始化跳过日报请求。
- 部门必须按 `projectDept` ID 与组织树匹配；零有效项目部门隐藏；保留“全部部门（N）”。
- 选择部门不自动查询，不做大范围确认；移除常驻“刷新”按钮和初始化错误重试按钮。
- 项目和日报分页大小为 2000，保留多页循环；项目级和初始化组合并发上限为 8。
- 日报明细接口以原始字段 `realEndTime` 作为业务日期；仅当其为空时依次兼容 `submissionTime`、`createTime`，归一化后统一写入内部字段 `taskDate`。不得依赖该接口不返回的 `taskDate`、`workDate`、`fillDate` 或 `costTime`。
- 项目和当前日报是当前面板内的临时工作数据，不跨面板持久化；条件未变化时复用。
- 上一周期日报在首次正式查询时获取，同日期范围内切换部门可复用；不后台预取。
- 初始化必要数据任一失败则不启用部门下拉框，只显示加载失败，由用户刷新页面恢复。
- 正式明细允许部分失败并仅重试失败项；部分报告允许导出，但必须明确标记不完整。

## Constraints

**Must:**

- 组织、项目和必要的当前日报并行初始化；全部成功后才启用部门与查询。
- 日期变化且 `onlyCurrentPeriodInput=true` 时取消旧请求、清空选择并自动重算范围。
- 日期变化且 `onlyCurrentPeriodInput=false` 时保留部门范围，正式查询使用新日期。
- 部门变化不得重新获取项目、当前日报或上一周期日报。
- 正式查询缺少当前/上一周期日报时只获取缺失依赖。
- 部分导出在页面状态、诊断和文件名中标识“数据不完整”。

**Must not:**

- 不使用 `likeAll` 按部门名称建立项目范围。
- 不把 6 组项目请求写死；请求数由 Options 中状态和执行类型决定。
- 不新增 IndexedDB、localStorage 业务缓存或后台定时抓取。
- 不监听 Options 保存事件，不在每次查询时重读 Options。
- 不改动经营分析以外的审批、批量报工或 AI 功能。

**Out of scope:**

- 周报列表和详情接口的进一步裁剪。
- JXPMO 后端接口或权限规则调整。
- 新增报告指标、修改风险阈值公式或重做报告布局。

## Tasks

### T1: 项目请求规划与有效范围

**Do:** 将项目/日报分页调整为 2000；按 `currStatus × outsourcing` 生成服务端请求；本地应用完整 Options；将 `realExeuCost > 0` 和当前周期正工时纳入有效范围，输出隐藏零项目部门后的部门集合。

**Files:** `src/page/business-analytics/jxpmo-data.js`、`src/page/business-analytics/scope.js`、对应单元和集成测试。

**Verify:** `npm run test:unit -- --test-name-pattern="analytics (data|scope)"`

### T2: 面板工作集与采集编排

**Do:** 初始化并行取数；按项目筛选和日期依赖维护仅限当前面板的工作数据；正式查询复用项目和当前日报，按需获取上一周期日报；并发上限改为 8，保留取消、部分结果和失败项重试。

**Files:** `src/page/business-analytics/collector.js`、`test/integration/analytics-collector.test.js`。

**Verify:** `node --test test/integration/analytics-collector.test.js`

### T3: 手动查询与日期失效交互

**Do:** 移除刷新按钮；部门选择只更新范围；日期变化按 `onlyCurrentPeriodInput` 决定是否自动重载范围；加载失败保持控件禁用；全部部门显示有效项目总数。

**Files:** `src/content/business-analytics/controller.js`、`src/content/business-analytics/report-view.js`、控制器/视图/E2E 测试。

**Verify:** `node --test test/integration/analytics-history.test.js test/integration/analytics-view.test.js`

### T4: 部分报告导出标识与回归验证

**Do:** 在部分报告导出状态和文件名中标记数据不完整，补充导出测试并运行完整构建、单元、集成与扩展测试。

**Files:** `src/analytics/html-export.js`、`test/unit/analytics-html-export.test.js`。

**Verify:** `npm run verify`

## Done

- [x] `npm run verify` 通过。
- [x] 默认 Options 产生 3 组状态请求，最终项目范围与完整 Options 谓词一致。
- [x] 当前周期日报一页可返回 2000 条，超过 2000 条时继续分页且校验总数。
- [x] 日报日期优先取 `realEndTime`，缺失时只回退 `submissionTime`、`createTime`，生产接口返回的日报可全部完成日期归一化。
- [x] 面板初始化完成前部门和查询不可用；零项目部门不显示。
- [x] 同日期切换部门不重复获取项目、当前日报和上一周期日报。
- [x] 日期变化按 `onlyCurrentPeriodInput` 精确失效依赖，旧响应不能覆盖新范围。
- [x] 全部部门、部分结果重试、取消和不完整导出无回归。
