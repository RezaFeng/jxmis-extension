# JXPMO 实时经营分析重构

## Why

当前经营分析把任意空值统一显示为“无法历史回溯”，并依赖 IndexedDB 快照提供历史、环比和全部部门数据；这与实际使用方式不一致，也掩盖了字段为空、分母为零和技术失败之间的区别。经营报告应始终基于当前 JXPMO 会话实时取数，可按所选周期实时重算相邻上期，并沿用旧报告清晰的统计层级，但不能保留其默认隐藏筛选和文件式历史口径。

## What

将经营分析改造成完全实时、无持久化报告数据的浏览器内分析：

- 每次查询和刷新都重新请求 JXPMO，不读取或保存报告快照、指标历史、原始查询缓存或失败项缓存。
- 同一次查询内复用公共来源，并在当前页面内保留结果和失败 descriptor，支持临时筛选、HTML 导出、取消和仅重试失败项。
- 实时累计指标只展示当前值；可按日期重建的期间指标同时计算本期、紧邻等长上期和环比。
- 成功响应中的空数值按 `0`，比率分母为 `0` 时结果为 `0`；技术失败仍为“未获取”。
- Options 增加默认开启的“仅统计本期有日报投入的项目”，正式范围按本期 `sum(realHour) > 0` 确定并明确显示 `N/M`。
- “全部部门”实时一次采集有效部门项目并集，项目按 `projectId` 去重，不再聚合快照。
- 报告按数据状态、经营速览、实时累计概览、期间环比、项目明细、里程碑/回款、PM/预算/执行、完整性诊断的顺序展示。
- 删除所有“无法历史回溯”“历史快照”“区间执行报告”“缓存时间”文案和 Options 中的缓存/历史清理控件。

完成标准：任意日期范围查询只展示本次实时取数结果；正式项目范围和本/上期比较口径可解释；技术缺失不会伪装成业务零值；关闭页面后不存在可被下一次查询复用的经营报告数据。

## Context

**Relevant files:**

- `src/analytics/config.js` — 项目筛选默认值、配置版本；新增本期日报投入开关并移除报告 key/快照身份职责。
- `src/analytics/domain.js` — 项目数值规范化；空数值补零的统一语义。
- `src/analytics/date-range.js` — 紧邻等长上期范围。
- `src/analytics/formulas.js` — 累计、期间、WBS 和 ratio 公式；实现分母零返回零。
- `src/analytics/engine.js` — 35 项值、项目/PM/预算/风险、公司聚合和原快照历史逻辑；改为当前/上期实时比较模型。
- `src/analytics/html-export.js` — 正式实时报告的自包含导出。
- `src/page/business-analytics/normalizers.js`、`invoice.js`、`weekly-reports.js` — 日报、WBS、回款和周报数值/日期规范化。
- `src/page/business-analytics/scope.js` — 静态配置与部门 ID 范围；增加日报取数后的正式范围收敛。
- `src/page/business-analytics/jxpmo-data.js` — 全分页实时数据 adapter；为本/上期复用提供原始来源。
- `src/page/business-analytics/collector.js` — 查询取消、公共来源、项目级并发、失败 descriptor；改成一次返回本期和上期需要的数据。
- `src/content/business-analytics/controller.js` — 当前读取快照、持久化、全部门快照聚合；改成单一实时查询状态机和页面内重试。
- `src/content/business-analytics/report-view.js`、`report.css` — 空值文案、卡片、区块顺序、正式范围和期间比较展示。
- `src/options/options.html`、`options.js` — 新增本期投入范围开关，删除本地经营数据清理控件。
- `src/shared/defaults.js`、`protocol.js` — 配置默认值和跨 world 消息；删除持久化消息，只保留查询生命周期。
- `src/background/runtime.js`、`src/background/business-analytics/repository.js` — 删除经营报告 repository 组合；升级时幂等清理旧 `cw-business-analytics` IndexedDB。
- `test/unit/analytics-*.test.js`、`test/integration/analytics-*.test.js` — 数值、范围、实时比较、全部部门、失败和 controller 契约。
- `test/integration/options.test.js`、`background-runtime.test.js` — 配置迁移和持久化消息移除。
- `test/extension.spec.js`、`scripts/serve-fixtures.mjs`、`test/fixtures/project.html` — 浏览器实时查询、上期比较、全部部门和无持久化回归。
- `test-results/weekly_report_健新科技_2026-07-15.html` — 旧报告的统计顺序、卡片命名和期间比较参考；不得复制其 baseline、人员成本、默认隐藏筛选和会议待办实现。
- `README.md`、`docs/项目架构说明.md`、`docs/经营分析数据字典.md`、`docs/经营分析UAT.md` — 实现后删除快照口径并记录实时规则。

