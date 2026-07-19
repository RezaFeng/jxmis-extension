# 经营分析回款统计口径修正

## Why

现有经营分析使用“逐项目回款计划 + 当月合同补充”两个旧接口，字段映射与真实响应不一致，合同号又按整串等值匹配，导致回款金额为零、项目无法关联以及红冲负数被删除后产生虚假逾期。需要改用 JXPMO 回款计划明细接口作为唯一事实来源，使月计划、实收、待回和逾期能够按平台原始业务状态稳定复现。

## What

经营分析回款模块统一从 `/rest/contract/queryInvoicePlanDetailService/query` 获取跨年数据，按销售部门查询回款、按全量项目合同号精确关联项目，并按 `recFlag`、带符号金额和 `planId` 净额生成卡片与明细。完成后，健新科技 2026-07 报告中的订单合同能够关联对应项目，已红冲的 2025 年记录不再显示为虚假逾期，新接口失败时明确显示“未获取”且不回退旧接口。

本文覆盖 `.ai/specs/jxpmo-business-analytics-extension.md` 与 `docs/经营分析数据字典.md` 中旧的“项目回款计划 + 当月回款补充”双数据源及“过滤红冲、计划减实收”规则；其他经营分析口径保持不变。

## Context

**Relevant files:**

- `src/page/business-analytics/jxpmo-data.js` — JXPMO 分页请求和经营数据 adapter；需要新增唯一回款接口并停止旧回款查询。
- `src/page/business-analytics/invoice.js` — 合同号规范化、项目关联和回款行规范化；需要支持多合同拆分、精确索引、异常与歧义诊断。
- `src/page/business-analytics/collector.js` — 部门/项目范围和来源状态编排；需要将跨年回款作为共享来源，取消逐项目回款采集。
- `src/analytics/engine.js` — 月计划、实收、待回、逾期和卡片聚合；需要改为 `recFlag` 与 `planId` 净额口径。
- `src/content/business-analytics/report-view.js` — 在线报告的回款卡片、明细和诊断展示。
- `src/analytics/html-export.js` — 离线 HTML 的回款列和诊断输出，需要与在线报告保持同一口径。
- `test/unit/analytics-invoice.test.js` — 合同拆分、精确关联、红冲和异常规范化测试。
- `test/integration/analytics-data.test.js`、`test/integration/analytics-collector.test.js` — 新接口参数、分页、来源状态和不回退行为测试。
- `test/unit/analytics-engine.test.js`、`test/integration/analytics-view.test.js`、`test/unit/analytics-html-export.test.js` — 指标、在线展示与离线导出回归测试。
- `docs/经营分析数据字典.md`、`docs/经营分析UAT.md` — 数据血缘、字段公式和真实系统验收规则。
- `test-results/weekly_report_健新科技_2026-07-15.html` — 既有回款区布局和错误红冲结果的只读参考，不修改。

**Patterns to follow:**

- 复用 `fetchPagedEndpoint()` / `fetchAllAnalyticsPages()` 的完整分页与会话失效语义。
- 保持 `createJxpmoAnalyticsData(adapters)` 和 `createAnalyticsCollector(adapters)` 的生产/测试 adapter seam。
- 来源状态继续使用 `success/empty/failed/notApplicable`；技术失败不得转为 0。
- 在线报告与 `createOfflineReport()` 使用同一 engine 输出，不在 view 中重复计算业务金额。
- 测试通过公开接口和报告结果断言，不依赖真实 JXPMO 或用户 Cookie。

**Key decisions already made:**

- 唯一回款来源为 `queryInvoicePlanDetailService/query`；不再调用或回退到 `queryReceivedPlanService/query` 和逐项目 `invoicePlanDetailList`。
- 请求省略 `planRecYear`，一次获取当前权限范围内的跨年记录；具体部门传组织树部门 ID 到 `saleDept`，“全部部门”省略 `saleDept`。
- 回款部门只决定接口查询范围；项目关联不受 `projectDept` 限制。
- 在全量项目上将 `contractNo` 按中英文逗号、分号拆分，去除空白，统一横线和字母大小写后，与 `contractNum` 完整相等；禁止前缀、包含和名称推测。
- 唯一命中时关联项目；未命中或多项目命中时金额仍参与回款统计，项目字段留空并输出诊断。
- 报告月份由 `endDate` 所在自然月决定，记录按 `planRecDate` 归属月份。
- `recFlag="1"` 时按带符号 `recAmount` 计入已回款；`recFlag="0"` 时按带符号 `invoiceAmount` 计入待回款；`realRecDate` 仅展示。
- 不删除 `redReversal="是"` 或负数记录；红冲字段仅展示，金额正负号必须保留。
- 逾期为 `planRecDate < endDate` 且同一 `planId` 的未回款净额大于 0；金额和卡片笔数均按净额非零的 `planId` 聚合。
- 回款率为当月已回款金额/当月计划金额；分母小于等于 0 时为不可计算。
- 异常 `recFlag`、无效必需金额或日期的记录保留并诊断，但不参与金额、笔数和回款率。
- 新接口失败时回款指标为未知、明细显示未获取并保留重试入口，不使用旧接口兜底。

