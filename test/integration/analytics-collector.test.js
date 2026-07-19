import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsCollector } from "../../src/page/business-analytics/collector.js";

function project(id) {
  return { projectId: id, projectName: "项目" + id, projectDept: "D1", classification: "J", currStatus: "20", isCreateWkReport: "1" };
}

function createData(options = {}) {
  let active = 0;
  let maxActive = 0;
  const projectCalls = [];
  const receivableCalls = [];
  const weeklyRanges = [];
  async function perProject(source, id) {
    projectCalls.push(source + ":" + id);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(function (resolve) { setTimeout(resolve, 1); });
    active -= 1;
    if (options.fail === source + ":" + id) throw new Error("HTTP 500 failed");
    if (options.session === source + ":" + id) {
      const error = new Error("HTTP 401 login");
      error.code = "SESSION_EXPIRED";
      throw error;
    }
    if (source === "weekly") return { status: "empty", rows: [], replacedIds: [], aggregate: { nextExecutions: [] } };
    return { status: "empty", rows: [] };
  }
  return {
    maxActive: function () { return maxActive; },
    projectCalls: function () { return projectCalls; },
    receivableCalls: function () { return receivableCalls; },
    weeklyRanges: function () { return weeklyRanges; },
    fetchDepartments: async function () { return [{ id: "D1", text: "交付一部", attributes: { privLevel: "2" } }]; },
    fetchProjects: async function () { return Array.from({ length: options.count || 5 }, function (_, index) { return project("P" + index); }); },
    fetchDailyRows: async function (startDate, endDate) {
      if (options.failDailyStart === startDate) throw new Error("HTTP 500 daily failed");
      const rows = options.dailyRows ? options.dailyRows(startDate, endDate) : [];
      return { status: rows.length > 0 ? "success" : "empty", rows };
    },
    fetchReceivables: async function (departmentId, projects) {
      receivableCalls.push({
        departmentId,
        projectIds: projects.map(function (item) { return item.projectId; })
      });
      if (options.failReceivables) throw new Error("HTTP 500 receivables failed");
      const rows = options.receivableRows || [];
      return {
        status: rows.length > 0 ? "success" : "empty",
        rows,
        diagnostics: options.receivableDiagnostics || {}
      };
    },
    fetchWbs: function (id) { return perProject("wbs", id); },
    fetchMilestones: function (id) { return perProject("milestones", id); },
    fetchWeeklyReports: function (value, range) {
      weeklyRanges.push(range);
      return perProject("weekly", value.projectId);
    }
  };
}

function request() {
  return {
    requestId: "R1",
    departmentId: "D1",
    departmentName: "交付一部",
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    projectFilters: {
      attribute: null,
      classification: ["J"],
      currStatus: ["20"],
      outsourcing: null,
      onlyCurrentPeriodInput: false
    }
  };
}

test("analytics collector limits project concurrency and reports complete coverage", async function () {
  const data = createData({ count: 6 });
  const progress = [];
  const result = await createAnalyticsCollector({ data, concurrency: 4 }).collect(request(), function (value) { progress.push(value); });
  assert.equal(result.complete, true);
  assert.equal(result.coverage, 1);
  assert.equal(result.projects.length, 6);
  assert.ok(data.maxActive() <= 4);
  assert.equal(progress.at(-1).stage, "complete");
});

test("analytics collector keeps partial results and failed retry descriptors", async function () {
  const data = createData({ count: 2, fail: "wbs:P1" });
  const result = await createAnalyticsCollector({ data, sleep: async function () {} }).collect(request());
  assert.equal(result.complete, false);
  assert.ok(result.coverage < 1);
  assert.deepEqual(result.failedRequests[0], { source: "wbs", projectId: "P1", error: "HTTP 500 failed" });
  assert.deepEqual(result.wbsByProject.P0, []);
});

