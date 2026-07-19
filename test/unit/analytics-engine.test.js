import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsEngine } from "../../src/analytics/engine.js";
import { evaluateProjectRisks, RISK_TYPES, summarizeRisks } from "../../src/analytics/risks.js";

function fixture(overrides = {}) {
  return Object.assign({
    departmentId: "D1",
    departmentName: "交付一部",
    configVersion: "config-v1",
    policyVersion: "policy-v1",
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    capturedAt: "2026-07-13T00:00:00.000Z",
    complete: true,
    projects: [{
      projectId: "P1",
      projectNo: "JX-1",
      projectName: "项目一",
      projectManagerName: "经理甲",
      subcontractAmount: 1000,
      estiExeuCost: 500,
      realExeuCost: 600,
      realWorkload: 261,
      planCompleteSchedule: 50
    }, {
      projectId: "P2",
      projectNo: "JX-2",
      projectName: "项目二",
      projectManagerName: "经理乙",
      subcontractAmount: 2000,
      estiExeuCost: 1000,
      realExeuCost: 400,
      realWorkload: 261,
      planCompleteSchedule: 25
    }],
    dailyByProject: {
      P1: [{ realHour: 8, cost: 100 }],
      P2: [{ realHour: 8, cost: 100 }]
    },
    previousDailyByProject: {
      P1: [{ realHour: 4, cost: 50 }],
      P2: [{ realHour: 8, cost: 100 }]
    },
    wbsByProject: {
      P1: [{ costLevel: 100, planEndTime: "2026-07-08", actualEndTime: "2026-07-20" }],
      P2: [{ costLevel: 200, planEndTime: "2026-07-09", actualEndTime: "2026-07-10" }]
    },
    milestonesByProject: {
      P1: [{ planEndTime: "2026-07-05", confirmStatus: "1", nodeName: "上线" }],
      P2: [{ planEndTime: "2026-07-11", confirmStatus: "2", nodeName: "验收" }]
    },
    invoiceRows: [{
      detailId: "I1",
      planId: "PLAN-1",
      projectId: "P1",
      planDate: "2026-07-01",
      planAmount: 100,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 100,
      valid: true
    }, {
      detailId: "I2",
      planId: "PLAN-2",
      projectId: "P2",
      planDate: "2026-07-10",
      planAmount: 200,
      receivedFlag: "1",
      receivedAmount: 100,
      pendingAmount: 0,
      valid: true
    }],
    invoicesByProject: {
      P1: [{ planId: "PLAN-1", planDate: "2026-07-01", planAmount: 100, receivedFlag: "0", receivedAmount: 0, pendingAmount: 100, valid: true }],
      P2: [{ planId: "PLAN-2", planDate: "2026-07-10", planAmount: 200, receivedFlag: "1", receivedAmount: 100, pendingAmount: 0, valid: true }]
    },
    nextPlannedHoursByProject: { P1: 8, P2: 16 }
  }, overrides);
}

test("analytics risks classify thresholds and deduplicate attention projects", function () {
  const first = {
    projectId: "P1",
    perCapita: 100,
    cpi: 0.5,
    ac: 120,
    bac: 100,
    periodSPI: 0.4,
    inputMd: 1,
    periodEV: 0,
    remainingBudget: 0,
    burnRatePerDay: 10,
    overdueMilestoneCount: 1,
    overdueInvoiceCount: 1
  };
  first.risks = evaluateProjectRisks(first);
  assert.equal(first.risks.some(function (item) { return item.type === RISK_TYPES.SPI_CRITICAL; }), true);
  assert.equal(first.risks.some(function (item) { return item.type === RISK_TYPES.SPI_WARN; }), false);
  assert.equal(first.risks.some(function (item) { return item.type === RISK_TYPES.SEVERE_OVERRUN; }), true);
  const summary = summarizeRisks([first]);
  assert.equal(summary.attentionProjectCount, 1);
  assert.ok(summary.itemCount > 1);
});

test("analytics engine outputs 34 cards and 35 values", function () {
  const report = createAnalyticsEngine().buildReport(fixture());
  const cards = Object.values(report.cards).flat();
  const values = cards.flatMap(function (item) { return item.values; });
  assert.equal(cards.length, 34);
  assert.equal(values.length, 35);
  assert.equal(report.scope.periodLabels.current, "本周");
  assert.equal(report.scope.persistable, undefined);
  assert.equal(report.metrics.overview.cpi, 0.5);
  assert.equal(report.metrics.risks.attentionProjectCount, 2);
  assert.equal(report.metrics.milestone.overdueCount, 1);
  assert.equal(report.metrics.invoice.monthPlan, 300);
  assert.equal(report.metrics.invoice.received, 100);
  assert.equal(report.metrics.invoice.pending, 100);
  assert.equal(report.metrics.invoice.plannedCount, 2);
  assert.equal(report.metrics.invoice.receivedCount, 1);
  assert.equal(report.metrics.invoice.receivedRate, 1 / 3);
  assert.equal(report.tables.projectManagers.length, 2);
  assert.equal(report.tables.budgetHealth[0].periodCost, 100);
});