**Patterns to follow:**

- 深 module：collector 的 interface 只接收查询身份和配置，隐藏两周期取数、共享请求、并发、来源状态和重试实现；engine 的 interface 只接收规范化实时数据并返回报告。
- 生产/测试 adapter seam：沿用 `createJxpmoAnalyticsData(adapters)` 和 collector fake data adapter，不让 engine 访问网络、DOM 或 Chrome API。
- 正式/临时口径：沿用 controller/view 的正式报告与临时项目选择分离；导出始终使用正式实时报告。
- 来源状态：沿用 `success/empty/failed/notApplicable`，只有 `failed` 依赖值为未知。
- 单次查询复用：公共项目、日报、组织树和结束月回款只取一次；全部部门不逐部门重复采集。
- 跨环境消息集中在 `src/shared/protocol.js`，继续使用 `requestId` 丢弃迟到结果。

**Key decisions already made:**

- 所有经营报告实时取数；查询与刷新等价，不做后台定时取数。
- 删除 IndexedDB 报告快照、指标历史、查询缓存和持久化失败 descriptor。
- 页面内可暂存本次正式数据和失败 descriptor；关闭页面即丢弃。
- 当前累计指标包括软件与服务合同、BAC、AC、CR、累计 EV、整体人均产值、CPI、CCPI、EAC，只显示实时值，不做周期环比。
- 软件与服务合同优先使用项目 `subcontractAmount`；其为空时使用同单位的 `tqSoftAmount`，两者均为空时为 0。非空非法值保持 schema error。
- 期间比较只覆盖可按日期重建的数据：日报投入/成本、区间 WBS PV/EV/SPI、区间产服 EV/CPI/CCPI/人均、里程碑、回款和周报计划。
- 上期是当前区间之前紧邻的等长区间；自然周自动对应上一周一至周日。
- 本期和上期使用同一本期正式项目集合，避免项目集合变化污染环比。
- 成功响应中的空数值（`null/undefined/""`）按 `0`；非法数字文本仍为 schema error。
- 标识和必要日期不补零；缺失时产生 schema error 或排除不完整记录。
- 比率分母为 `0` 时返回 `0`；分子/分母因技术失败未知时返回 `null`。
- 合法空列表产生已知零值；接口、会话、分页或 schema 技术失败保持“未获取”。
- “仅统计本期有日报投入的项目”默认开启，条件为本期 `sum(realHour) > 0`，上期投入不参与正式范围判定。
- 环比固定使用本期正式项目集合；另行诊断本期新增投入和上期退出投入项目。
- 全部部门实时采集有效部门项目并集，项目按 `projectId` 去重，公共来源只取一次，项目级请求默认并发不高于 4。
- 页面临时搜索、筛选和勾选不能暗中覆盖正式统计；必须明确标识“临时选择 N/M”。
- 旧报告只参考信息层级；不恢复 baseline.xlsx、人员岗级成本、销售部门回款、会议待办或 Node/Python 流水线。

## Business Specification

### 1. 报告口径

- **静态候选项目集合**：先按属性、分类、一级状态、执行类型和部门 ID 过滤项目主数据。
- **本期正式项目集合**：若 `onlyCurrentPeriodInput=true`，在静态候选集合中保留本期日报工时之和大于 0 的项目；否则等于静态候选集合。
- **上期比较集合**：始终与本期正式项目集合相同。
- **全部部门集合**：所有有效部门的本期正式项目集合并集，按 `projectId` 去重。
- **临时选择集合**：页面搜索、筛选、勾选后的子集，只用于前端临时分析，不改变正式报告、导出或全部部门。

配置新增：

```json
{
  "onlyCurrentPeriodInput": true
}
```

该字段进入 `configVersion`。Options 显示为默认开启的 checkbox，文案为“仅统计本期有日报投入的项目”。报告状态条显示：

