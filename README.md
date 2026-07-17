<!-- generated-by: gsd-doc-writer -->
# jxmis-extension

`jxmis-extension` 是面向 JXMIS 已登录用户的 Manifest V3 Chrome 扩展，用于日报批量审批、周报批量报工、AI 周报总结、下周 WBS 计划填充和周报批量审核。

## 功能

- 日报审核：查询未审批日报，按顺序提交审批并反馈进度。
- 批量报工：支持“一键报工”“仅填周报”“仅填工时”“仅填计划”四种模式。
- 周报总结：通过 OpenAI-compatible 接口流式接收 reasoning、正文、完成和错误事件。
- 下周计划：按 WBS、工作日、人员和工时规则生成下周执行行。
- 周报审核：预览待审核项目，复查负责人和状态后逐条批复。
- 项目负责人覆盖：可在 popup 中配置 `projectManager`，统一改写同源 JXMIS 请求。

## 安装依赖

仓库使用 npm lockfile，首次安装或 CI 环境使用：

```bash
npm ci
```

项目未在 `package.json` 中固定 Node.js 版本；当前构建与测试基于支持 ESM、`structuredClone` 和 `fs.watch` 递归监听的现代 Node.js。

## 构建和加载

1. 生成开发构建：

   ```bash
   npm run build
   ```

2. 打开 `chrome://extensions/`，启用“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择仓库下的 `dist/`，不要选择仓库根目录或 `src/`。
4. 更新源码后重新执行构建，并在扩展管理页点击刷新。

扩展依赖当前 JXMIS 页面登录会话；会话过期时，同源自动化请求会失败。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 清理并生成可加载的开发产物到 `dist/` |
| `npm run build:test` | 生成带 loopback fixture 权限的 `dist-test/` |
| `npm run dev` | 监听 `src/` 并持续重建 `dist/` |
| `npm run test:unit` | 运行 Node 单元测试和工作流契约测试 |
| `npm run test:e2e` | 构建 `dist-test/` 并运行离线 Chromium 扩展测试 |
| `npm run verify` | 串行执行生产构建、Node 测试和离线浏览器测试 |
| `npm run package` | 生产压缩构建并生成 `release/jxmis-extension.zip` |

首次运行浏览器测试前，如本机尚无 Playwright Chromium：

```bash
npx playwright install chromium
```

## 源码结构

```text
src/
├── entries/       # 六个 esbuild 入口
├── background/    # 配置、cache、模型请求和 SSE 生命周期
├── content/       # 页面识别、控件、bundle 注入和消息桥
├── page/          # 运行在 JXMIS MAIN world 的三类业务自动化
├── popup/         # popup 静态资源和表单 runtime
├── shared/        # 跨运行环境协议、默认值和 AI request body
└── manifest.json  # 生产 manifest 源
```

`src/` 是唯一运行时源码目录，`dist/` 是唯一 Chrome 加载目录。根目录不再保留旧的运行时脚本或 manifest。

六个稳定 JS 产物为：

- `dist/background.js`
- `dist/content.js`
- `dist/popup.js`
- `dist/page-daily-approval.js`
- `dist/page-batch-work.js`
- `dist/page-weekly-approval.js`

详细运行环境、消息流、module interface 和 adapter seam 见 [项目架构说明](docs/项目架构说明.md)。历史问题及落实状态见 [项目架构优化建议](docs/项目架构优化建议.md)。

## Popup 配置

点击扩展图标可配置：

- 模型厂商：DeepSeek、ModelScope 或 OpenAI-compatible。
- 模型 URL、API Key 和模型名。
- 思考模式开关。
- 周报总结 System Prompt。
- 项目经理 ID 覆盖值。

配置保存在 `chrome.storage.local`。模型列表通过 `{baseUrl}/models` 获取，周报总结通过 `{baseUrl}/chat/completions` 请求。

## 支持页面

- JXMIS 日报审核页面。
- 路径包含 `/project/WkReportService/id/` 的周报填报页面。
- hash 包含 `/project/WkReportService/wkreportListPage` 的周报审核列表页面。

生产 content scripts 仅匹配 `https://jxmis.cyberwing.cn/jxpmo/*`。loopback 权限只存在于 `dist-test/manifest.json`，不会进入 `dist/` 或发布 ZIP。

## 测试边界

`npm run verify` 当前覆盖 97 个 Node 单元/集成测试和 3 个离线 Chromium 扩展测试。浏览器 fixture 验证扩展加载、页面 matcher、单 page bundle 注入、按钮和状态、fake `WkFormJS.saveAll()`、AI success/error 生命周期，并断言不会请求真实 JXMIS 域名。

自动化测试不读取账号、Cookie 或真实 JXMIS 数据，也不会执行真实审批和保存。真实环境的日报审批、四种报工模式、保存顺序、周报审核、popup 和项目负责人覆盖仍须按 [项目架构说明](docs/项目架构说明.md) 中的清单人工验证。

## 发布

```bash
npm run verify
npm run package
```

发布包位于 `release/jxmis-extension.zip`，ZIP 根目录直接包含 manifest.json 和全部六个 JS 入口。`dist/`、`dist-test/`、`release/`、Playwright trace 和报告均为生成物，不提交 Git。
