import assert from "node:assert/strict";
import test from "node:test";
import { createReportKey } from "../../src/analytics/config.js";
import { createBusinessAnalyticsController } from "../../src/content/business-analytics/controller.js";
import { MESSAGE_TYPES, SOURCES } from "../../src/shared/protocol.js";

function createHarness(snapshot) {
  const pageMessages = [];
  const runtimeMessages = [];
  const states = [];
  const reports = [];
  const listeners = {};
  const query = {
    departmentId: "D1",
    departmentName: "交付一部",
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  };
  const config = {
    projectFilters: {},
    riskThresholds: {},
    configVersion: "config-v1",
    policyVersion: "policy-v1"
  };
  const windowRef = {
    postMessage: function (message) { pageMessages.push(message); },
    addEventListener: function (type, listener) { listeners[type] = listener; }
  };
  const view = {
    getQuery: function () { return query; },
    renderState: function (state) { states.push(state); },
    renderReport: function (report, options) { reports.push({ report, options }); }
  };
  const chrome = {
    runtime: {
      getURL: function () { return "business-analytics.css"; },
      sendMessage: function (message, callback) {
        runtimeMessages.push(message);
        const value = typeof snapshot === "function" ? snapshot(message) : snapshot;
        callback({ ok: true, result: message.type === MESSAGE_TYPES.ANALYTICS_GET_LATEST ? value : null });
      },
      openOptionsPage: function () {}
    },
    storage: { local: { get: function (_defaults, callback) { callback({}); } } }
  };
  const controller = createBusinessAnalyticsController({
    window: windowRef,
    chrome,
    document: {},
    view,
    navigation: { restore: function () {}, isActive: function () { return false; }, syncLocation: function () {} },
    config
  });
  return { controller, pageMessages, runtimeMessages, states, reports, query, config, listeners, windowRef };
}

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
      subcontractAmount: 100000,
      estiExeuCost: 50000,
      realExeuCost: 20000,
      realWorkload: 10,
      planCompleteSchedule: 20
    }],
    dailyByProject: { P1: [] },
    previousDailyByProject: { P1: [] },
    wbsByProject: { P1: [] },
    milestonesByProject: { P1: [] },
    invoicesByProject: { P1: [] },
    weeklyByProject: { P1: { aggregate: { summaries: [], currentExecutions: [] } } },
    nextPlannedHoursByProject: { P1: 0 },
    sourceStatus: [],
    failedRequests: [],
    diagnostics: {}
  }, overrides);
}

test("cache coordination shows latest snapshot before active collection", async function () {
  const cachedReport = { identity: { capturedAt: "2026-07-13T00:00:00Z" }, tables: { projects: [] } };
  const harness = createHarness({
    reportKey: "cached-key",
    capturedAt: "2026-07-13T00:00:00Z",
    report: cachedReport
  });

  await harness.controller.query(false);

  assert.equal(harness.runtimeMessages[0].type, MESSAGE_TYPES.ANALYTICS_GET_LATEST);
  assert.equal(harness.runtimeMessages[0].reportKey, createReportKey(Object.assign({}, harness.query, harness.config)));
  assert.equal(harness.reports[0].report, cachedReport);
  assert.equal(harness.reports[0].options.formal, true);
  assert.match(harness.states.at(-1).status, /缓存/);
  assert.equal(harness.pageMessages.at(-1).type, MESSAGE_TYPES.ANALYTICS_REQUEST);

  const refresh = createHarness(null);
  await refresh.controller.query(true);
  assert.equal(refresh.runtimeMessages.length, 1);
  assert.equal(refresh.runtimeMessages[0].type, MESSAGE_TYPES.ANALYTICS_GET_LATEST);
  assert.equal(refresh.pageMessages.at(-1).forceRefresh, true);
});

