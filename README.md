# jxmis-extension

`jxmis-extension` is a Chrome extension for JXMIS automation.

## Features

- Daily approval page
  - Injects `批量审批未审批日报`
  - Loads all pending daily reports
  - Approves sequentially
  - Waits `5000ms + random(0~2999ms)` between requests
  - Reloads page after batch approval completes
- Work report page
  - Detects route `#/jxpmo/project/WkReportService/id/<dynamic-id>?`
  - Injects `批量报工` next to `重新计算`
  - Fills `WkExecutiongrid`
  - Writes modified rows into DataTables change store
  - Triggers `WkFormJS.saveAll()`

## Files

- `manifest.json`: extension manifest
- `content.js`: injects UI and coordinates page actions
- `page-batch-approve.js`: batch daily approval logic in page context
- `page-batch-work.js`: batch work-report fill and save logic in page context
- `日报审核接口文档.md`: captured interface notes for daily approval flow

## Supported Pages

- `https://jxmis.cyberwing.cn/jxpmo/index/frame*`
- `https://jxmis.cyberwing.cn/jxpmo/project/ProjectRapportService/dailyApprovalPage*`
- `https://jxmis.cyberwing.cn/jxpmo/project/WkReportService/id/*`

## Install

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select repository root folder

## Notes

- Extension relies on current logged-in page session
- Requests use same-origin cookies from active JXMIS page
- If session expires, automation requests fail
