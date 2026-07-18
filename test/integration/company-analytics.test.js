import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsEngine } from "../../src/analytics/engine.js";
import { createReportKey } from "../../src/analytics/config.js";
import { createBusinessAnalyticsController } from "../../src/content/business-analytics/controller.js";
import { renderCompanyAnalyticsSection } from "../../src/content/business-analytics/report-view.js";
import { MESSAGE_TYPES } from "../../src/shared/protocol.js";

function project(id, revenue, bac, ac, departmentId) {
  return {
    projectId: id,
    projectNo: "JX-" + id,
    projectName: "项目" + id,
    projectManagerName: "经理" + id,
    projectDept: departmentId || null,
    subcontractAmount: revenue,
    estiExeuCost: bac,
    realExeuCost: ac,
    realWorkload: 261,
    planCompleteSchedule: 50
  };
}

function input(departmentId, departmentName, projects) {
  return {
    departmentId,
    departmentName,
    configVersion: "config-v1",
    policyVersion: "policy-v1",
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    capturedAt: "2026-07-13T00:00:00Z",
    complete: true,
    projects,
    dailyByProject: Object.fromEntries(projects.map(function (item) { return [item.projectId, [{ realHour: 8, cost: 100 }]]; })),
    previousDailyByProject: Object.fromEntries(projects.map(function (item) { return [item.projectId, []]; })),
    wbsByProject: Object.fromEntries(projects.map(function (item) { return [item.projectId, []]; })),
    milestonesByProject: Object.fromEntries(projects.map(function (item) { return [item.projectId, []]; })),
    invoicesByProject: Object.fromEntries(projects.map(function (item) { return [item.projectId, []]; })),
    weeklyByProject: {},
    nextPlannedHoursByProject: Object.fromEntries(projects.map(function (item) { return [item.projectId, 0]; })),
    sourceStatus: [],
    failedRequests: [],
    diagnostics: {}
  };
}

test("company analytics deduplicates one live result and recomputes department ratios", function () {
  const shared = project("SHARED", 200, 100, 50, "D1");
  const liveInput = input("all", "全部部门", [
    project("P1", 100, 50, 25, "D1"),
    shared,
    Object.assign({}, shared, { projectDept: "D2" }),
    project("P2", 300, 150, 75, "D2")
  ]);

  const report = createAnalyticsEngine().buildCompanyReport({
    liveInput,
    departments: [
      { id: "D1", name: "一部", projectCount: 2 },
      { id: "D2", name: "二部", projectCount: 2 },
      { id: "D3", name: "三部", projectCount: 1 }
    ],
    configVersion: "config-v1",
    policyVersion: "policy-v1",
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  });

  assert.equal(report.metrics.overview.projectCount, 3);
  assert.equal(report.metrics.overview.revenue, 600);
  assert.equal(report.metrics.overview.bac, 300);
  assert.equal(report.metrics.overview.ac, 150);
  assert.equal(report.metrics.overview.cpi, 1);
  assert.equal(report.company.coverage, 1);
  assert.equal(report.company.complete, true);
  assert.deepEqual(report.company.missingDepartmentIds, []);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D1";
  }).projectCount, 2);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D2";
  }).projectCount, 1);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D3";
  }).status, "ready");
  assert.equal(report.scope.persistable, false);
});

test("company analytics isolates a project failure to its live department", function () {
  const liveInput = input("all", "全部部门", [
    project("P1", 100, 50, 25, "D1"),
    project("P2", 300, 150, 75, "D2")
  ]);
  liveInput.complete = false;
  liveInput.failedRequests = [{ source: "wbs", projectId: "P2", error: "HTTP 500" }];
  liveInput.sourceStatus = [{ source: "wbs", projectId: "P2", status: "failed" }];
  const report = createAnalyticsEngine().buildCompanyReport({
    liveInput,
    departments: [{ id: "D1", name: "一部" }, { id: "D2", name: "二部" }]
  });
  assert.equal(report.company.coverage, 0.5);
  assert.equal(report.company.departments[0].status, "ready");
  assert.equal(report.company.departments[1].status, "failed");
  assert.deepEqual(report.company.missingDepartmentIds, ["D2"]);
});