test("analytics engine keeps future WBS completion out of report cutoff", function () {
  const report = createAnalyticsEngine().buildReport(fixture());
  const first = report.tables.projects.find(function (project) { return project.projectId === "P1"; });
  assert.equal(first.periodEV, 0);
  assert.equal(first.totalSPI, 0);
  assert.equal(first.risks.some(function (item) {
    return item.type === RISK_TYPES.HIGH_INPUT_ZERO_OUTPUT;
  }), true);
});

test("analytics engine marks temporary project selection explicitly", function () {
  const report = createAnalyticsEngine().buildReport(fixture({ selectedProjectIds: ["P2"] }));
  assert.equal(report.scope.mode, "selection");
  assert.equal(report.scope.selectedCount, 1);
  assert.equal(report.scope.totalCount, 2);
  assert.equal(report.scope.persistable, undefined);
  assert.equal(report.metrics.overview.projectCount, 1);
  assert.deepEqual(report.tables.projects.map(function (project) { return project.projectId; }), ["P2"]);
});

test("analytics engine always calculates cumulative metrics from live project data", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    complete: false,
    cumulativeAvailable: false,
    historyMode: "interval",
    startDate: "2026-06-01",
    endDate: "2026-06-03"
  }));
  assert.equal(report.scope.periodLabels.current, "本期");
  assert.equal(report.metrics.overview.ac, 1000);
  assert.equal(report.scope.cumulativeAvailable, undefined);
  assert.equal(report.scope.historyMode, undefined);
  assert.equal(report.history, undefined);
  const acCard = report.cards.overview.find(function (item) { return item.id === "ac"; });
  assert.equal(acCard.values[0].status, "ready");
});

test("analytics engine keeps failed business sources unavailable instead of zero", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    complete: false,
    dailyByProject: {},
    previousDailyByProject: {},
    milestonesByProject: { P2: [] },
    invoiceRows: [],
    invoicesByProject: { P2: [] },
    sourceStatus: [
      { source: "daily", status: "failed" },
      { source: "previousDaily", status: "failed" },
      { source: "milestones", projectId: "P1", status: "failed" },
      { source: "milestones", projectId: "P2", status: "empty" },
      { source: "invoices", status: "failed" }
    ]
  }));

  assert.equal(report.metrics.active.inputMd, null);
  assert.equal(report.metrics.active.inputCost, null);
  assert.equal(report.metrics.active.inputDelta, null);
  assert.equal(report.metrics.milestone.plannedCount, null);
  assert.equal(report.metrics.milestone.overdueCount, null);
  assert.equal(report.metrics.invoice.monthPlan, null);
  assert.equal(report.metrics.invoice.received, null);
  assert.equal(report.metrics.invoice.pending, null);
  assert.equal(report.metrics.invoice.overdueCount, null);
  assert.equal(report.cards.active.find(function (item) { return item.id === "inputMd"; }).values[0].status, "unavailable");
  assert.equal(report.cards.milestone.find(function (item) { return item.id === "milestonePlanned"; }).values[0].status, "unavailable");
  assert.equal(report.cards.invoice.find(function (item) { return item.id === "invoiceMonthPlan"; }).values[0].status, "unavailable");
});

test("analytics engine treats successful empty sources as known zero", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    dailyByProject: {},
    previousDailyByProject: {},
    milestonesByProject: { P1: [], P2: [] },
    invoiceRows: [],
    invoicesByProject: { P1: [], P2: [] },
    sourceStatus: [
      { source: "daily", status: "empty" },
      { source: "previousDaily", status: "empty" },
      { source: "milestones", projectId: "P1", status: "empty" },
      { source: "milestones", projectId: "P2", status: "empty" },
      { source: "invoices", status: "empty" }
    ]
  }));

  assert.equal(report.metrics.active.inputMd, 0);
  assert.equal(report.metrics.active.inputCost, 0);
  assert.equal(report.metrics.milestone.plannedCount, 0);
  assert.equal(report.metrics.milestone.overdueCount, 0);
  assert.equal(report.metrics.invoice.monthPlan, 0);
  assert.equal(report.metrics.invoice.received, 0);
  assert.equal(report.metrics.invoice.pending, 0);
  assert.equal(report.metrics.invoice.overdueCount, 0);
});

