import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateWeeklyReports,
  normalizeWeeklyReportDetail,
  parseWeeklyRange,
  selectWeeklyReports,
  splitWeeklyReportsByRange,
  weeklyReportApplies
} from "../../src/page/business-analytics/weekly-reports.js";

test("analytics weekly reports parse list and explicit detail periods", function () {
  assert.deepEqual(parseWeeklyRange("2026-06-29 ~ 2026-07-05"), {
    startDate: "2026-06-29",
    endDate: "2026-07-05"
  });
  const report = normalizeWeeklyReportDetail({
    data: {
      wkId: "W1",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
      currWkResult: "完成上线",
      nextWkPlan: "准备验收",
      nextExecutions: [{ wbsId: "B1", planHour: 8 }]
    }
  });
  assert.equal(report.summary, "完成上线");
  assert.equal(report.nextExecutions.length, 1);
});

test("analytics weekly reports split one fetch into current and previous periods", function () {
  const rows = [
    {
      wkId: "W1",
      startDate: "2026-06-29",
      endDate: "2026-07-05",
      currentExecutions: [],
      nextExecutions: [{ planHour: 8 }]
    },
    {
      wkId: "W2",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
      currentExecutions: [],
      nextExecutions: [{ planHour: 16 }]
    }
  ];
  const result = splitWeeklyReportsByRange(
    { status: "success", rows },
    { startDate: "2026-07-06", endDate: "2026-07-12" },
    { startDate: "2026-06-29", endDate: "2026-07-05" }
  );
  assert.deepEqual(result.current.rows.map(function (item) { return item.wkId; }), ["W2"]);
  assert.deepEqual(result.previous.rows.map(function (item) { return item.wkId; }), ["W1"]);
  assert.equal(result.current.aggregate.nextExecutions[0].planHour, 16);
  assert.equal(result.previous.aggregate.nextExecutions[0].planHour, 8);
});

test("analytics weekly reports select all intersections and latest period version", function () {
  const details = [{ wkId: "W1", startDate: "2026-06-29", endDate: "2026-07-05", updatedAt: "2026-07-05 10:00:00" },
    { wkId: "W2-old", startDate: "2026-07-06", endDate: "2026-07-12", updatedAt: "2026-07-12 09:00:00" },
    { wkId: "W2", startDate: "2026-07-06", endDate: "2026-07-12", updatedAt: "2026-07-12 11:00:00" },
    { wkId: "W3", startDate: "2026-07-13", endDate: "2026-07-19", updatedAt: "2026-07-19 10:00:00" }];
  const selected = selectWeeklyReports(details, { startDate: "2026-07-03", endDate: "2026-07-10" });
  assert.deepEqual(selected.reports.map(function (item) { return item.wkId; }), ["W1", "W2"]);
  assert.deepEqual(selected.replacedIds, ["W2-old"]);
});

test("analytics weekly reports honor applicability", function () {
  assert.equal(weeklyReportApplies({ isCreateWkReport: "否" }), false);
  assert.equal(weeklyReportApplies({ isCreateWkReport: "1" }), true);
  assert.equal(weeklyReportApplies({}), true);
});

test("analytics weekly reports group summaries and deduplicate execution rows", function () {
  const reports = [{
    wkId: "W1", startDate: "2026-07-01", endDate: "2026-07-07", summary: "第一周", nextPlan: "计划一",
    projectId: "P1", currentExecutions: [], nextExecutions: [{ wbsId: "B1", personId: "U1", planDate: "2026-07-08", planHour: 8 }]
  }, {
    wkId: "W2", startDate: "2026-07-08", endDate: "2026-07-14", summary: "第二周", nextPlan: "计划二",
    projectId: "P1", currentExecutions: [], nextExecutions: [{ wbsId: "B1", personId: "U1", planDate: "2026-07-08", planHour: 8 }]
  }];
  const result = aggregateWeeklyReports(reports);
  assert.deepEqual(result.summaries.map(function (item) { return item.summary; }), ["第一周", "第二周"]);
  assert.equal(result.nextExecutions.length, 1);
});
