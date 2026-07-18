import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  getChinaCalendarDate,
  getDefaultDateRange,
  getEndMonthRange,
  getNextDateRange,
  getPreviousDateRange,
  isNaturalWeek,
  rangesIntersect
} from "../../src/analytics/date-range.js";
import {
  calculateCumulativeMetrics,
  calculateInputMetrics,
  calculateProjectMetrics,
  calculateWbsMetrics,
  isActiveProject
} from "../../src/analytics/formulas.js";

test("date range uses China time and the most recent complete natural week", function () {
  assert.equal(getChinaCalendarDate(new Date("2026-07-12T16:30:00Z")), "2026-07-13");
  assert.deepEqual(getDefaultDateRange(new Date("2026-07-13T00:00:00+08:00")), {
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  });
  assert.deepEqual(getDefaultDateRange(new Date("2026-07-18T12:00:00+08:00")), {
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  });
});

test("date range supports arbitrary cross-month periods and adjacent comparisons", function () {
  const range = { startDate: "2026-01-29", endDate: "2026-02-03" };
  assert.deepEqual(getPreviousDateRange(range), {
    startDate: "2026-01-23",
    endDate: "2026-01-28"
  });
  assert.deepEqual(getNextDateRange(range), {
    startDate: "2026-02-04",
    endDate: "2026-02-09"
  });
  assert.deepEqual(getEndMonthRange(range), {
    startDate: "2026-02-01",
    endDate: "2026-02-28"
  });
  assert.equal(isNaturalWeek({ startDate: "2026-07-06", endDate: "2026-07-12" }), true);
  assert.equal(isNaturalWeek(range), false);
  assert.equal(rangesIntersect(range, { startDate: "2026-02-03", endDate: "2026-02-10" }), true);
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
});

test("analytics formulas calculate project cumulative values", function () {
  const row = calculateProjectMetrics({
    projectId: "P1",
    subcontractAmount: 1000,
    estiExeuCost: 500,
    realExeuCost: 200,
    realWorkload: 261,
    planCompleteSchedule: 50
  });
  assert.equal(row.cr, 500);
  assert.equal(row.ev, 250);
  assert.equal(row.cpi, 1.25);
  assert.equal(row.ccpi, 2.5);
  assert.equal(row.eac, 400);
  assert.equal(row.perCapita, 500);
  assert.equal(row.remainingBudget, 300);
});

test("analytics formulas aggregate raw values before calculating ratios", function () {
  const metrics = calculateCumulativeMetrics([
    {
      projectId: "P1",
      subcontractAmount: 1000,
      estiExeuCost: 100,
      realExeuCost: 100,
      realWorkload: 100,
      planCompleteSchedule: 100
    },
    {
      projectId: "P2",
      subcontractAmount: 1000,
      estiExeuCost: 900,
      realExeuCost: 300,
      realWorkload: 161,
      planCompleteSchedule: 50
    }
  ]);
  assert.equal(metrics.ev, 550);
  assert.equal(metrics.ac, 400);
  assert.equal(metrics.cpi, 1.375);
  assert.equal(metrics.personYears, 1);
  assert.equal(metrics.perCapita, 1500);
});

test("analytics formulas keep unknown and zero denominators distinct", function () {
  const unknown = calculateCumulativeMetrics([{
    subcontractAmount: 100,
    estiExeuCost: 100,
    realExeuCost: null,
    realWorkload: 0,
    planCompleteSchedule: 0
  }]);
  assert.equal(unknown.ac, null);
  assert.equal(unknown.cpi, null);
  assert.equal(unknown.perCapita, null);
  assert.equal(calculateProjectMetrics({
    subcontractAmount: 100,
    estiExeuCost: 100,
    realExeuCost: 0,
    realWorkload: 0,
    planCompleteSchedule: 0
  }).eac, null);
});

test("analytics formulas enforce WBS historical cutoff", function () {
  const metrics = calculateWbsMetrics([
    { costLevel: 10, planEndTime: "2026-07-03", actualEndTime: "2026-07-05" },
    { costLevel: 20, planEndTime: "2026-07-08", actualEndTime: "2026-07-10" },
    { costLevel: 30, planEndTime: "2026-07-11", actualEndTime: "2026-07-20" },
    { costLevel: 40, planEndTime: "2026-08-01", actualEndTime: "2026-08-01" }
  ], { startDate: "2026-07-06", endDate: "2026-07-12" });
  assert.equal(metrics.monthPV, 60);
  assert.equal(metrics.monthEV, 30);
  assert.equal(metrics.periodPV, 50);
  assert.equal(metrics.periodEV, 20);
  assert.equal(metrics.cumulativePV, 60);
  assert.equal(metrics.cumulativeEV, 30);
  assert.equal(metrics.totalSPI, 0.5);
});

test("analytics formulas calculate interval input without cost fallback", function () {
  const metrics = calculateInputMetrics({
    startDate: "2026-07-06",
    endDate: "2026-07-12",
    dailyRows: [{ realHour: 8, cost: 100 }, { realHour: 4, cost: 50 }],
    previousDailyRows: [{ realHour: 8, cost: 100 }],
    wbsRows: [{ costLevel: 200, planEndTime: "2026-07-08", actualEndTime: "2026-07-09" }],
    projects: [{ subcontractAmount: 1000, estiExeuCost: 500 }],
    nextPeriodPlannedHours: 24
  });
  assert.equal(metrics.inputMd, 1.5);
  assert.equal(metrics.inputCost, 150);
  assert.equal(metrics.inputDelta, 0.5);
  assert.equal(metrics.costDelta, 0.5);
  assert.equal(metrics.serviceEV, 400);
  assert.equal(metrics.periodCPI, 200 / 150);
  assert.equal(metrics.periodCCPI, 400 / 150);
  assert.equal(metrics.nextPeriodPlannedMd, 3);
  assert.equal(metrics.burnRatePerDay, 150 / 7);
  assert.equal(isActiveProject(0, 2), true);
  assert.equal(isActiveProject(0, 0), false);
});
