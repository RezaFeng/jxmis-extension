# Toolbar Fallback Actions

## 背景

周报报工页面有时只显示右上角“返回”按钮，缺少页面基础操作按钮。
插件需要在该页面补齐“保存”按钮，避免用户无法保存当前表单。

## 范围

- 仅在现有 `isWorkReportPage()` 判定为周报报工页面时启用。
- 仅检测页面右上角 `.panel-toolbar.pull-right` 容器。
- 仅在该 toolbar 内缺少保存按钮时补齐，已有按钮不重复插入。
- 补齐按钮插入到“返回”按钮左侧。

## 行为

### 检测

- 在 `.panel-toolbar.pull-right` 内查找可见按钮、链接、提交输入。
- 文本为 `保存` 或 `提交` 时认为已有保存按钮。
- 文本为 `返回` 的按钮作为插入锚点。

### 补齐按钮

- 缺少保存按钮时插入：
  - 文案：`保存`
  - class：`btn btn-info`
  - 行为：请求页面脚本等待 `WkFormJS.saveAll` 后调用。
- 顺序：`保存`、`返回`。

### 通信

- 内容脚本负责 DOM 检测和按钮插入。
- 页面脚本负责调用 `WkFormJS`，避免 content script isolated world 无法访问页面对象。
- 页面脚本执行成功后发送 `CW_TOOLBAR_ACTION_DONE`。
- 页面脚本执行失败后发送 `CW_TOOLBAR_ACTION_ERROR`。

## 验收

- 页面 toolbar 只有“返回”时，插件插入 `保存 返回`。
- toolbar 已有“保存/提交”时，不插入重复按钮。
- 点击“保存”调用 `WkFormJS.saveAll()`。
- `WkFormJS` 未就绪时，按钮动作失败并显示状态提示。
