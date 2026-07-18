import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineReport, createOfflineReportFileName } from "../../src/analytics/html-export.js";
import { createBusinessAnalyticsController } from "../../src/content/business-analytics/controller.js";
import { MESSAGE_TYPES } from "../../src/shared/protocol.js";

function report() {
  return {
    identity: {
      departmentId: "D1",
      departmentName: "交付一部",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
      capturedAt: "2026-07-13T08:00:00Z"
    },
    scope: { mode: "formal", persistable: true, periodLabels: { current: "本周" } },
    complete: true,
    cards: {
      overview: [{ id: "projectCount", label: "项目数", values: [{ value: 1, format: "number" }] }],
      active: [], milestone: [], invoice: []
    },
    metrics: {},
    tables: {
      projects: [{
        projectId: "P1",
        projectNo: "JX-1",
        projectName: "<img src=x onerror=alert(1)>",
        projectManagerName: "经理甲",
        inputMd: 1,
        inputCost: 1000,
        dailyRows: [{ personName: "敏感人员", cost: 1000, Cookie: "secret-cookie" }],
        previousDailyRows: [{ apiKey: "secret-key" }],
        wbsRows: [{ url: "https://jxmis.example/private" }]
      }],
      activeProjects: [],
      milestones: { planned: [], overdue: [], upcoming: [] },
      invoices: { monthRows: [], overdue: [] },
      projectManagers: [],
      budgetHealth: [],
      weeklyExecution: [{ projectNo: "JX-1", summary: "周总结", details: [{ majorPerson: "敏感人员" }] }],
      diagnostics: {
        coverage: 0.8,
        failedRequests: [{ source: "wbs", error: "private endpoint" }],
        sourceStatus: [{ source: "wbs", projectId: "P1", status: "failed", error: "private endpoint" }]
      }
    }
  };
}

test("analytics html export is self-contained and strips sensitive detail", function () {
  const html = createOfflineReport(report());

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /data-role="project-search"/);
  assert.match(html, /data-action="restore"/);
  assert.match(html, /data-sort/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /敏感人员|secret-cookie|secret-key|private endpoint|JSESSIONID/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|src\s*=\s*["']https?:/i);
});

test("analytics html export creates a stable report filename", function () {
  assert.equal(
    createOfflineReportFileName(report(), new Date("2026-07-13T08:09:10Z")),
    "经营分析_交付一部_2026-07-06_2026-07-12_20260713-080910.html"
  );
});

test("analytics html export controller downloads the formal report", async function () {
  const downloads = [];
  const enabled = [];
  const cached = report();
  const controller = createBusinessAnalyticsController({
    window: { addEventListener: function () {}, postMessage: function () {} },
    document: {},
    config: { projectFilters: {}, riskThresholds: {}, configVersion: "C1", policyVersion: "P1" },
    navigation: { restore: function () {}, isActive: function () { return false; }, syncLocation: function () {} },
    view: {
      getQuery: function () { return { departmentId: "D1", departmentName: "交付一部", startDate: "2026-07-06", endDate: "2026-07-12" }; },
      renderState: function () {},
      renderReport: function () {},
      setExportEnabled: function (value) { enabled.push(value); }
    },
    download: function (value) { downloads.push(value); },
    now: function () { return new Date("2026-07-13T08:09:10Z"); },
    chrome: {
      runtime: {
        getURL: function () { return "business-analytics.css"; },
        openOptionsPage: function () {},
        sendMessage: function (message, callback) {
          callback({
            ok: true,
            result: message.type === MESSAGE_TYPES.ANALYTICS_GET_LATEST
              ? { capturedAt: cached.identity.capturedAt, report: cached }
              : null
          });
        }
      },
      storage: { local: { get: function (_defaults, callback) { callback({}); } } }
    }
  });

  await controller.query(false);
  controller.handleAction("export");

  assert.equal(enabled.at(-1), true);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].html, /<!doctype html>/i);
  assert.equal(downloads[0].fileName, "经营分析_交付一部_2026-07-06_2026-07-12_20260713-080910.html");
});
