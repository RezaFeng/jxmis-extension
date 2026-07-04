const test = require("node:test");
const assert = require("node:assert/strict");
const wbsPlan = require("../wbs-plan");

function context(overrides) {
  return Object.assign(
    {
      wkId: "WK-1",
      projectId: "P-1",
      projectName: "测试项目",
      prodPerson: "U-CREATOR",
      prodPersonName: "创建人",
      startDate: wbsPlan.parseDate("2026-06-29")
    },
    overrides || {}
  );
}

test("builds next execution rows from WBS input", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-1",
        detailName: "开发任务",
        roleId: "U-1",
        roleName: "张三",
        duration: "2",
        planStartTime: "2026-07-06",
        planEndTime: "2026-07-07"
      }
    ],
    [],
    context(),
    nextWeek
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].wbsId, "WBS-1");
  assert.equal(rows[0].extName, "开发任务");
  assert.equal(rows[0].majorPerson, "U-1");
  assert.equal(rows[0].majorPersonName, "张三");
  assert.equal(rows[0].planDate, "16");
  assert.equal(rows[0].planEndTime, "2026-07-12 17:30:00");
});

test("resolves next week workdays with China holiday overrides", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context({
    startDate: wbsPlan.parseDate("2026-09-14")
  }));

  assert.equal(nextWeek.startText, "2026-09-21");
  assert.equal(nextWeek.endText, "2026-09-27");
  assert.equal(nextWeek.hasHolidayTable, true);
  assert.deepEqual(nextWeek.workdays.map(wbsPlan.formatDate), [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24"
  ]);
});

test("skips WBS rows outside next week", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-OUT",
        detailName: "范围外任务",
        roleId: "U-1",
        roleName: "张三",
        duration: "1",
        planStartTime: "2026-07-13",
        planEndTime: "2026-07-14"
      }
    ],
    [],
    context(),
    nextWeek
  );

  assert.equal(rows.length, 0);
});

test("leaves person fields empty for tentative owner", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-TBD",
        detailName: "待定任务",
        roleId: "U-TBD",
        roleName: "待定",
        duration: "1",
        planStartTime: "2026-07-06",
        planEndTime: "2026-07-06"
      }
    ],
    [],
    context(),
    nextWeek
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].majorPerson, "");
  assert.equal(rows[0].majorPersonName, "");
  assert.equal(rows[0].planDate, "8");
});

test("skips rows without owner and duration", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-NONE",
        detailName: "无人无工期",
        roleId: "",
        roleName: "",
        duration: "",
        planStartTime: "2026-07-06",
        planEndTime: "2026-07-06"
      }
    ],
    [],
    context(),
    nextWeek
  );

  assert.equal(rows.length, 0);
});

test("creates manual-person row when duration exists but owner is missing", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-MANUAL",
        detailName: "手工补人员任务",
        roleId: "",
        roleName: "",
        duration: "1",
        planStartTime: "2026-07-06",
        planEndTime: "2026-07-06"
      }
    ],
    [],
    context(),
    nextWeek
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].majorPerson, "");
  assert.equal(rows[0].majorPersonName, "");
  assert.equal(rows[0].planDate, "");
});

test("splits assignable hours into 24 hour chunks", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-LONG",
        detailName: "长任务",
        roleId: "U-1",
        roleName: "张三",
        duration: "5",
        planStartTime: "2026-07-06",
        planEndTime: "2026-07-10"
      }
    ],
    [],
    context(),
    nextWeek
  );

  assert.deepEqual(rows.map(function (row) {
    return row.planDate;
  }), ["24", "16"]);
});

test("deduplicates existing next-week execution rows", function () {
  const nextWeek = wbsPlan.getNextWeekInfo(context());
  const rows = wbsPlan.buildNextExecutionRows(
    [
      {
        detailId: "WBS-DUP",
        detailName: "重复任务",
        roleId: "U-1",
        roleName: "张三",
        duration: "1",
        planStartTime: "2026-07-06",
        planEndTime: "2026-07-06"
      }
    ],
    [
      {
        majorPerson: "U-1",
        wbsId: "WBS-DUP",
        extName: "重复任务",
        planDate: "8"
      }
    ],
    context(),
    nextWeek
  );

  assert.equal(rows.length, 0);
});
