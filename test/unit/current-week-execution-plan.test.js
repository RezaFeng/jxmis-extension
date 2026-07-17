import assert from "node:assert/strict";
import test from "node:test";
import * as currentWeekPlan from "../../src/page/batch-work/current-week-execution-plan.js";

function actualTime(overrides) {
  return Object.assign(
    {
      value: "8",
      source: "dailyActual",
      dailyRealHour: "8",
      matchedDailyRows: 2
    },
    overrides || {}
  );
}

function finishRate(overrides) {
  return Object.assign(
    {
      value: "100",
      source: "dailyActual",
      dailyFinishRate: "100",
      latestDailyDate: "2026-07-03"
    },
    overrides || {}
  );
}

function realEndTime(overrides) {
  return Object.assign(
    {
      value: "2026-07-03 17:30:00",
      source: "dailyActual",
      dailyEndTime: "2026-07-03 17:30:00",
      latestDailyDate: "2026-07-03"
    },
    overrides || {}
  );
}

test("builds unchanged row plan with skipped summary", function () {
  const rowData = {
    extName: "Current task",
    finishRate: "100",
    realEndTime: "2026-07-03 17:30:00",
    realTime: "8",
    isNeedDo: "0",
    isState: "50",
    memo: ""
  };

  const plan = currentWeekPlan.buildCurrentWeekExecutionPlan({
    rowData: rowData,
    rowNumber: 3,
    planDate: "8",
    actualTime: actualTime(),
    finishRate: finishRate(),
    realEndTime: realEndTime()
  });

  assert.equal(plan.hasChanged, false);
  assert.deepEqual(plan.nextValues, {
    finishRate: "100",
    realEndTime: "2026-07-03 17:30:00",
    realTime: "8",
    isNeedDo: "0",
    isState: "50",
    memo: ""
  });
  assert.equal(plan.summaryRow.row, 3);
  assert.equal(plan.summaryRow.extName, "Current task");
  assert.equal(plan.summaryRow.resolvedRealTime, "8");
  assert.equal(plan.summaryRow.resolvedFinishRate, "100");
  assert.equal(plan.summaryRow.resolvedRealEndTime, "2026-07-03 17:30:00");
  assert.equal(plan.summaryRow.skipped, true);
});

test("builds changed row plan with write summary", function () {
  const rowData = {
    extId: "EXT-1",
    extName: "Changed task",
    finishRate: "50",
    realEndTime: "2026-07-01 17:30:00",
    realTime: "4",
    isNeedDo: "1",
    isState: "20",
    memo: "old"
  };

  const plan = currentWeekPlan.buildCurrentWeekExecutionPlan({
    rowData: rowData,
    rowNumber: 1,
    planDate: "8",
    actualTime: actualTime(),
    finishRate: finishRate(),
    realEndTime: realEndTime()
  });

  assert.equal(plan.hasChanged, true);
  assert.equal(plan.summaryRow.extId, "EXT-1");
  assert.equal(plan.summaryRow.finishRate, "100");
  assert.equal(plan.summaryRow.realEndTime, "2026-07-03 17:30:00");
  assert.equal(plan.summaryRow.realTime, "8");
  assert.equal(plan.summaryRow.planDate, "8");
  assert.equal(plan.summaryRow.isNeedDo, "0");
  assert.equal(plan.summaryRow.isState, "50");
});

test("detects default state changes even when actual values match", function () {
  const rowData = {
    finishRate: "100",
    realEndTime: "2026-07-03 17:30:00",
    realTime: "8",
    isNeedDo: "1",
    isState: "50",
    memo: ""
  };

  const plan = currentWeekPlan.buildCurrentWeekExecutionPlan({
    rowData: rowData,
    rowNumber: 2,
    actualTime: actualTime(),
    finishRate: finishRate(),
    realEndTime: realEndTime()
  });

  assert.equal(plan.hasChanged, true);
  assert.equal(plan.nextValues.isNeedDo, "0");
});

test("keeps fallback metadata defaults in summary rows", function () {
  const plan = currentWeekPlan.buildCurrentWeekExecutionPlan({
    rowData: {
      extName: "Fallback task",
      finishRate: "100",
      realEndTime: "2026-07-03 17:30:00",
      realTime: "8",
      isNeedDo: "0",
      isState: "50",
      memo: ""
    },
    rowNumber: 4,
    actualTime: actualTime({
      reason: "noMatch",
      dailyRealHour: "",
      matchedDailyRows: 0
    }),
    finishRate: finishRate({
      reason: "noRate",
      dailyFinishRate: "",
      latestDailyDate: ""
    }),
    realEndTime: realEndTime({
      reason: "noEndTime",
      dailyEndTime: "",
      latestDailyDate: ""
    })
  });

  assert.equal(plan.summaryRow.realTimeFallbackReason, "noMatch");
  assert.equal(plan.summaryRow.dailyRealHour, "");
  assert.equal(plan.summaryRow.matchedDailyRows, 0);
  assert.equal(plan.summaryRow.finishRateFallbackReason, "noRate");
  assert.equal(plan.summaryRow.realEndTimeFallbackReason, "noEndTime");
});
