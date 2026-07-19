import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsEngine } from "../../src/analytics/engine.js";
import {
  filterProjectRows,
  renderAnalyticsManagementSections,
  renderAnalyticsOperationalSections,
  renderAnalyticsStatusSection,
  renderPeriodComparisonSection
} from "../../src/content/business-analytics/report-view.js";

const projects = [{ projectId: "P1", projectNo: "JX-1", projectName: "项目一", currStatus: "20", projectManagerName: "经理甲", inputMd: 1, risks: [{ type: "lowCpi" }] },
  { projectId: "P2", projectNo: "JX-2", projectName: "项目二", currStatus: "50", projectManagerName: "经理乙", inputMd: 0, risks: [] }];

test("analytics overview project selection combines filters", function () {
  assert.deepEqual(filterProjectRows(projects, {
    search: "JX-1",
    status: "20",
    pm: "经理甲",
    activity: "yes",
    risk: "lowCpi"
  }).map(function (item) { return item.projectId; }), ["P1"]);
  assert.deepEqual(filterProjectRows(projects, {
    search: "项目",
    status: "",
    pm: "",
    activity: "no",
    risk: ""
  }).map(function (item) { return item.projectId; }), ["P2"]);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.dataset = {};
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map(function (child) { return child.textContent; }).join("");
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(_type, listener) {
    this.listener = listener;
  }

  click() {
    if (this.listener) this.listener();
  }
}

const fakeDocument = {
  createElement: function (tagName) { return new FakeElement(tagName); }
};

function findByRole(root, role) {
  if (root.dataset.role === role) return root;
  for (const child of root.children) {
    const match = findByRole(child, role);
    if (match) return match;
  }
  return null;
}

function analyticsInput(overrides = {}) {
  return Object.assign({
    departmentId: "D1",
    departmentName: "交付一部",
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    capturedAt: "2026-07-13T08:00:00.000Z",
    complete: true,
    projects: [{
      projectId: "P1",
      projectNo: "JX-1",
      projectName: "项目一",
      projectManagerName: "经理甲",
      subcontractAmount: 1000000,
      estiExeuCost: 500000,
      realExeuCost: 200000,
      realWorkload: 261,
      planCompleteSchedule: 50
    }],
    dailyByProject: { P1: [{ realHour: 8, cost: 1000 }] },
    previousDailyByProject: { P1: [{ realHour: 4, cost: 500 }] },
    wbsByProject: { P1: [{ costLevel: 10000, planEndTime: "2026-07-08", actualEndTime: "2026-07-09" }] },
    milestonesByProject: { P1: [] },
    invoiceRows: [],
    invoicesByProject: { P1: [] },
    nextPlannedHoursByProject: { P1: 16 },
    formalScope: {
      candidateProjectCount: 2,
      formalProjectCount: 1,
      onlyCurrentPeriodInput: true,
      status: "success"
    },
    coverage: 1,
    diagnostics: { receivables: {} }
  }, overrides);
}

test("analytics view shows live scope status and adjacent period comparisons", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput());
  const host = new FakeElement("div");
  renderAnalyticsStatusSection(fakeDocument, host, report);
  renderPeriodComparisonSection(fakeDocument, host, report);
  assert.match(host.textContent, /周期 2026-07-06 至 2026-07-12/);
  assert.match(host.textContent, /正式范围 1\/2/);
  assert.match(host.textContent, /仅本期日报投入项目/);
  assert.match(host.textContent, /来源覆盖率 100%/);
  assert.match(host.textContent, /本期经营与上期比较/);
  assert.match(host.textContent, /投入与产出指标本周上周变化环比/);
  assert.match(host.textContent, /里程碑/);
  assert.match(host.textContent, /回款/);
  assert.doesNotMatch(host.textContent, /无法历史回溯/);
});

test("active projects render 15 cards, period labels, table and unavailable cells", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    nextPlannedHoursByProject: {}
  }));
  const host = new FakeElement("div");

  renderAnalyticsOperationalSections(fakeDocument, host, report);

  const section = findByRole(host, "active-projects");
  const cards = findByRole(section, "active-cards");
  assert.equal(cards.children[0].children.length, 15);
  assert.match(section.textContent, /本周有投入项目经营/);
  assert.match(section.textContent, /本周投入人天/);
  assert.match(section.textContent, /上周投入人天/);
  assert.match(section.textContent, /下周计划人天/);
  assert.match(section.textContent, /JX-1项目一经理甲/);
  assert.match(section.textContent, /未获取/);
});

