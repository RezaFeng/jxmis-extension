import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineReport, createOfflineReportFileName } from "../../src/analytics/html-export.js";
import { createBusinessAnalyticsController } from "../../src/content/business-analytics/controller.js";
import { MESSAGE_TYPES, SOURCES } from "../../src/shared/protocol.js";

function report() {
  return {
    identity: {
      departmentId: "D1",
      departmentName: "交付一部",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
      capturedAt: "2026-07-13T08:00:00Z"
    },
    scope: {
      mode: "formal",
      formalCount: 1,
      candidateCount: 2,
      onlyCurrentPeriodInput: true,
      periodLabels: { current: "本周", previous: "上周" }
    },
    complete: true,
    cards: {
      overview: [{ id: "projectCount", label: "项目数", values: [{ value: 1, format: "number" }] }],
      active: [], milestone: [], invoice: []
    },
    metrics: {
      risks: { attentionProjectCount: 1, itemCount: 2 },
      milestone: { overdueCount: 0 },
      invoice: { overdueCount: 0 },
      comparison: {
        active: {
          inputMd: { current: 1, previous: 0, delta: 1, changeRate: 0 }
        },
        milestone: {},
        invoice: {}
      }
    },
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
      milestones: {
        planned: [{
          milestoneId: "M1",
          projectNo: "JX-1",
          projectName: "项目一",
          projectManagerName: "经理甲",
          nodeName: "验收",
          planEndTime: "2026-07-10",
          completed: true
        }],
        overdue: [],
        upcoming: []
      },
      invoices: {
        monthRows: [{
          detailId: "D1",
          planId: "PLAN-1",
          contractNo: "HT-1",
          contractName: "订单合同一",
          projectName: "项目一",
          projectManagerName: "经理甲",
          customerName: "客户甲",
          paymentNature: "进度款",
          planAmount: 100000,
          receivedFlag: "1",
          receivedAmount: 100000,
          pendingAmount: 0,
          planDate: "2026-07-10",
          realReceivedDate: "2026-07-09",
          redReversal: "否",
          valid: true
        }],
        overdue: []
      },
      projectManagers: [],
      budgetHealth: [],
      weeklyExecution: [{ projectNo: "JX-1", summary: "周总结", details: [{ majorPerson: "敏感人员" }] }],
      diagnostics: {
        coverage: 0.8,
        failedRequests: [{ source: "wbs", error: "private endpoint" }],
        sourceStatus: [{ source: "wbs", projectId: "P1", status: "failed", error: "private endpoint" }],
        enteredProjectIds: ["P1"],
        rangeChangeProjects: [{
          projectId: "P1",
          projectNo: "JX-1",
          projectName: "项目一",
          currentInputMd: 1,
          previousInputMd: 0
        }],
        receivables: {
          unmappedCount: 1,
          unmappedAmount: 200000,
          ambiguousCount: 1,
          ambiguousAmount: 300000,
          invalidCount: 1
        }
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
  assert.match(html, /正式范围 1\/2/);
  assert.match(html, /仅本期日报投入项目/);
  assert.match(html, /本期经营与上期比较/);
  assert.match(html, /投入范围变化/);
  assert.match(html, /本期进入/);
  assert.match(html, /HT-1/);
  assert.match(html, /项目一 \/ 订单合同一/);
  assert.match(html, /2026-07-09/);
  assert.match(html, /多重匹配回款：1 笔/);
  assert.match(html, /异常回款：1 笔/);
  assert.match(html, /验收/);
  assert.match(html, /已完成/);
  assert.ok(html.indexOf("经营速览") < html.indexOf("实时累计经营概览"));
  assert.ok(html.indexOf("实时累计经营概览") < html.indexOf("本期经营与上期比较"));
  assert.ok(html.indexOf("本期经营与上期比较") < html.indexOf("项目明细"));
  assert.doesNotMatch(html, /历史快照|无法历史回溯|缓存时间|区间执行报告/);
  assert.doesNotMatch(html, /敏感人员|secret-cookie|secret-key|private endpoint|JSESSIONID/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|src\s*=\s*["']https?:/i);
});

test("analytics html export rejects a temporary project selection", function () {
  const selected = report();
  selected.scope.mode = "selection";
  assert.throws(function () { createOfflineReport(selected); }, /formal analytics report required/);
});

test("analytics html export includes signed overdue plan composition", function () {
  const value = report();
  value.tables.invoices.overdue = [{
    planId: "RED-1",
    contractNo: "HT-RED",
    projectName: "红冲项目",
    planDate: "2026-06-01",
    planAmount: 60000,
    receivedFlag: "0",
    receivedAmount: 0,
    pendingAmount: 60000,
    valid: true,
    details: [{
      detailId: "R1",
      planId: "RED-1",
      contractNo: "HT-RED",
      projectName: "红冲项目",
      planDate: "2026-06-01",
      planAmount: 100000,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 100000,
      valid: true
    }, {
      detailId: "R2",
      planId: "RED-1",
      contractNo: "HT-RED",
      projectName: "红冲项目",
      planDate: "2026-06-02",
      planAmount: -40000,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: -40000,
      redReversal: "是",
      valid: true
    }]
  }];

  const html = createOfflineReport(value);

  assert.match(html, /回款净额组成/);
  assert.match(html, /-4 万元/);
});

test("analytics html export creates a stable report filename", function () {
  assert.equal(
    createOfflineReportFileName(report(), new Date("2026-07-13T08:09:10Z")),
    "经营分析_交付一部_2026-07-06_2026-07-12_20260713-080910.html"
  );
});

test("analytics html export marks an incomplete report in content and filename", function () {
  const partial = report();
  partial.complete = false;
  assert.match(createOfflineReport(partial), /报告状态 数据不完整/);
  assert.equal(
    createOfflineReportFileName(partial, new Date("2026-07-13T08:09:10Z")),
    "经营分析_交付一部_2026-07-06_2026-07-12_数据不完整_20260713-080910.html"
  );
});

test("analytics html export controller downloads the formal report", async function () {
  const downloads = [];
  const enabled = [];
  const cached = report();
  const pageMessages = [];
  let messageListener;
  const windowRef = {
    addEventListener: function (_type, listener) { messageListener = listener; },
    postMessage: function (message) { pageMessages.push(message); }
  };
  const controller = createBusinessAnalyticsController({
    window: windowRef,
    document: {},
    config: { projectFilters: {}, riskThresholds: {}, configVersion: "C1", policyVersion: "P1" },
    scopeReady: true,
    navigation: { restore: function () {}, isActive: function () { return false; }, syncLocation: function () {} },
    view: {
      getQuery: function () { return { departmentId: "D1", departmentName: "交付一部", startDate: "2026-07-06", endDate: "2026-07-12" }; },
      renderState: function () {},
      renderReport: function () {},
      setExportEnabled: function (value) { enabled.push(value); }
    },
    download: function (value) { downloads.push(value); },
    now: function () { return new Date("2026-07-13T08:09:10Z"); },
    engine: { buildReport: function () { return cached; } },
    chrome: {
      runtime: {
        getURL: function () { return "business-analytics.css"; },
        openOptionsPage: function () {}
      },
      storage: { local: { get: function (_defaults, callback) { callback({}); } } }
    }
  });

  await controller.query();
  const request = pageMessages.at(-1);
  messageListener({
    source: windowRef,
    data: {
      source: SOURCES.ANALYTICS_PAGE,
      type: MESSAGE_TYPES.ANALYTICS_RESULT,
      requestId: request.requestId,
      result: { projects: [{}], complete: true, failedRequests: [] }
    }
  });
  controller.handleAction("export");

  assert.equal(enabled.at(-1), true);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].html, /<!doctype html>/i);
  assert.equal(downloads[0].fileName, "经营分析_交付一部_2026-07-06_2026-07-12_20260713-080910.html");
});