## Constraints

**Must:**

- 同源请求复用当前 JXPMO 会话，不保存 Cookie/JSESSIONID，不把原始响应写入报告或日志。
- `detailId` 作为明细身份，`planId` 作为业务净额与笔数聚合身份；缺少必需身份时进入异常诊断。
- 当月计划明细默认按 `planRecDate`、`contractNum` 升序；逾期按最早计划日优先；红冲展开明细按 `planRecDate`、`invoiceBatch` 排序。
- 在线与离线明细保留既有“合同编号、项目名称、项目经理、客户、款项性质、计划金额、已回款、待回款、计划回款日、状态”信息，并增加实际回款日。
- 项目名称主显匹配项目的 `projectName`，合同 `contractName` 作为次文本/提示；PM 优先项目主数据，未关联时回退接口 `projectManager`。
- 合同重复和未匹配诊断只展示必要标识与候选项目，不输出完整原始记录。
- 更新数据字典和 UAT 中被本规格替代的旧回款接口、公式和验收预期。

**Must not:**

- 不新增依赖，不引入 Excel、Node 抓取脚本或手工 Cookie 配置。
- 不用项目部门过滤合同关联，不对合同号做模糊匹配。
- 不把空值、schema 异常、请求失败静默转为 0。
- 不修改经营分析以外的审批、报工、周报或 AI 功能。
- 不修改 `test-results/` 基准产物，不提交真实接口响应或业务数据 fixture。

**Out of scope:**

- 修改 JXPMO 后端数据、组织归属或合同主数据。
- 新增年度回款趋势图、客户维度分析或回款预测。
- 修正本规格之外的既有经营指标差异。

## Tasks

### T1：新回款数据源与合同关联

**Do:** 在数据 adapter 中新增跨年部门回款分页查询；移除旧回款接口的采集职责；建立拆分后的全量项目合同索引；将接口行规范化为稳定的回款领域结构，并产生未匹配、多匹配和异常诊断。

**Files:** `src/page/business-analytics/jxpmo-data.js`、`src/page/business-analytics/invoice.js`、`src/page/business-analytics/collector.js`、`test/unit/analytics-invoice.test.js`、`test/integration/analytics-data.test.js`、`test/integration/analytics-collector.test.js`

**Verify:** `node --test test/unit/analytics-invoice.test.js test/integration/analytics-data.test.js test/integration/analytics-collector.test.js`

### T2：回款指标与红冲净额

**Do:** 按结束月、`recFlag`、带符号金额和 `planId` 计算月计划、已回、待回、回款率和逾期；异常来源保持未知；补充跨年红冲抵消、非正分母和来源失败测试。

**Files:** `src/analytics/engine.js`、`test/unit/analytics-engine.test.js`、`test/integration/company-analytics.test.js`

**Verify:** `node --test test/unit/analytics-engine.test.js test/integration/company-analytics.test.js`

### T3：在线报告与离线导出

**Do:** 保留基准报告的回款卡片和表格信息层次，增加实际回款日、项目/合同双层名称、合同关联诊断和异常状态；确保在线与离线报告共享同一结果并正确显示不可用状态。

**Files:** `src/content/business-analytics/report-view.js`、`src/analytics/html-export.js`、`test/integration/analytics-view.test.js`、`test/unit/analytics-html-export.test.js`

**Verify:** `node --test test/integration/analytics-view.test.js test/unit/analytics-html-export.test.js`

### T4：业务文档与端到端回归

**Do:** 更新数据字典的数据源、字段映射、公式、完整性规则和 UAT 预期差异；运行生产构建、完整 Node 测试和离线浏览器回归，确认未请求真实 JXPMO。

**Files:** `docs/经营分析数据字典.md`、`docs/经营分析UAT.md`

**Verify:** `npm run verify`

## Done

- [x] 新接口是回款唯一来源，旧回款接口不会在正常、失败或重试流程中被调用。
- [x] 逗号分隔的项目合同号能够逐项精确匹配，跨项目部门合同仍可关联。
- [x] 红冲正负金额按 `planId` 抵消，净额为 0 的计划不计为逾期或业务笔数。
- [x] 当月计划、已回款、待回款、回款率和逾期均符合本文公式，异常数据不污染统计。
- [x] 在线报告和离线 HTML 展示项目、合同、客户、款项、计划/实际日期、状态和安全诊断。
- [x] `npm run build`、`npm run test:unit`、`npm run test:e2e` 全部通过。
- [ ] 真实系统人工验收：健新科技报告中合同订单可关联项目，已红冲的 2025 年三笔不再显示为逾期。
- [x] 变更范围只包含回款实现、相关测试和经营分析文档。