```text
正式范围 7/12 · 仅本期日报投入项目 · 来源覆盖率 100%
```

### 2. 日期与环比

当前范围为闭区间 `[startDate, endDate]`，天数为 `N`：

```text
previousEndDate = startDate - 1 天
previousStartDate = previousEndDate - (N - 1) 天
delta = current - previous
changeRate = previous == 0 ? 0 : delta / previous
```

累计实时指标没有 `previous` 和 `changeRate`。期间指标返回稳定结构：

```text
comparison = {
  current: number | null,
  previous: number | null,
  delta: number | null,
  changeRate: number | null
}
```

任一周期依赖来源技术失败时，相应值和派生变化为 `null`；成功空数据为 `0`。

### 3. 数值与失败语义

规范化规则：

| 输入 | 结果 |
|---|---|
| `null`、`undefined`、`""` 数值 | `0` |
| 合法数字/数字字符串 | 有限 number |
| 非法数字文本、Infinity、NaN | schema error |
| 缺失项目 ID、部门 ID、必要日期 | schema error 或按明确规则排除记录 |
| 成功空列表 | 已知零值 |
| 来源 `failed` | 依赖值 `null` |
| ratio 分母 `0` 且输入已知 | `0` |
| ratio 任一输入未知 | `null` |

页面格式化：`0` 显示为数值零；`null` 显示“未获取”。禁止继续使用“无法历史回溯”。

### 4. 指标分组

#### 4.1 实时累计经营概览

保持 12 张卡片、13 个值：项目数、软件与服务合同、BAC、AC、CR、EV、整体人均产值、CPI、CCPI、EAC、需关注项目数、当月 SPI、总 SPI。

- 前 10 类累计项目主数据指标只显示实时值。
- 当月 SPI 和总 SPI 来自当前 WBS 数据按结束日期截断；虽然位于累计概览，也允许按 WBS 日期计算上期诊断，但顶部卡片只显示当前值，详细期间区块展示比较。
- 累计汇总中单项目空数值已规范化为 0，不再因一个空字段使部门总值整体变为 `null`。

#### 4.2 期间经营比较

按本期正式项目集合计算：

- 投入项目数、投入人天、投入成本。
- 区间 PV、EV、SPI。
- 区间产服 EV、CPI、CCPI、人均产值。
- 下期计划人天。
- 本月里程碑应完成、完成、完成率、逾期、未来 7 天。
- 结束月回款计划、实收、待回、逾期笔数。

每个可比指标显示本期、上期和环比；数量和金额也保留 `delta`。当月指标分别使用本期 `endDate` 和上期 `endDate` 所在自然月。

#### 4.3 范围变化诊断

- `enteredProjectIds`：本期投入大于 0、上期投入等于 0。
- `exitedProjectIds`：上期投入大于 0、本期投入等于 0。
- 只展示项目 ID/编码/名称和两期投入人天，不改变正式比较集合。

### 5. 实时采集编排

单部门和全部部门使用同一 collector interface：

1. 获取组织树和项目全分页，形成静态候选项目集合。
2. 一次并行获取本期日报、上期日报，以及本/上期结束月回款补充；同月时只请求一次。
3. 根据本期日报和 `onlyCurrentPeriodInput` 收敛本期正式项目集合。
4. 空正式集合返回完整零值报告，不启动项目级请求。
5. 对正式项目集合受控并发获取 WBS、里程碑、周报列表/详情和项目回款；可复用的全量列表不得按周期重复请求。
6. engine 使用同一项目集合分别计算本期和上期期间指标，并生成比较结果。
7. collector 返回后不向 background 保存任何经营数据。

`departmentId=all` 时，步骤 3 对每个有效部门分别收敛范围，然后合并项目并集；engine 从同一批规范化数据生成公司总览和部门对比，不能发起逐部门重复查询。

### 6. 页面与交互

报告顺序固定为：

1. 数据状态条：周期、正式范围、配置摘要、来源覆盖率、查询时间。
2. 经营速览：风险项目、逾期里程碑、逾期回款、需要跟进事项。
3. 实时累计经营概览。
4. 本期经营与上期比较。
5. 项目明细及临时筛选。
6. 里程碑与回款明细。
7. PM、预算健康度和项目执行情况。
8. 数据完整性与范围变化诊断。

交互规则：

