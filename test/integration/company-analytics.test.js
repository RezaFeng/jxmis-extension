import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsEngine } from "../../src/analytics/engine.js";
import { renderCompanyAnalyticsSection } from "../../src/content/business-analytics/report-view.js";

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
    invoiceRows: [],
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
  liveInput.invoiceRows = [{
    detailId: "I1",
    planId: "PLAN-1",
    projectId: "P2",
    salesDepartmentName: "一部",
    planDate: "2026-07-10",
    planAmount: 100,
    receivedFlag: "0",
    receivedAmount: 0,
    pendingAmount: 100,
    valid: true
  }];

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
  assert.equal(report.metrics.invoice.monthPlan, 100);
  assert.equal(report.company.coverage, 1);
  assert.equal(report.company.complete, true);
  assert.deepEqual(report.company.missingDepartmentIds, []);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D1";
  }).projectCount, 2);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D1";
  }).metrics.invoice.monthPlan, 100);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D2";
  }).projectCount, 1);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D2";
  }).metrics.invoice.monthPlan, 0);
  assert.equal(report.company.departments.find(function (item) {
    return item.departmentId === "D3";
  }).status, "ready");
  assert.equal(report.scope.persistable, undefined);
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
  const value = input("all", "全部部门", [project("P1", 100000, 50000, 25000, "D1")]);
  const report = engine.buildCompanyReport({
    liveInput: value,
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
  assert.match(section.textContent, /全部部门总览部门覆盖 2\/2/);
  assert.match(section.textContent, /一部可用1/);
  assert.match(section.textContent, /二部可用0/);
  findByRole(section, "department-D1").click();
  assert.deepEqual(selected, ["D1"]);
});
