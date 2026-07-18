<!-- generated-by: gsd-doc-writer -->
# jxmis-extension

`jxmis-extension` 是面向已登录 JXPMO 用户的 Manifest V3 Chrome 扩展，提供日报批量审批、周报批量报工、AI 周报总结、下周 WBS 计划填充、周报批量审核，以及部门/全部部门经营分析。

## 功能

- 日报审核：查询未审批日报，顺序提交并反馈进度。
- 批量报工：支持一键报工、仅填周报、仅填工时和仅填计划。
- 周报总结：通过 OpenAI-compatible 接口流式接收 reasoning、正文、完成和错误事件。
- 周报审核：预览待审核项目，复查负责人和状态后逐条批复。
- 经营分析：在 JXPMO 项目模块左侧菜单增加“经营分析”，每次按部门和日期实时生成 35 项核心值、项目/PM/预算/周期执行/里程碑/回款明细、风险诊断和全部部门总览。
- 相邻周期比较：按当前筛选周期实时查询紧邻上期，并用本期有日报投入的同一正式项目集合计算本期、上期、变化和环比。
- 离线导出：导出自包含 HTML，可搜索、排序和折叠，不访问 JXPMO，也不包含认证信息或人员级日报。

## 安装与构建

首次安装依赖：

```bash
npm ci
npx playwright install chromium
```

生成开发构建：

```bash
npm run build
```

在 `chrome://extensions/` 启用开发者模式，选择“加载已解压的扩展程序”，加载仓库下的 `dist/`。源码更新后重新构建并刷新扩展。

扩展复用当前浏览器中的 JXPMO 登录会话，不读取或保存 `JSESSIONID`。会话过期时，经营分析显示“登录已失效”，用户重新登录后再查询或重试。

## 使用经营分析

1. 点击扩展图标打开“JXPMO 扩展设置”。
2. 配置项目属性、分类、一级状态、执行类型和预警阈值并保存。默认分类为 `J/Z`，状态为 `10/20/50`，其余维度不限。
3. 打开 JXPMO 项目模块，在左侧项目菜单中点击“经营分析”。
4. 选择部门、开始日期和结束日期，点击“查询”。默认日期为最近一个完整自然周。
5. 默认正式范围只包含本期日报投入大于 0 的项目。部分来源失败时查看完整性诊断并使用“仅重试失败项”；重试数据只保留在当前页面内存中。
6. 点击“导出HTML”生成当前正式全量口径的离线报告。项目表中的临时筛选或勾选不会改变顶部正式统计和导出。

Options 页还可配置 AI、项目经理覆盖、经营项目筛选和预警阈值。经营分析不保存查询缓存、报告快照或指标历史。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 生成带 inline source map 的开发产物到 `dist/` |
| `npm run build:test` | 生成仅测试使用、允许 loopback fixture 的 `dist-test/` |
| `npm run dev` | 监听 `src/` 并持续重建 `dist/` |
| `npm run test:unit` | 运行 Node 单元和集成测试 |
| `npm run test:e2e` | 构建 `dist-test/` 并运行离线 Chromium 扩展测试 |
| `npm run verify` | 串行执行生产构建、Node 测试和浏览器 E2E |
| `npm run package` | 生产压缩构建并生成 `release/jxmis-extension.zip` |

## 源码结构

```text
src/
├── analytics/                       # 配置、日期、公式、风险、engine、HTML 导出
├── background/                      # AI、配置与旧经营 IndexedDB 幂等清理
├── content/                         # 页面识别、导航、Shadow DOM 视图和消息桥
├── entries/                         # 7 个 esbuild 入口
├── options/                         # 统一设置页
├── page/                            # MAIN world 页面自动化与经营数据采集
├── shared/                          # 跨运行环境协议和默认值
└── manifest.json                    # 生产 manifest 源
```

构建产物包括 `background.js`、`content.js`、`options.js`、三个原有 page bundle 和 `page-business-analytics.js`。详细拓扑见 [项目架构说明](docs/项目架构说明.md)。

## 数据与安全边界

- 经营数据只通过当前 JXPMO 同源接口读取，不写回 JXPMO。
- 项目范围按组织树部门 ID 和本地配置过滤，不维护项目编码白名单。
- 日报 `cost` 是投入成本来源，不使用固定单价兜底。
- `subcontractAmount` 作为软件与服务合同金额；不下载基线或回款 Excel。
- 接口成功返回的空业务数值按 0 计算；已知分母为 0 的比率强制为 0；网络、会话、HTTP、分页或 schema 技术失败仍显示“未获取”。
- 经营数据不会发送到 AI provider。API Key 只保存在 `chrome.storage.local`。
- 离线 HTML 使用禁止外部网络的 CSP，并对远端文本转义。

字段、公式和完整性规则见 [经营分析数据字典](docs/经营分析数据字典.md)。

## 测试与验收

截至 2026-07-18，`npm run verify` 通过 187 个 Node 单元/集成测试和 9 个离线 Chromium E2E。E2E 覆盖原三类自动化、Options、项目菜单、实时刷新、默认投入范围、空值、上期比较、分页、全部部门、内存重试、取消、会话失效、HTML 下载和无经营 IndexedDB，并断言不请求真实 `jxmis.cyberwing.cn`。

离线测试不登录真实系统，也不代表业务数据对账完成。上线前必须按 [经营分析 UAT](docs/经营分析UAT.md) 完成至少 3 个部门、2 个完整自然周的只读双跑，并由产品负责人确认差异。

## 旧工具迁移与归档

扩展运行时不依赖旧 `weekly_report_toolkit_V3.1`、Node/Python 报告流水线、Playwright 抓取、Excel 或 `output/` 中间文件。旧工具仅作为双跑对账基线，禁止把其中的 Cookie、`JSESSIONID`、项目白名单或生成文件复制进本仓库。

在双跑表未完成、差异未确认或产品负责人未签字前，不得删除或归档旧工具。验收通过后将旧仓库标记为只读归档，保留对账证据和版本信息，不再用于生产出报。

## 发布

```bash
npm run verify
npm run package
```

发布包位于 `release/jxmis-extension.zip`。`dist/`、`dist-test/`、`release/` 和 Playwright 报告均为生成物，不提交 Git。