- “查询”和“刷新”都启动新的实时查询；可保留两个按钮，但文案和行为必须一致，或合并为一个“查询”按钮。
- 新查询、部门切换和取消会 Abort 旧任务并忽略迟到结果。
- 部分失败保留可用结果；“仅重试失败项”只使用当前页面内存 descriptor。
- 正式范围、临时范围和来源失败必须视觉区分。
- HTML 导出当前正式实时报告；不包含临时选择、认证信息、人员级日报、失败 descriptor 或外部请求。

### 7. 删除持久化与升级清理

- 删除 controller 中 `createReportKey`、读取/保存快照、历史模式、query cache 和 background 失败 descriptor 路径。
- 删除 protocol/background runtime 中仅服务经营持久化的消息类型。
- 删除 `src/background/business-analytics/repository.js` 及其单元测试；若 background 仍需一次性迁移实现，使用小型、幂等的 legacy cleanup 函数，不保留 repository interface。
- 扩展升级后 best-effort 调用 `indexedDB.deleteDatabase("cw-business-analytics")`；被旧页面连接阻塞时记录不含业务数据的警告并在下次 service worker 启动重试。
- 删除 Options 的“清理原始缓存”“清理全部历史”按钮。
- AI 周报总结 cache 属于现有独立业务，不在本次删除范围。

## Constraints

**Must:**

- 继续复用当前 JXPMO 同源会话和页面权限，不读取或保存 JSESSIONID。
- 保持 MAIN/ISOLATED/background 分工和 requestId 消息校验。
- 所有公共来源在单次查询内最多请求一次；全部部门不得逐部门重复拉取。
- 技术失败不能按 0，且必须进入来源状态和覆盖率。
- 公式只能存在于 `src/analytics/`，view 不从 DOM 文本反算。
- 正式范围和临时范围分离，报告中明确显示正式范围。
- 保持日报审批、批量报工、AI 总结和周报审核行为不变。
- 每个任务独立测试、独立 Git 提交；提交前运行 GitNexus staged 影响检测。

**Must not:**

- 不保留经营报告 IndexedDB、快照、历史趋势或跨页面失败缓存。
- 不使用当前累计项目字段伪造上一周期累计指标。
- 不把网络/权限/会话/schema 失败转换为零。
- 不恢复 baseline.xlsx、回款 Excel、人员成本 Excel、固定 800 元成本、项目白名单或销售部门回款。
- 不复制旧 HTML 的默认“执行+仅有投入”隐藏页面筛选；正式投入范围必须来自显式 Options 配置。
- 不增加第三方运行时依赖，不修改无关审批/报工规则。

**Out of scope:**

- 累计项目主数据的历史版本和累计指标环比。
- 后台定时采集、跨设备同步和长期趋势图。
- JSON、PDF、PPT 导出。
- AI 经营解读、会议待办和向 JXPMO 写回分析结果。

## Tasks

### T1：实时配置与数值语义

**Do:** 增加默认开启的 `onlyCurrentPeriodInput` 配置并纳入版本；Options 增加 checkbox、删除缓存/历史清理控件；空数值补 0、ratio 分母零返回 0、技术未知保持 null；合法空 WBS/日报/回款生成零值。

**Files:** `src/analytics/config.js`, `src/analytics/domain.js`, `src/analytics/formulas.js`, `src/page/business-analytics/normalizers.js`, `src/page/business-analytics/invoice.js`, `src/options/options.html`, `src/options/options.js`, `src/shared/defaults.js`, `test/unit/analytics-config.test.js`, `test/unit/analytics-formulas.test.js`, `test/integration/options.test.js`

**Verify:** `node --test --test-name-pattern="analytics config|analytics formulas|options|invoice" test/unit/*.test.js test/integration/*.test.js`

### T2：本期正式范围与双周期实时采集

**Do:** collector 先获取本/上期日报再按配置收敛正式项目集合；本/上期固定使用同一项目集合；同月回款补充去重；返回范围变化诊断；失败 descriptor 只存在于本次结果。

**Files:** `src/page/business-analytics/scope.js`, `src/page/business-analytics/collector.js`, `src/page/business-analytics/jxpmo-data.js`, `src/page/business-analytics/weekly-reports.js`, `test/unit/analytics-scope.test.js`, `test/integration/analytics-collector.test.js`, `test/integration/analytics-data.test.js`