test("company analytics controller aggregates department snapshots without background collection", async function () {
  const departments = [{ id: "D1", name: "一部", projectCount: 1 }, { id: "D2", name: "二部", projectCount: 1 }];
  const config = { projectFilters: {}, riskThresholds: {}, configVersion: "config-v1", policyVersion: "policy-v1" };
  const snapshots = new Map(departments.map(function (department, index) {
    const value = input(department.id, department.name, [project("P" + (index + 1), 100, 50, 25)]);
    return [createReportKey(value), { complete: true, capturedAt: value.capturedAt, input: value }];
  }));
  const runtimeMessages = [];
  const pageMessages = [];
  const reports = [];
  const states = [];
  const windowRef = { addEventListener: function () {}, postMessage: function (message) { pageMessages.push(message); } };
  const controller = createBusinessAnalyticsController({
    window: windowRef,
    document: {},
    config,
    departments,
    navigation: { restore: function () {}, isActive: function () { return false; }, syncLocation: function () {} },
    view: {
      getQuery: function () { return { departmentId: "all", departmentName: "全部部门", startDate: "2026-07-06", endDate: "2026-07-12" }; },
      renderState: function (state) { states.push(state); },
      renderReport: function (report) { reports.push(report); }
    },
    chrome: {
      runtime: {
        getURL: function () { return "business-analytics.css"; },
        openOptionsPage: function () {},
        sendMessage: function (message, callback) {
          runtimeMessages.push(message);
          callback({ ok: true, result: snapshots.get(message.reportKey) || null });
        }
      },
      storage: { local: { get: function (_defaults, callback) { callback({}); } } }
    }
  });

  await controller.query(false);

  assert.equal(runtimeMessages.length, 2);
  assert.equal(runtimeMessages.every(function (message) { return message.type === MESSAGE_TYPES.ANALYTICS_GET_LATEST; }), true);
  assert.equal(pageMessages.length, 0);
  assert.equal(reports[0].company.coverage, 1);
  assert.match(states.at(-1).status, /部门覆盖 2\/2/);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this._text = "";
  }
  set textContent(value) { this._text = String(value ?? ""); this.children = []; }
  get textContent() { return this._text + this.children.map(function (child) { return child.textContent; }).join(""); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  addEventListener(_type, listener) { this.listener = listener; }
  click() { if (this.listener) this.listener(); }
}

function findByRole(root, role) {
  if (root.dataset.role === role) return root;
  for (const child of root.children) {
    const match = findByRole(child, role);
    if (match) return match;
  }
  return null;
}

test("company analytics view shows department coverage and drills down", function () {
  const engine = createAnalyticsEngine();
  const value = input("D1", "一部", [project("P1", 100000, 50000, 25000)]);
  const report = engine.buildCompanyReport({
    snapshots: [{ complete: true, capturedAt: value.capturedAt, input: value }],
    departments: [{ id: "D1", name: "一部" }, { id: "D2", name: "二部" }],
    configVersion: "config-v1",
    policyVersion: "policy-v1",
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  });
  const selected = [];
  const host = new FakeElement("div");

  renderCompanyAnalyticsSection(
    { createElement: function (tagName) { return new FakeElement(tagName); } },
    host,
    report,
    function (departmentId) { selected.push(departmentId); }
  );

  const section = findByRole(host, "company-analytics");
  assert.match(section.textContent, /全部部门总览部门覆盖 1\/2/);
  assert.match(section.textContent, /一部完整1/);
  assert.match(section.textContent, /二部缺失未获取/);
  assert.doesNotMatch(section.textContent, /二部缺失0/);
  findByRole(section, "department-D1").click();
  assert.deepEqual(selected, ["D1"]);
});