test("active projects use period wording for a custom date range", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    startDate: "2026-07-07",
    endDate: "2026-07-12"
  }));
  const host = new FakeElement("div");

  renderAnalyticsOperationalSections(fakeDocument, host, report);

  const section = findByRole(host, "active-projects");
  assert.match(section.textContent, /本期有投入项目经营/);
  assert.match(section.textContent, /本期投入人天/);
  assert.match(section.textContent, /上期投入人天/);
  assert.match(section.textContent, /下期计划人天/);
});

test("milestone view renders cards, overdue and upcoming project lists", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    milestonesByProject: {
      P1: [
        { milestoneId: "M1", nodeName: "上线", planEndTime: "2026-07-05", actualEndTime: null, confirmStatus: "1" },
        { milestoneId: "M2", nodeName: "验收", planEndTime: "2026-07-10", actualEndTime: "2026-07-10", confirmStatus: "2" },
        { milestoneId: "M3", nodeName: "发布", planEndTime: "2026-07-15", actualEndTime: null, confirmStatus: "1" }
      ]
    }
  }));
  const host = new FakeElement("div");

  renderAnalyticsOperationalSections(fakeDocument, host, report);

  const section = findByRole(host, "milestone-view");
  const cards = findByRole(section, "milestone-cards");
  assert.equal(cards.children[0].children.length, 3);
  assert.match(section.textContent, /里程碑与关键节点/);
  assert.match(section.textContent, /本月节点/);
  assert.match(section.textContent, /已逾期/);
  assert.match(section.textContent, /未来 7 天/);
  assert.match(section.textContent, /JX-1项目一经理甲上线2026-07-05未完成逾期 7 天/);
  assert.match(section.textContent, /JX-1项目一经理甲发布2026-07-15未完成剩余 3 天/);
});

test("invoice view renders cards, overdue rows and unmapped diagnostics", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    invoiceRows: [{
      invoiceId: "I1",
      detailId: "I1",
      planId: "PLAN-1",
      projectId: "P1",
      projectNo: "JX-1",
      projectName: "项目一",
      projectManagerName: "经理甲",
      contractNo: "HT-1",
      contractName: "合同订单一",
      customerName: "客户甲",
      paymentNature: "进度款",
      planDate: "2026-07-01",
      realReceivedDate: null,
      planAmount: 300000,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 300000,
      valid: true
    }, {
      invoiceId: "I2",
      detailId: "I2",
      planId: "PLAN-2",
      projectId: "P1",
      projectNo: "JX-1",
      projectName: "项目一",
      projectManagerName: "经理甲",
      contractNo: "HT-1",
      contractName: "合同订单二",
      customerName: "客户甲",
      paymentNature: "验收款",
      planDate: "2026-07-10",
      realReceivedDate: "2026-07-09",
      planAmount: 200000,
      receivedFlag: "1",
      receivedAmount: 200000,
      pendingAmount: 0,
      valid: true
    }],
    diagnostics: {
      receivables: {
        unmappedCount: 2,
        unmappedAmount: 300000,
        ambiguousCount: 1,
        ambiguousAmount: 100000,
        invalidCount: 1,
        unmapped: [{ contractNo: "NONE" }],
        ambiguous: [{ contractNo: "DUP" }],
        invalid: [{ detailId: "BAD", fields: ["recFlag"] }]
      }
    }
  }));
  const host = new FakeElement("div");

  renderAnalyticsOperationalSections(fakeDocument, host, report);

  const section = findByRole(host, "invoice-view");
  const cards = findByRole(section, "invoice-cards");
  assert.equal(cards.children[0].children.length, 4);
  assert.match(section.textContent, /回款计划/);
  assert.match(section.textContent, /当月计划明细/);
  assert.match(section.textContent, /逾期未回/);
  assert.match(section.textContent, /HT-1项目一 \/ 合同订单一经理甲客户甲进度款30 万元0 万元30 万元2026-07-01-待回款 · 逾期 11 天/);
  assert.match(section.textContent, /合同订单二.*2026-07-09已回款/);
  assert.match(section.textContent, /2 笔/);
  assert.match(section.textContent, /回款率 40%/);
  assert.match(section.textContent, /未映射 2 笔，30 万元/);
  assert.match(section.textContent, /多重匹配 1 笔，10 万元/);
  assert.match(section.textContent, /数据异常 1 笔/);
});

test("invoice view displays failed source values as unavailable", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    complete: false,
    invoiceRows: [],
    invoicesByProject: {},
    sourceStatus: [
      { source: "invoices", status: "failed" }
    ]
  }));
  const host = new FakeElement("div");

  renderAnalyticsOperationalSections(fakeDocument, host, report);

  const section = findByRole(host, "invoice-view");
  assert.match(
    section.textContent,
    /当月计划未获取笔数未获取已回款未获取笔数未获取 · 回款率 -待回款未获取逾期未回笔数未获取/
  );
  assert.doesNotMatch(section.textContent, /当月计划0/);
});

