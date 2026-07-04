const test = require("node:test");
const assert = require("node:assert/strict");
const dailyActual = require("../daily-actual");

function context() {
  return {
    startDate: dailyActual.parseDate("2026-07-06"),
    endDate: dailyActual.parseDate("2026-07-12")
  };
}

function collectDailyRows(rows) {
  const result = [];
  const stats = dailyActual.createDailyActualStats();
  dailyActual.appendDailyActualRows(rows, context(), new Set(), result, stats);
  return {
    rows: result,
    stats: stats
  };
}

function weeklyRow(overrides) {
  return Object.assign(
    {
      majorPerson: "U-1",
      majorPersonName: "张三",
      wbsId: "WBS-1",
      wbsName: "开发任务",
      extName: "开发任务",
      taskName: ""
    },
    overrides || {}
  );
}

function dailyRow(overrides) {
  return Object.assign(
    {
      taskOwner: "U-1",
      userFullname: "张三",
      wbsId: "WBS-1",
      taskName: "开发任务",
      realHour: "4",
      realFinishRate: "60%",
      submissionTime: "2026-07-06 18:00:00",
      newstauts: "审核通过",
      taskId: "D-1"
    },
    overrides || {}
  );
}

test("matches by WBS and person and aggregates realHour", function () {
  const daily = collectDailyRows([
    dailyRow({ realHour: "4", taskId: "D-1" }),
    dailyRow({ realHour: "3.5", taskId: "D-2", submissionTime: "2026-07-07 18:00:00" })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weeklyRow()]);
  const actual = dailyActual.resolveDailyActualHours(weeklyRow(), "8", resolver);

  assert.equal(actual.value, "7.5");
  assert.equal(actual.source, "dailyExact");
  assert.equal(actual.matchedDailyRows, 2);
});

test("falls back to task name and person when WBS is missing", function () {
  const weekly = weeklyRow({ wbsId: "", extName: "联调任务", wbsName: "" });
  const daily = collectDailyRows([
    dailyRow({
      wbsId: "",
      taskName: "联调任务",
      realHour: "6",
      taskId: "D-NAME"
    })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weekly]);
  const actual = dailyActual.resolveDailyActualHours(weekly, "8", resolver);

  assert.equal(actual.value, "6");
  assert.equal(actual.source, "dailyNameFallback");
});

test("does not name-match ambiguous weekly task/person rows", function () {
  const weeklyA = weeklyRow({ wbsId: "", extName: "同名任务", wbsName: "" });
  const weeklyB = weeklyRow({ wbsId: "", extName: "同名任务", wbsName: "" });
  const daily = collectDailyRows([
    dailyRow({
      wbsId: "",
      taskName: "同名任务",
      realHour: "5",
      taskId: "D-AMB"
    })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weeklyA, weeklyB]);
  const actual = dailyActual.resolveDailyActualHours(weeklyA, "8", resolver);

  assert.equal(actual.value, "8");
  assert.equal(actual.source, "planFallback");
  assert.equal(actual.reason, "ambiguousNameMatch");
});

test("does not consume the same WBS/person hour key twice", function () {
  const weekly = weeklyRow();
  const daily = collectDailyRows([dailyRow({ realHour: "4" })]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weekly]);
  const first = dailyActual.resolveDailyActualHours(weekly, "8", resolver);
  const second = dailyActual.resolveDailyActualHours(weekly, "8", resolver);

  assert.equal(first.value, "4");
  assert.equal(second.value, "8");
  assert.equal(second.reason, "duplicateWeeklyWbsPerson");
});

test("does not consume the same name/person hour key twice", function () {
  const weekly = weeklyRow({ wbsId: "", extName: "名称匹配任务", wbsName: "" });
  const daily = collectDailyRows([
    dailyRow({
      wbsId: "",
      taskName: "名称匹配任务",
      realHour: "4",
      taskId: "D-NAME-USED"
    })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weekly]);
  const first = dailyActual.resolveDailyActualHours(weekly, "8", resolver);
  const second = dailyActual.resolveDailyActualHours(weekly, "8", resolver);

  assert.equal(first.value, "4");
  assert.equal(second.value, "8");
  assert.equal(second.reason, "duplicateWeeklyNamePerson");
});

