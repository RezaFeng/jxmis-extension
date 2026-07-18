import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsCollector } from "../../src/page/business-analytics/collector.js";

function project(id) {
  return { projectId: id, projectName: "项目" + id, projectDept: "D1", classification: "J", currStatus: "20", isCreateWkReport: "1" };
}

function createData(options = {}) {
  let active = 0;
  let maxActive = 0;
  async function perProject(source, id) {
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
    fetchDepartments: async function () { return [{ id: "D1", text: "交付一部", attributes: { privLevel: "2" } }]; },
    fetchProjects: async function () { return Array.from({ length: options.count || 5 }, function (_, index) { return project("P" + index); }); },
    fetchDailyRows: async function () { return { status: "empty", rows: [] }; },
    fetchMonthlyInvoiceSupplement: async function () { return { status: "empty", rows: [], diagnostics: {} }; },
    fetchWbs: function (id) { return perProject("wbs", id); },
    fetchMilestones: function (id) { return perProject("milestones", id); },
    fetchWeeklyReports: function (value) { return perProject("weekly", value.projectId); },
    fetchProjectInvoices: function (id) { return perProject("invoices", id); }
  };
}

function request() {
  return {
    requestId: "R1",
    departmentId: "D1",
    departmentName: "交付一部",
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    projectFilters: { attribute: null, classification: ["J"], currStatus: ["20"], outsourcing: null }
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