test("invoice view exposes signed details behind an overdue plan net amount", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    invoiceRows: [{
      detailId: "R1",
      planId: "RED-1",
      contractNo: "HT-RED",
      projectName: "红冲项目",
      projectManagerName: "经理甲",
      planDate: "2026-06-01",
      planAmount: 100000,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 100000,
      redReversal: "是",
      invoiceBatch: "1",
      valid: true
    }, {
      detailId: "R2",
      planId: "RED-1",
      contractNo: "HT-RED",
      projectName: "红冲项目",
      projectManagerName: "经理甲",
      planDate: "2026-06-02",
      planAmount: -40000,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: -40000,
      redReversal: "是",
      invoiceBatch: "2",
      valid: true
    }]
  }));
  const host = new FakeElement("div");

  renderAnalyticsOperationalSections(fakeDocument, host, report);

  const details = findByRole(host, "invoice-plan-details");
  assert.ok(details);
  assert.match(details.textContent, /HT-RED 净额组成（2 条）/);
  assert.match(details.textContent, /10 万元/);
  assert.match(details.textContent, /-4 万元/);
});

test("PM analytics renders manager aggregates and weekly execution", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    weeklyByProject: {
      P1: {
        aggregate: {
          summaries: [{
            wkId: "WK-1",
            startDate: "2026-07-06",
            endDate: "2026-07-12",
            summary: "完成联调",
            nextPlan: "开始验收"
          }],
          currentExecutions: [{ taskName: "接口联调", majorPerson: "张三", realHour: 8 }]
        }
      }
    }
  }));
  const host = new FakeElement("div");

  renderAnalyticsManagementSections(fakeDocument, host, report, function () {});

  assert.match(findByRole(host, "pm-analytics").textContent, /经理甲1/);
  assert.match(findByRole(host, "weekly-execution").textContent, /2026-07-06 至 2026-07-12JX-1项目一经理甲完成联调开始验收/);
  assert.match(findByRole(host, "weekly-execution").textContent, /接口联调张三8 小时/);
});

test("budget health renders project budget and exhaustion values", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput());
  const host = new FakeElement("div");

  renderAnalyticsManagementSections(fakeDocument, host, report, function () {});

  const section = findByRole(host, "budget-health");
  assert.match(section.textContent, /JX-1项目一经理甲/);
  assert.match(section.textContent, /50 万元/);
  assert.match(section.textContent, /30 万元/);
  assert.match(section.textContent, /2,100/);
});

test("data diagnostics renders coverage failures and retry action", function () {
  const report = createAnalyticsEngine().buildReport(analyticsInput({
    complete: false,
    coverage: 0.75,
    sourceStatus: [
      { source: "daily", status: "success" },
      { source: "wbs", projectId: "P1", status: "failed", error: "HTTP 500" }
    ],
    failedRequests: [{ source: "wbs", projectId: "P1", error: "HTTP 500" }],
    diagnostics: {
      historicalDepartments: [{ projectDept: "OLD", projectDeptName: "历史部门", projectCount: 2 }],
      enteredProjectIds: ["P1"],
      exitedProjectIds: [],
      rangeChangeProjects: [{
        projectId: "P1",
        projectNo: "JX-1",
        projectName: "项目一",
        currentInputMd: 1,
        previousInputMd: 0
      }],
      receivables: { unmappedCount: 1, unmappedAmount: 100000, ambiguousCount: 0, ambiguousAmount: 0, invalidCount: 0 },
      replacedWeeklyReportIds: ["WK-OLD"]
    }
  }));
  const actions = [];
  const host = new FakeElement("div");

  renderAnalyticsManagementSections(fakeDocument, host, report, function (action) { actions.push(action); });

  const section = findByRole(host, "data-diagnostics");
  assert.match(section.textContent, /来源覆盖率75%/);
  assert.match(section.textContent, /wbsP1HTTP 500/);
  assert.match(findByRole(section, "range-changes").textContent, /本期进入JX-1项目一10/);
  assert.match(findByRole(section, "historical-departments").textContent, /OLD历史部门2/);
  assert.match(section.textContent, /未映射回款1 笔，10 万元/);
  assert.match(section.textContent, /替代周报WK-OLD/);
  findByRole(section, "retry-failed").click();
  assert.deepEqual(actions, ["retry-failed"]);
});