test("analytics history saves a complete formal snapshot", async function () {
  const harness = createHarness(null);
  await harness.controller.query(true);
  const request = harness.pageMessages.at(-1);

  harness.listeners.message({
    source: harness.windowRef,
    data: {
      source: SOURCES.ANALYTICS_PAGE,
      type: MESSAGE_TYPES.ANALYTICS_RESULT,
      requestId: request.requestId,
      result: collectedResult()
    }
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  const saved = harness.runtimeMessages.find(function (message) {
    return message.type === MESSAGE_TYPES.ANALYTICS_SAVE_COMPLETE;
  });
  assert.ok(saved);
  assert.equal(saved.snapshot.complete, true);
  assert.equal(saved.snapshot.reportKey, createReportKey(Object.assign({}, harness.query, harness.config)));
  assert.equal(saved.snapshot.input.projects[0].projectId, "P1");
  assert.equal(saved.snapshot.report.scope.persistable, true);
});

test("analytics history stores only retry descriptors for partial reports", async function () {
  const harness = createHarness(null);
  await harness.controller.query(true);
  const request = harness.pageMessages.at(-1);
  const failures = [{ source: "wbs", projectId: "P1", error: "HTTP 500" }];

  harness.listeners.message({
    source: harness.windowRef,
    data: {
      source: SOURCES.ANALYTICS_PAGE,
      type: MESSAGE_TYPES.ANALYTICS_RESULT,
      requestId: request.requestId,
      result: collectedResult({ complete: false, coverage: 0.8, failedRequests: failures })
    }
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  assert.equal(harness.runtimeMessages.some(function (message) {
    return message.type === MESSAGE_TYPES.ANALYTICS_SAVE_COMPLETE;
  }), false);
  const saved = harness.runtimeMessages.find(function (message) {
    return message.type === MESSAGE_TYPES.ANALYTICS_SAVE_FAILED;
  });
  assert.deepEqual(saved.descriptors, failures);
});

test("analytics history loads the adjacent previous snapshot with the same versions", async function () {
  let previousKey;
  const previous = { report: { metrics: { overview: { ac: 16000 } } } };
  const harness = createHarness(function (message) {
    return message.reportKey === previousKey ? previous : null;
  });
  previousKey = createReportKey({
    departmentId: harness.query.departmentId,
    startDate: "2026-06-29",
    endDate: "2026-07-05",
    configVersion: harness.config.configVersion,
    policyVersion: harness.config.policyVersion
  });

  await harness.controller.query(true);

  assert.equal(harness.runtimeMessages.length, 1);
  assert.equal(harness.runtimeMessages[0].type, MESSAGE_TYPES.ANALYTICS_GET_LATEST);
  assert.equal(harness.runtimeMessages[0].reportKey, previousKey);
  const request = harness.pageMessages.at(-1);
  harness.listeners.message({
    source: harness.windowRef,
    data: {
      source: SOURCES.ANALYTICS_PAGE,
      type: MESSAGE_TYPES.ANALYTICS_RESULT,
      requestId: request.requestId,
      result: collectedResult()
    }
  });
  assert.equal(harness.reports.at(-1).report.history.previousAvailable, true);
  assert.equal(harness.reports.at(-1).report.history.previous.metrics.overview.ac, 16000);
});

test("analytics history uses snapshots or requests an interval-only report", async function () {
  const cachedReport = { identity: { endDate: "2026-07-12" }, scope: { persistable: true }, tables: { projects: [] } };
  const cached = createHarness({
    capturedAt: "2026-07-13T00:00:00Z",
    report: cachedReport
  });

  await cached.controller.query({ historical: true });

  assert.equal(cached.reports[0].report, cachedReport);
  assert.match(cached.states.at(-1).status, /历史快照/);
  assert.equal(cached.pageMessages.length, 0);

  const missing = createHarness(null);
  await missing.controller.query({ historical: true });
  const request = missing.pageMessages.at(-1);
  assert.equal(request.cumulativeAvailable, false);
  assert.equal(request.historyMode, "interval");
});