**Verify:** `node --test --test-name-pattern="analytics scope|analytics collector|analytics data|weekly reports" test/unit/*.test.js test/integration/*.test.js`

### T3：实时期间比较与全部部门聚合

**Do:** engine 删除 snapshot/history/cumulativeAvailable 分支；累计概览始终使用实时项目主数据；用同一正式项目集合计算本/上期期间结果和 comparison；全部部门从一次实时结果按部门分组、项目去重和重新计算比率。

**Files:** `src/analytics/engine.js`, `src/analytics/formulas.js`, `test/unit/analytics-engine.test.js`, `test/integration/company-analytics.test.js`, `test/integration/analytics-history.test.js`

**Verify:** `node --test --test-name-pattern="analytics engine|period comparison|company analytics" test/unit/*.test.js test/integration/*.test.js`

### T4：无持久化实时 controller 与协议清理

**Do:** controller 删除快照读取、历史模式、持久化和快照全部门路径；查询/刷新统一实时请求；失败重试使用页面内存；删除经营持久化消息、repository 和 Options 清理消息；background 启动时幂等删除旧 IndexedDB。

**Files:** `src/content/business-analytics/controller.js`, `src/shared/protocol.js`, `src/background/runtime.js`, `src/entries/background.js`, `src/background/business-analytics/repository.js`, `test/integration/analytics-history.test.js`, `test/integration/background-runtime.test.js`, `test/unit/analytics-repository.test.js`, `test/unit/protocol.test.js`

**Verify:** `node --test --test-name-pattern="analytics history|background analytics|protocol|legacy analytics database" test/unit/*.test.js test/integration/*.test.js`

### T5：报告信息层级与实时状态

**Do:** 按确认顺序重排区块；空值显示“未获取”；增加正式范围、配置、实时查询时间和覆盖率；期间卡片显示本期/上期/环比；增加进入/退出投入诊断；临时选择显式标识且不覆盖正式顶部统计。

**Files:** `src/content/business-analytics/report-view.js`, `src/content/business-analytics/report.css`, `test/integration/analytics-view.test.js`, `test/integration/company-analytics.test.js`

**Verify:** `node --test --test-name-pattern="analytics view|company analytics" test/integration/*.test.js`

### T6：实时正式报告导出

**Do:** HTML 导出适配 comparison、正式范围和新顺序；删除快照/历史文案；保留离线筛选、排序、CSP 和敏感字段白名单。

**Files:** `src/analytics/html-export.js`, `src/content/business-analytics/controller.js`, `test/unit/analytics-html-export.test.js`

**Verify:** `node --test --test-name-pattern="analytics html export" test/unit/*.test.js test/integration/*.test.js`

### T7：浏览器 E2E、文档和回归

**Do:** fixture 断言每次查询均实时请求；覆盖默认本期投入范围、空数值为 0、技术失败为未获取、上期比较、实时全部门、取消/重试、导出和无经营 IndexedDB；更新 README、架构、数据字典和 UAT。

**Files:** `scripts/serve-fixtures.mjs`, `test/fixtures/project.html`, `test/extension.spec.js`, `README.md`, `docs/项目架构说明.md`, `docs/经营分析数据字典.md`, `docs/经营分析UAT.md`

**Verify:** `npm run verify`

## Done

- [x] `npm run verify` 全部通过，原三类自动化无回归。
- [x] 查询和刷新每次都请求实时数据，不发送经营持久化消息。
- [x] 扩展升级后旧 `cw-business-analytics` IndexedDB 被幂等清理，运行时不再创建。
- [x] 默认正式范围仅包含本期日报投入大于 0 的项目，并在页面显示 `N/M`。
- [x] 成功空数值和零分母显示 0；技术失败显示“未获取”。
- [x] 累计经营指标只显示实时值，不出现伪历史环比。
- [x] 期间指标使用同一本期正式项目集合显示本期、紧邻上期和环比。
- [x] 全部部门通过一次实时采集生成，公共来源不按部门重复请求。
- [x] 页面不出现快照、缓存、区间执行报告或“无法历史回溯”文案。
- [x] 临时筛选不能覆盖正式统计，导出始终使用正式实时报告。
- [x] HTML 离线可用且不包含认证、人员级日报、失败 descriptor 或外部请求。
- [x] README、架构、数据字典和 UAT 与实时实现一致。
