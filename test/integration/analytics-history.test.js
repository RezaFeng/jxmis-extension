import assert from "node:assert/strict";
import test from "node:test";
import { createBusinessAnalyticsController } from "../../src/content/business-analytics/controller.js";
import { MESSAGE_TYPES, SOURCES } from "../../src/shared/protocol.js";

function collectedResult(overrides = {}) {
  return Object.assign({
    complete: true,
    coverage: 1,
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    projects: [{
      projectId: "P1",
      projectNo: "JX-1",
      projectName: "项目一",
      projectDept: "D1",
      subcontractAmount: 100000,
      estiExeuCost: 50000,
      realExeuCost: 20000,
      realWorkload: 10,
      planCompleteSchedule: 20
    }],
    formalScope: {
      candidateProjectCount: 1,
      formalProjectCount: 1,
      onlyCurrentPeriodInput: true,
      status: "success",
      enteredProjectIds: [],
      exitedProjectIds: [],
      rangeChangeProjects: []
    },
    dailyByProject: { P1: [] },
    previousDailyByProject: { P1: [] },
    wbsByProject: { P1: [] },
    milestonesByProject: { P1: [] },
    invoicesByProject: { P1: [] },
    weeklyByProject: { P1: { aggregate: { summaries: [], currentExecutions: [] } } },
    previousWeeklyByProject: { P1: { aggregate: { summaries: [], currentExecutions: [] } } },
    nextPlannedHoursByProject: { P1: 0 },
    sourceStatus: [],
    failedRequests: [],
    diagnostics: {}
  }, overrides);
}

function createHarness(options = {}) {
  const pageMessages = [];
  const runtimeMessages = [];
  const states = [];
  const reports = [];
  const listeners = {};
  const query = Object.assign({
    departmentId: "D1",
    departmentName: "交付一部",
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  }, options.query);
  const windowRef = {
    postMessage: function (message) { pageMessages.push(message); },
    addEventListener: function (type, listener) { listeners[type] = listener; }
  };
  const controller = createBusinessAnalyticsController({
    window: windowRef,
    document: {},
    departments: options.departments || [],
    config: {
      projectFilters: {},
      riskThresholds: {},
      configVersion: "config-v1",
      policyVersion: "policy-v1"
    },
    navigation: {
      restore: function () {},
      isActive: function () { return false; },
      syncLocation: function () {}
    },
    view: {
      getQuery: function () { return query; },
      renderState: function (state) { states.push(state); },
      renderReport: function (report, viewOptions) { reports.push({ report, options: viewOptions }); },
      setExportEnabled: function () {}
    },
    chrome: {
      runtime: {
        getURL: function () { return "business-analytics.css"; },
        openOptionsPage: function () {},
        sendMessage: function (message) { runtimeMessages.push(message); }
      },
      storage: { local: { get: function (_defaults, callback) { callback({}); } } }
    }
  });
  function deliver(result, request = pageMessages.at(-1)) {
    listeners.message({
      source: windowRef,
      data: {
        source: SOURCES.ANALYTICS_PAGE,
        type: MESSAGE_TYPES.ANALYTICS_RESULT,
        requestId: request.requestId,
        result
      }
    });
  }
  return { controller, pageMessages, runtimeMessages, states, reports, deliver };
}

test("analytics history query and refresh both request live data", async function () {
  const harness = createHarness();
  await harness.controller.query(false);
  await harness.controller.query(true);
  assert.equal(harness.runtimeMessages.length, 0);
  assert.equal(harness.pageMessages.length, 2);
  assert.ok(harness.pageMessages.every(function (message) {
    return message.type === MESSAGE_TYPES.ANALYTICS_REQUEST;
  }));
  assert.notEqual(harness.pageMessages[0].requestId, harness.pageMessages[1].requestId);
  assert.equal(harness.pageMessages[1].forceRefresh, undefined);
  assert.equal(harness.pageMessages[1].historyMode, undefined);
});

test("analytics history keeps a complete live report only in page memory", async function () {
  const harness = createHarness();
  await harness.controller.query();
  harness.deliver(collectedResult());
  assert.equal(harness.runtimeMessages.length, 0);
  assert.equal(harness.reports.length, 1);
  assert.equal(harness.reports[0].options.formal, true);
  assert.equal(harness.reports[0].report.metrics.overview.projectCount, 1);
  assert.equal(harness.reports[0].report.history, undefined);
  assert.equal(harness.states.at(-1).kind, "ready");
});

test("analytics history retries failed descriptors from current page memory", async function () {
  const harness = createHarness();
  await harness.controller.query();
  const failures = [{ source: "wbs", projectId: "P1", error: "HTTP 500" }];
  harness.deliver(collectedResult({ complete: false, coverage: 0.8, failedRequests: failures }));
  harness.controller.retryFailed();
  const retry = harness.pageMessages.at(-1);
  assert.equal(retry.retryFailed, true);
  assert.deepEqual(retry.previous.failedRequests, failures);
  assert.equal(harness.runtimeMessages.length, 0);
});

test("analytics history collects all departments in one live request", async function () {
  const departments = [{ id: "D1", name: "一部" }, { id: "D2", name: "二部" }];
  const harness = createHarness({
    departments,
    query: { departmentId: "all", departmentName: "全部部门" }
  });
  await harness.controller.query();
  assert.equal(harness.pageMessages.length, 1);
  assert.equal(harness.pageMessages[0].departmentId, "all");
  const second = Object.assign({}, collectedResult().projects[0], {
    projectId: "P2",
    projectName: "项目二",
    projectDept: "D2"
  });
  const result = collectedResult({
    projects: [collectedResult().projects[0], second],
    dailyByProject: { P1: [], P2: [] },
    previousDailyByProject: { P1: [], P2: [] },
    wbsByProject: { P1: [], P2: [] },
    milestonesByProject: { P1: [], P2: [] },
    invoicesByProject: { P1: [], P2: [] },
    formalScope: Object.assign({}, collectedResult().formalScope, {
      candidateProjectCount: 2,
      formalProjectCount: 2
    })
  });
  harness.deliver(result);
  assert.equal(harness.reports[0].report.company.coverage, 1);
  assert.equal(harness.reports[0].options.company, true);
  assert.equal(harness.runtimeMessages.length, 0);
});

test("analytics history renders a known empty live report", async function () {
  const harness = createHarness();
  await harness.controller.query();
  harness.deliver(collectedResult({
    projects: [],
    formalScope: Object.assign({}, collectedResult().formalScope, { formalProjectCount: 0 })
  }));
  assert.equal(harness.states.at(-1).kind, "empty");
  assert.equal(harness.reports[0].report.metrics.overview.projectCount, 0);
});