test("falls back to planned value when no daily row matches", function () {
  const daily = collectDailyRows([
    dailyRow({ wbsId: "OTHER", taskName: "其他任务" })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weeklyRow()]);
  const actual = dailyActual.resolveDailyActualHours(weeklyRow(), "8", resolver);

  assert.equal(actual.value, "8");
  assert.equal(actual.source, "planFallback");
  assert.equal(actual.reason, "noDailyMatch");
});

test("falls back to planned value when matched realHour is zero", function () {
  const daily = collectDailyRows([
    dailyRow({ realHour: "0" })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weeklyRow()]);
  const actual = dailyActual.resolveDailyActualHours(weeklyRow(), "8", resolver);

  assert.equal(actual.value, "8");
  assert.equal(actual.source, "planFallback");
  assert.equal(actual.reason, "matchedButNoRealHour");
  assert.equal(actual.matchedDailyRows, 1);
});

test("uses the latest valid finish rate", function () {
  const daily = collectDailyRows([
    dailyRow({ realFinishRate: "20%", submissionTime: "2026-07-06 12:00:00", taskId: "D-OLD" }),
    dailyRow({ realFinishRate: "85.5%", submissionTime: "2026-07-08 18:00:00", taskId: "D-NEW" })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weeklyRow()]);
  const finishRate = dailyActual.resolveDailyFinishRate(weeklyRow(), resolver);

  assert.equal(finishRate.value, "85.5");
  assert.equal(finishRate.source, "dailyExact");
  assert.equal(finishRate.latestDailyDate, "2026-07-08");
});

test("uses the latest valid daily end time", function () {
  const daily = collectDailyRows([
    dailyRow({ submissionTime: "2026-07-06 12:00:00", taskId: "D-OLD" }),
    dailyRow({ submissionTime: "2026-07-09 19:30:00", taskId: "D-NEW" })
  ]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weeklyRow()]);
  const endTime = dailyActual.resolveDailyRealEndTime(weeklyRow(), "2026-07-10 17:30:00", resolver);

  assert.equal(endTime.value, "2026-07-09 19:30:00");
  assert.equal(endTime.source, "dailyExact");
  assert.equal(endTime.latestDailyDate, "2026-07-09");
});

test("falls back when weekly person is missing", function () {
  const weekly = weeklyRow({ majorPerson: "", majorPersonName: "" });
  const daily = collectDailyRows([dailyRow()]);
  const resolver = dailyActual.createDailyActualResolver(daily.rows, [weekly]);
  const actual = dailyActual.resolveDailyActualHours(weekly, "8", resolver);
  const finishRate = dailyActual.resolveDailyFinishRate(weekly, resolver);
  const endTime = dailyActual.resolveDailyRealEndTime(weekly, "2026-07-10 17:30:00", resolver);

  assert.equal(actual.value, "8");
  assert.equal(actual.reason, "weeklyPersonMissing");
  assert.equal(finishRate.value, "100");
  assert.equal(finishRate.reason, "weeklyPersonMissing");
  assert.equal(endTime.value, "2026-07-10 17:30:00");
  assert.equal(endTime.reason, "weeklyPersonMissing");
});

test("normalizes daily rows and skips unusable rows", function () {
  const daily = collectDailyRows([
    dailyRow({ taskId: "OK" }),
    dailyRow({ taskId: "OUTSIDE", submissionTime: "2026-07-20 09:00:00" }),
    dailyRow({ taskId: "PENDING", newstauts: "待审核" }),
    dailyRow({ taskId: "OK" })
  ]);

  assert.equal(daily.rows.length, 1);
  assert.equal(daily.stats.scanned, 4);
  assert.equal(daily.stats.usable, 1);
  assert.equal(daily.stats.outsideWeek, 1);
  assert.equal(daily.stats.skippedNotApproved, 1);
  assert.equal(daily.stats.duplicate, 1);
});