test("analytics engine builds adjacent period comparison from the same live project set", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    previousReport: {
      identity: { startDate: "2026-06-29", endDate: "2026-07-05", capturedAt: "2026-07-06T00:00:00Z" },
      metrics: {
        overview: { ac: 800, revenue: 2400 },
        active: { inputMd: 1, inputCost: 100 }
      }
    }
  }));

  assert.equal(report.metrics.overview.ac, 1000);
  assert.equal(report.metrics.previous.active.inputMd, 1.5);
  assert.deepEqual(report.metrics.comparison.active.inputMd, {
    current: 2,
    previous: 1.5,
    delta: 0.5,
    changeRate: 1 / 3
  });
  assert.deepEqual(report.metrics.comparison.active.periodPV, {
    current: 300,
    previous: 0,
    delta: 300,
    changeRate: 0
  });
  assert.equal(report.metrics.comparison.overview, undefined);
  assert.equal(report.metrics.comparison.milestone.overdueCount.current, 1);
  assert.equal(report.metrics.comparison.milestone.overdueCount.previous, 0);
  assert.equal(report.metrics.comparison.invoice.overdueCount.current, 1);
  assert.equal(report.metrics.comparison.invoice.overdueCount.previous, 1);
  assert.equal(report.history, undefined);
});

test("period comparison keeps a failed previous source unavailable without hiding current values", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    previousDailyByProject: {},
    sourceStatus: [{ source: "previousDaily", status: "failed" }]
  }));

  assert.equal(report.metrics.active.inputMd, 2);
  assert.equal(report.metrics.previous.active.inputMd, null);
  assert.deepEqual(report.metrics.comparison.active.inputMd, {
    current: 2,
    previous: null,
    delta: null,
    changeRate: null
  });
  assert.equal(report.metrics.active.periodPV, 300);
});

test("analytics engine nets signed red reversals by plan and excludes invalid rows", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    endDate: "2026-07-15",
    invoiceRows: [{
      detailId: "R1",
      planId: "RED-1",
      planDate: "2025-01-31",
      planAmount: 1167360,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 1167360,
      valid: true
    }, {
      detailId: "R2",
      planId: "RED-1",
      planDate: "2025-02-28",
      planAmount: 218880,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 218880,
      valid: true
    }, {
      detailId: "R3",
      planId: "RED-1",
      planDate: "2025-03-31",
      planAmount: 72960,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 72960,
      valid: true
    }, {
      detailId: "R4",
      planId: "RED-1",
      planDate: "2025-03-31",
      planAmount: -1459200,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: -1459200,
      redReversal: "是",
      valid: true
    }, {
      detailId: "CURRENT",
      planId: "PLAN-CURRENT",
      contractNo: "HT-1",
      planDate: "2026-07-31",
      planAmount: 1833710.36,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 1833710.36,
      valid: true
    }, {
      detailId: "BAD",
      planId: "PLAN-BAD",
      planDate: "2026-07-20",
      planAmount: null,
      receivedFlag: "2",
      receivedAmount: null,
      pendingAmount: null,
      valid: false
    }]
  }));

  assert.equal(report.metrics.invoice.monthPlan, 1833710.36);
  assert.equal(report.metrics.invoice.received, 0);
  assert.equal(report.metrics.invoice.pending, 1833710.36);
  assert.equal(report.metrics.invoice.plannedCount, 1);
  assert.equal(report.metrics.invoice.receivedCount, 0);
  assert.equal(report.metrics.invoice.receivedRate, 0);
  assert.equal(report.metrics.invoice.overdueCount, 0);
  assert.equal(report.tables.invoices.monthRows.length, 2);
  assert.equal(report.cards.invoice[0].note.count, 1);
  assert.deepEqual(report.cards.invoice[1].note, { count: 0, rate: 0 });
});

test("analytics engine keeps unmatched formal receivables but filters temporary selections", function () {
  const invoiceRows = [{
    detailId: "MATCHED",
    planId: "PLAN-1",
    projectId: "P1",
    planDate: "2026-07-01",
    planAmount: 100,
    receivedFlag: "0",
    receivedAmount: 0,
    pendingAmount: 100,
    valid: true
  }, {
    detailId: "UNMAPPED",
    planId: "PLAN-2",
    projectId: null,
    planDate: "2026-07-02",
    planAmount: 200,
    receivedFlag: "0",
    receivedAmount: 0,
    pendingAmount: 200,
    valid: true
  }];

  assert.equal(createAnalyticsEngine().buildReport(fixture({ invoiceRows })).metrics.invoice.monthPlan, 300);
  assert.equal(createAnalyticsEngine().buildReport(fixture({
    invoiceRows,
    selectedProjectIds: ["P1"]
  })).metrics.invoice.monthPlan, 100);
});

test("analytics engine marks the receipt rate unavailable for a non-positive monthly plan", function () {
  const report = createAnalyticsEngine().buildReport(fixture({
    invoiceRows: [{
      detailId: "R1",
      planId: "RED-1",
      planDate: "2026-07-01",
      planAmount: 100,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: 100,
      valid: true
    }, {
      detailId: "R2",
      planId: "RED-1",
      planDate: "2026-07-02",
      planAmount: -100,
      receivedFlag: "0",
      receivedAmount: 0,
      pendingAmount: -100,
      valid: true
    }]
  }));

  assert.equal(report.metrics.invoice.monthPlan, 0);
  assert.equal(report.metrics.invoice.plannedCount, 0);
  assert.equal(report.metrics.invoice.receivedRate, null);
});
