# jxmis-extension

`jxmis-extension` is a Chrome extension for JXMIS automation.

## Features

- Daily approval page
  - Injects `批量审批未审批日报`
  - Loads all pending daily reports
  - Approves sequentially
  - Waits `500ms + random(0~999ms)` between requests
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
  - Reads current project weekly report context
  - Caches generated daily-task JSON per weekly report from batch work data
  - Streams AI summary into `本周执行情况`
  - Uses the already fetched daily-report rows instead of requesting task details again
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
  - Approves confirmed reports sequentially with `500ms + random(0~999ms)` delay
  - Rechecks production owner and pending status before every approval

## Files

- `manifest.json`: extension manifest
- `background.js`: OpenAI-compatible model list and streaming chat proxy
- `popup.html`: extension popup for AI weekly summary settings
- `popup.css`: popup styles
- `popup.js`: popup storage and model refresh logic
- `content.js`: injects UI and coordinates page actions
- `jxmis-transport.js`: shared page-context transport helpers for messages, base URL resolution, JSON fetch, and delays
- `wbs-plan.js`: pure next-week WBS plan generation rules used by batch work
- `daily-actual.js`: pure daily-report matching rules for actual hours, finish rate, and actual end time
- `page-batch-approve.js`: batch daily approval logic in page context
- `page-batch-work.js`: batch work-report fill and save logic in page context
- `page-batch-weekly-approve.js`: batch weekly report approval logic in page context
- `package.json`: Node test script using the built-in test runner
- `test/`: unit tests for shared transport, WBS planning, and daily actual matching
- `日报审核接口文档.md`: captured interface notes for daily approval flow
- `周报批量审核接口说明文档.md`: captured interface notes for weekly approval flow

## Development

Run unit tests:

```bash
npm test
```

Run syntax checks for extension scripts:

```bash
node --check content.js page-batch-approve.js page-batch-weekly-approve.js page-batch-work.js background.js popup.js defaults.js jxmis-transport.js wbs-plan.js daily-actual.js
```

Shared page-context modules are loaded by `content.js` before the page automation scripts:

- `jxmis-transport.js` before all page scripts
- `wbs-plan.js` and `daily-actual.js` before `page-batch-work.js`

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
