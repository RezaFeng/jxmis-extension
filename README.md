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
  - Reuses one weekly daily-report query for current-week WBS filling and weekly summary generation
  - Uses approved daily report `realHour` totals for current-week actual hours, matched by WBS and owner, with planned hours as fallback
  - Uses the latest matched approved daily report `realFinishRate` for current project completion progress, with `100` as fallback
  - Uses the latest matched approved daily report `submissionTime` for current-week actual completion time, with WBS planned end time as fallback
  - Generates the weekly summary before next-week WBS insertion and saves current-week changes plus `本周执行情况` together
  - Generates next-week WBS plan rows into `executionNext` before saving
  - Queries `ProjectPlanDetailService/query` with the maximum page length for next-week WBS candidates
  - Resolves next week from Monday to Sunday and applies built-in China holiday/workday overrides
  - Selects WBS tasks whose planned date range intersects next week's workdays
  - Maps WBS `roleId` / `roleName` into weekly-plan `majorPerson` / `majorPersonName`
  - Leaves person fields empty for owner `待定`, while still splitting planned hours
  - Skips WBS candidates that have neither an owner nor planned duration
  - Splits planned hours into rows capped at 24h each, for example `24 + 16`
  - Sets generated WBS plan completion time to next Sunday `17:30:00`
  - Writes modified rows into DataTables change store
  - Triggers `WkFormJS.saveAll()`
  - Injects `总结周报`
  - Reads current project weekly report context
  - Fetches task details from the current Monday-Sunday week
  - Caches generated daily-task JSON per weekly report; hold `Shift` while clicking `总结周报` to refresh
  - Streams AI summary into `本周执行情况`
  - Triggers `WkFormJS.saveAll()` after summary generation
  - In batch work mode, uses the already fetched daily-report rows instead of requesting task details again
- AI weekly summary configuration
  - Click the extension icon to open the popup
  - Supports OpenAI-compatible `baseUrl`, API key, model selection, and editable system prompt
  - Fetches models from `{baseUrl}/models`
  - Streams chat completions from `{baseUrl}/chat/completions`
- Weekly report approval list page
  - Detects route `#!/project/WkReportService/wkreportListPage`
  - Injects `批量审核`
  - Loads pending weekly reports for the current selected month and production owner
  - Shows `待审核项目列表` with project name and project manager before approval
  - Approves confirmed reports sequentially with `1000ms + random(0~2999ms)` delay
  - Rechecks production owner and pending status before every approval

## Files

- `manifest.json`: extension manifest
- `background.js`: OpenAI-compatible model list and streaming chat proxy
- `popup.html`: extension popup for AI weekly summary settings
- `popup.css`: popup styles
- `popup.js`: popup storage and model refresh logic
- `content.js`: injects UI and coordinates page actions
- `page-batch-approve.js`: batch daily approval logic in page context
- `page-batch-work.js`: batch work-report fill and save logic in page context
- `page-batch-weekly-approve.js`: batch weekly report approval logic in page context
- `日报审核接口文档.md`: captured interface notes for daily approval flow
- `周报批量审核接口说明文档.md`: captured interface notes for weekly approval flow

## Supported Pages

- `https://jxmis.cyberwing.cn/jxpmo/index/frame*`
  - `#!/project/WkReportService/wkreportListPage`
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