test("analytics collector aborts all work on session expiry", async function () {
  const data = createData({ count: 3, session: "milestones:P0" });
  await assert.rejects(
    createAnalyticsCollector({ data }).collect(request()),
    function (error) { return error.code === "SESSION_EXPIRED"; }
  );
});

test("analytics collector cancels an older query when a new query starts", async function () {
  const data = createData({ count: 4 });
  const collector = createAnalyticsCollector({ data });
  const first = collector.collect(request());
  const second = collector.collect(Object.assign({}, request(), { requestId: "R2" }));
  await assert.rejects(first, function (error) { return error.code === "CANCELLED"; });
  assert.equal((await second).requestId, "R2");
});

test("analytics collector retries only failed descriptors", async function () {
  const data = createData({ count: 2, fail: "wbs:P1" });
  const collector = createAnalyticsCollector({ data, sleep: async function () {} });
  const partial = await collector.collect(request());
  let wbsCalls = 0;
  data.fetchWbs = async function (id) {
    wbsCalls += 1;
    return { status: "success", rows: [{ projectId: id, costLevel: 1 }] };
  };
  const retried = await collector.retryFailed(
    Object.assign({}, request(), { requestId: "R2" }),
    partial
  );
  assert.equal(wbsCalls, 1);
  assert.equal(retried.complete, true);
  assert.equal(retried.failedRequests.length, 0);
  assert.equal(retried.wbsByProject.P1.length, 1);
});

test("analytics collector scope-only mode does not fetch business details", async function () {
  const data = createData({ count: 2 });
  let detailCalls = 0;
  ["fetchDailyRows", "fetchReceivables", "fetchWbs", "fetchMilestones", "fetchWeeklyReports"]
    .forEach(function (name) {
      data[name] = async function () { detailCalls += 1; return { status: "empty", rows: [] }; };
    });
  const result = await createAnalyticsCollector({ data }).collect(
    Object.assign({}, request(), { scopeOnly: true })
  );
  assert.equal(result.scopeOnly, true);
  assert.equal(result.scope.departments.length, 1);
  assert.equal(detailCalls, 0);
});

test("analytics collector narrows the formal scope from current input and diagnoses changes", async function () {
  const data = createData({
    count: 3,
    dailyRows: function (startDate) {
      if (startDate === "2026-07-06") {
        return [
          { projectId: "P0", realHour: 8, cost: 100 },
          { projectId: "P2", realHour: 0, cost: 0 }
        ];
      }
      return [{ projectId: "P1", realHour: 16, cost: 200 }];
    }
  });
  const input = request();
  input.projectFilters.onlyCurrentPeriodInput = true;
  const result = await createAnalyticsCollector({ data }).collect(input);
  assert.deepEqual(result.projects.map(function (item) { return item.projectId; }), ["P0"]);
  assert.equal(result.formalScope.candidateProjectCount, 3);
  assert.equal(result.formalScope.formalProjectCount, 1);
  assert.deepEqual(result.formalScope.enteredProjectIds, ["P0"]);
  assert.deepEqual(result.formalScope.exitedProjectIds, ["P1"]);
  assert.ok(data.projectCalls().every(function (value) { return value.endsWith(":P0"); }));
  assert.equal(data.receivableCalls().length, 1);
  assert.deepEqual(data.receivableCalls()[0].projectIds, ["P0", "P1", "P2"]);
  assert.deepEqual(data.weeklyRanges()[0], {
    startDate: "2026-06-29",
    endDate: "2026-07-12"
  });
});

test("analytics collector requests cross-year receivables once for the selected sales department", async function () {
  const data = createData({ count: 1 });
  const input = Object.assign({}, request(), {
    startDate: "2026-07-01",
    endDate: "2026-07-03"
  });
  await createAnalyticsCollector({ data }).collect(input);
  assert.deepEqual(data.receivableCalls(), [{ departmentId: "D1", projectIds: ["P0"] }]);
});

