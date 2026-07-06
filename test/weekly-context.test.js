const test = require("node:test");
const assert = require("node:assert/strict");

const weeklyContext = require("../weekly-context");
const weeklyDetail = require("../weekly-detail");

function fakeDocument(elements) {
  return {
    querySelector: function (selector) {
      return elements[selector] || null;
    }
  };
}

function createAdapter(overrides) {
  const calls = [];
  const adapter = Object.assign(
    {
      document: fakeDocument({}),
      location: {
        href: "https://jxmis.cyberwing.cn/jxpmo/project/WkReportService/id/WK-1",
        hash: ""
      },
      now: new Date(2026, 6, 1),
      getBaseUrl: function () {
        return "https://jxmis.cyberwing.cn/jxpmo";
      },
      fetchJson: async function (url, label) {
        calls.push({ url: url, label: label });
        if (url.indexOf("queryByProjectInfosService") >= 0) {
          return {
            data: {
              wkId: "WK-1",
              projectId: "P-1",
              projectName: "行项目",
              prodPerson: "U-1",
              prodPersonName: "产品",
              projectManager: "PM-1",
              projectManagerName: "经理",
              weekDate: "2026-06-29 - 2026-07-05"
            }
          };
        }
        return {
          pageCount: 1,
          rows: []
        };
      },
      normalizeWeeklyDetail: weeklyDetail.normalizeWeeklyDetail
    },
    overrides || {}
  );
  adapter.calls = calls;
  return adapter;
}

test("normalizes Sunday-Saturday week range to Monday-Sunday", function () {
  const range = weeklyContext.normalizeWeekRange("2026-06-28 - 2026-07-04");

  assert.equal(weeklyContext.formatDate(range.start), "2026-06-29");
  assert.equal(weeklyContext.formatDate(range.end), "2026-07-05");
});

test("normalizes a date inside week to Monday-Sunday range", function () {
  const range = weeklyContext.normalizeWeekRange("2026-07-01");

  assert.equal(weeklyContext.formatDate(range.start), "2026-06-29");
  assert.equal(weeklyContext.formatDate(range.end), "2026-07-05");
});

test("reads first non-empty control value by name id or data-name", function () {
  const documentRef = fakeDocument({
    "[name='wkId']": { value: "   " },
    "#wkId": { textContent: "WK-ID" },
    "[data-name='projectId']": { value: "P-1" }
  });

  assert.equal(weeklyContext.readControlValue(documentRef, ["wkId"]), "WK-ID");
  assert.equal(weeklyContext.readControlValue(documentRef, ["projectId"]), "P-1");
  assert.equal(weeklyContext.readControlValue(documentRef, ["missing"]), "");
});

test("parses weekly id from location href or hash", function () {
  assert.equal(
    weeklyContext.parseWkIdFromLocation({
      href: "https://host/jxpmo/project/WkReportService/id/WK%201",
      hash: ""
    }),
    "WK 1"
  );
  assert.equal(
    weeklyContext.parseWkIdFromLocation({
      href: "https://host/frame",
      hash: "#/project/WkReportService/id/WK-2"
    }),
    "WK-2"
  );
});

test("creates weekly context from weekly detail row", async function () {
  const adapter = createAdapter();
  const context = await weeklyContext.getWeeklyContext(adapter);

  assert.equal(context.wkId, "WK-1");
  assert.equal(context.projectId, "P-1");
  assert.equal(context.projectName, "行项目");
  assert.equal(context.prodPerson, "U-1");
  assert.equal(context.prodPersonName, "产品");
  assert.equal(context.projectManager, "PM-1");
  assert.equal(context.projectManagerName, "经理");
  assert.equal(context.weekStart, "2026-06-29");
  assert.equal(context.weekEnd, "2026-07-05");
  assert.equal(adapter.calls.length, 1);
  assert.match(adapter.calls[0].url, /queryByProjectInfosService/);
});

test("selects project weekly row by wkId then filling status", async function () {
  const adapter = createAdapter({
    document: fakeDocument({
      "[name='projectId']": { value: "P-1" }
    }),
    location: {
      href: "https://host/frame",
      hash: "#/project/WkReportService/id/WK-2"
    },
    fetchJson: async function (url) {
      adapter.calls.push({ url: url });
      if (url.indexOf("queryByProjectInfosService") >= 0) {
        throw new Error("detail unavailable");
      }
      return {
        pageCount: 1,
        rows: [
          {
            wkId: "WK-1",
            status: "10",
            projectId: "P-1",
            projectName: "填报中",
            weekDate: "2026-06-22"
          },
          {
            wkId: "WK-2",
            status: "20",
            projectId: "P-1",
            projectName: "目标",
            weekDate: "2026-06-29"
          }
        ]
      };
    }
  });

  const context = await weeklyContext.getWeeklyContext(adapter);

  assert.equal(context.wkId, "WK-2");
  assert.equal(context.projectName, "目标");
  assert.match(adapter.calls[0].url, /queryByProjectInfosService/);
  assert.match(adapter.calls[1].url, /WkReportService\/query/);
});

test("throws when projectId cannot be resolved", async function () {
  const adapter = createAdapter({
    document: fakeDocument({}),
    location: {
      href: "https://host/frame",
      hash: ""
    },
    fetchJson: async function () {
      return {
        rows: []
      };
    }
  });

  await assert.rejects(
    function () {
      return weeklyContext.getWeeklyContext(adapter);
    },
    /未找到当前项目 projectId/
  );
});