test("analytics collector keeps unmatched receivables in department totals and groups matched rows by project", async function () {
  const data = createData({
    count: 1,
    receivableRows: [{ detailId: "D1", planId: "PLAN-1", projectId: "P0", planAmount: 100 },
      { detailId: "D2", planId: "PLAN-2", projectId: null, planAmount: 200 }],
    receivableDiagnostics: { unmappedCount: 1, unmappedAmount: 200 }
  });
  const result = await createAnalyticsCollector({ data }).collect(request());

  assert.equal(result.invoiceRows.length, 2);
  assert.deepEqual(result.invoicesByProject.P0.map(function (row) { return row.detailId; }), ["D1"]);
  assert.equal(result.diagnostics.receivables.unmappedCount, 1);
  assert.equal(result.sourceStatus.filter(function (item) { return item.source === "invoices"; }).length, 1);
  assert.equal(data.projectCalls().some(function (value) { return value.startsWith("invoices:"); }), false);
});

test("analytics collector retries the shared receivables source without legacy fallback", async function () {
  const data = createData({ count: 1, failReceivables: true });
  const collector = createAnalyticsCollector({ data, sleep: async function () {} });
  const partial = await collector.collect(request());
  assert.deepEqual(partial.failedRequests, [{ source: "invoices", error: "HTTP 500 receivables failed" }]);

  data.fetchReceivables = async function () {
    return {
      status: "success",
      rows: [{ detailId: "D1", planId: "PLAN-1", projectId: "P0" }],
      diagnostics: { unmappedCount: 0 }
    };
  };
  const retried = await collector.retryFailed(
    Object.assign({}, request(), { requestId: "R2" }),
    partial
  );

  assert.equal(retried.complete, true);
  assert.equal(retried.invoiceRows.length, 1);
  assert.equal(retried.invoicesByProject.P0.length, 1);
  assert.equal(retried.diagnostics.receivables.unmappedCount, 0);
});

test("analytics collector keeps technical daily failure distinct from zero input", async function () {
  const data = createData({ count: 2, failDailyStart: "2026-07-06" });
  const input = request();
  input.projectFilters.onlyCurrentPeriodInput = true;
  const result = await createAnalyticsCollector({ data, sleep: async function () {} }).collect(input);
  assert.equal(result.formalScope.status, "failed");
  assert.equal(result.formalScope.formalProjectCount, null);
  assert.equal(result.projects.length, 2);
  assert.ok(result.failedRequests.some(function (item) { return item.source === "daily"; }));
});

test("analytics collector stops project requests for a known empty formal scope", async function () {
  const data = createData({ count: 2 });
  const input = request();
  input.projectFilters.onlyCurrentPeriodInput = true;
  const result = await createAnalyticsCollector({ data }).collect(input);
  assert.equal(result.formalScope.formalProjectCount, 0);
  assert.deepEqual(result.projects, []);
  assert.deepEqual(data.projectCalls(), []);
});

test("analytics collector reapplies the formal scope after retrying current daily input", async function () {
  const data = createData({ count: 2, failDailyStart: "2026-07-06" });
  const input = request();
  input.projectFilters.onlyCurrentPeriodInput = true;
  const collector = createAnalyticsCollector({ data, sleep: async function () {} });
  const partial = await collector.collect(input);
  data.fetchDailyRows = async function (startDate) {
    const rows = startDate === "2026-07-06"
      ? [{ projectId: "P1", realHour: 8, cost: 100 }]
      : [];
    return { status: rows.length > 0 ? "success" : "empty", rows };
  };
  const retried = await collector.retryFailed(
    Object.assign({}, input, { requestId: "R2" }),
    partial
  );
  assert.deepEqual(retried.projects.map(function (item) { return item.projectId; }), ["P1"]);
  assert.equal(retried.formalScope.formalProjectCount, 1);
  assert.equal(retried.complete, true);
});
