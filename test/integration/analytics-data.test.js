import assert from "node:assert/strict";
import test from "node:test";
import {
  createJxpmoAnalyticsData,
  fetchAllAnalyticsPages
} from "../../src/page/business-analytics/jxpmo-data.js";

test("analytics data completes project pagination without a fixed cap", async function () {
  const offsets = [];
  const rows = await fetchAllAnalyticsPages(async function ({ offset, pageSize }) {
    offsets.push(offset);
    return {
      recordsTotal: 5,
      rows: Array.from({ length: Math.min(pageSize, 5 - offset) }, function (_, index) {
        return { id: offset + index };
      })
    };
  }, { pageSize: 2 });
  assert.deepEqual(offsets, [0, 2, 4]);
  assert.equal(rows.length, 5);
});

test("analytics data reports incomplete pagination", async function () {
  await assert.rejects(fetchAllAnalyticsPages(async function ({ offset }) {
    return { recordsTotal: 5, rows: offset === 0 ? [{ id: 1 }] : [] };
  }, { pageSize: 2 }), /ended before recordsTotal/);
});

test("analytics data paginates to a short page when totals are absent", async function () {
  const offsets = [];
  const rows = await fetchAllAnalyticsPages(async function ({ offset }) {
    offsets.push(offset);
    return { rows: offset < 4 ? [{ id: offset }, { id: offset + 1 }] : [{ id: offset }] };
  }, { pageSize: 2 });
  assert.deepEqual(offsets, [0, 2, 4]);
  assert.equal(rows.length, 5);
});

test("analytics data uses same-origin endpoints and normalizes all project pages", async function () {
  const requests = [];
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    pageSize: 2,
    fetch: async function (url, options) {
      requests.push({ url, options });
      if (url.includes("unitTree")) {
        return { ok: true, json: async function () { return [{ id: "2", text: "交付部", attributes: { privLevel: "2" } }]; } };
      }
      const start = Number(new URL(url).searchParams.get("start"));
      const raw = [0, 1, 2].slice(start, start + 2).map(function (index) {
        return {
          projectId: "P" + index,
          projectName: "项目" + index,
          projectDept: "2",
          classification: "J",
          currStatus: "20",
          subcontractAmount: index === 0 ? "100" : index === 1 ? null : undefined,
          tqSoftAmount: index === 0 ? "900" : index === 1 ? "200" : undefined
        };
      });
      return { ok: true, json: async function () { return { recordsTotal: 3, rows: raw }; } };
    }
  });
  assert.equal((await data.fetchDepartments()).length, 1);
  const projects = await data.fetchProjects();
  assert.equal(projects.length, 3);
  assert.deepEqual(projects.map(function (project) { return project.subcontractAmount; }), [100, 200, 0]);
  requests.forEach(function (request) {
    assert.equal(request.options.credentials, "same-origin");
  });
  const projectUrls = requests.filter(function (request) { return request.url.includes("ProjectInfoService"); });
  assert.equal(projectUrls.length, 2);
  assert.equal(projectUrls.some(function (request) { return request.url.includes("likeAll"); }), false);
  assert.equal(projectUrls.some(function (request) { return request.url.includes("projectDept"); }), false);
});

test("analytics data plans project requests from status and outsourcing only", async function () {
  const urls = [];
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function (url) {
      urls.push(url);
      const query = new URL(url).searchParams;
      const currStatus = query.get("currStatus");
      const outsourcing = query.get("outsourcing");
      return {
        ok: true,
        json: async function () {
          return {
            recordsTotal: 2,
            rows: ["J", "R"].map(function (classification) {
              return {
                projectId: [currStatus, outsourcing, classification].join("-"),
                projectName: "项目",
                projectDept: "D1",
                attribute: "C",
                classification,
                currStatus,
                outsourcing
              };
            })
          };
        }
      };
    }
  });
  const projects = await data.fetchProjects({
    attribute: ["C"],
    classification: ["J"],
    currStatus: ["20", "50"],
    outsourcing: ["01", "02"],
    onlyCurrentPeriodInput: true
  });
  assert.equal(urls.length, 4);
  assert.equal(projects.length, 4);
  urls.forEach(function (url) {
    const query = new URL(url).searchParams;
    assert.ok(["20", "50"].includes(query.get("currStatus")));
    assert.ok(["01", "02"].includes(query.get("outsourcing")));
    assert.equal(query.get("attribute"), null);
    assert.equal(query.get("classification"), null);
    assert.equal(query.get("length"), "2000");
    assert.equal(query.get("rows"), "2000");
  });
});

test("analytics data skips projects without a department", async function () {
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function () {
      return {
        ok: true,
        json: async function () {
          return {
            recordsTotal: 3,
            rows: [
              { projectId: "P1", projectName: "有效项目", projectDept: "D1" },
              { projectId: "P2", projectName: "缺失部门项目" },
              { projectId: "P3", projectName: "空白部门项目", projectDept: "  " }
            ]
          };
        }
      };
    }
  });

  const projects = await data.fetchProjects();
  assert.deepEqual(projects.map(function (project) { return project.projectId; }), ["P1"]);
});

test("analytics data normalizes daily date, hours and blank cost", async function () {
  let invalidCost = false;
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function () {
      return {
        ok: true,
        json: async function () {
          return { recordsTotal: 1, rows: [{ projectId: "P1", realEndTime: "20260708", realHour: "8", cost: invalidCost ? null : "120.5" }] };
        }
      };
    }
  });
  const result = await data.fetchDailyRows("2026-07-06", "2026-07-12");
  assert.equal(result.status, "success");
  assert.deepEqual(result.rows[0], { projectId: "P1", taskDate: "2026-07-08", realHour: 8, cost: 120.5 });
  invalidCost = true;
  assert.equal((await data.fetchDailyRows("2026-07-06", "2026-07-12")).rows[0].cost, 0);
});

test("analytics data normalizes the live task detail date schema", async function () {
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function () {
      return {
        ok: true,
        json: async function () {
          return {
            recordsTotal: 3,
            rows: [
              {
                projectId: "P1",
                realEndTime: "2026-07-18 20:12:00",
                submissionTime: "2026-07-19 08:15:00",
                createTime: "2026-07-17 19:30:00",
                realHour: 8,
                cost: 880
              },
              {
                projectId: "P2",
                realEndTime: "",
                submissionTime: "2026-07-19 08:15:00",
                createTime: "2026-07-17 19:30:00",
                realHour: 4,
                cost: 440
              },
              {
                projectId: "P3",
                realEndTime: null,
                submissionTime: null,
                createTime: "2026-07-17 19:30:00",
                realHour: 2,
                cost: 220
              }
            ]
          };
        }
      };
    }
  });
  assert.deepEqual((await data.fetchDailyRows("2026-07-17", "2026-07-19")).rows, [
    { projectId: "P1", taskDate: "2026-07-18", realHour: 8, cost: 880 },
    { projectId: "P2", taskDate: "2026-07-19", realHour: 4, cost: 440 },
    { projectId: "P3", taskDate: "2026-07-17", realHour: 2, cost: 220 }
  ]);
});

test("analytics data distinguishes empty WBS and normalizes milestone completion", async function () {
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function (url) {
      const query = new URL(url).searchParams;
      if (query.get("queryName") === "queryLandmark") {
        assert.equal(query.get("refCols"), "default");
        return { ok: true, json: async function () { return { rows: [{
          detailId: "M1",
          detailName: "上线",
          planEndTime: "2026-07-12 00:00:00",
          realEndTime: null,
          confirmStatus: 2
        }, {
          detailId: "M2",
          detailName: "验收",
          planEndTime: "2026-07-10 00:00:00",
          realEndTime: "2026-07-16 00:00:00",
          restReason: " 确认 ",
          confirmStatus: 1,
          finishStatus: "10"
        }, {
          detailId: "M3",
          detailName: "发布",
          planEndTime: "2026-07-09 00:00:00",
          realEndTime: "2026-07-17 00:00:00",
          restReason: "未确认",
          confirmStatus: 1,
          finishStatus: "50"
        }] }; } };
      }
      assert.equal(query.get("max1"), "P1");
      assert.equal(query.get("planId1"), "P1");
      assert.equal(query.get("startTime"), "2026-07-06");
      assert.equal(query.get("endTime"), "2026-07-12");
      return {
        ok: true,
        json: async function () {
          return { rows: [{ detailId: "W0", costLevel: null, planEndTime: "2026-07-12" }] };
        }
      };
    }
  });
  assert.deepEqual(await data.fetchWbs("P1", { startDate: "2026-07-06", endDate: "2026-07-12" }), {
    status: "success",
    rows: [{
      detailId: "W0",
      detailName: null,
      costLevel: 0,
      planEndTime: "2026-07-12",
      actualEndTime: null
    }]
  });
  const milestones = await data.fetchMilestones("P1");
  assert.equal(milestones.status, "success");
  assert.deepEqual(milestones.rows[0], {
    milestoneId: "M1",
    nodeName: "上线",
    planEndTime: "2026-07-12",
    actualEndTime: null,
    confirmStatus: "2",
    restReason: null,
    completed: true
  });
  assert.deepEqual(milestones.rows[1], {
    milestoneId: "M2",
    nodeName: "验收",
    planEndTime: "2026-07-10",
    actualEndTime: "2026-07-16",
    confirmStatus: "1",
    restReason: "确认",
    completed: true
  });
  assert.equal(milestones.rows[2].completed, false);
});

test("analytics data identifies redirected HTML sessions", async function () {
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function () {
      return {
        ok: true,
        status: 200,
        redirected: true,
        url: "https://jxmis.example.com/jxpmo/login",
        headers: { get: function () { return "text/html"; } }
      };
    }
  });
  await assert.rejects(data.fetchDepartments(), /SESSION_EXPIRED/);
});

test("analytics data fetches cross-year receivables once per scope without legacy parameters", async function () {
  const urls = [];
  const rawRows = [{
    detailId: "D1",
    planId: "PLAN-1",
    contractNum: "HT-1",
    planRecDate: "2025-03-31",
    invoiceAmount: -100,
    recFlag: "0",
    redReversal: "是"
  }, {
    detailId: "D2",
    planId: "PLAN-2",
    contractNum: "HT-2",
    planRecDate: "2026-07-31",
    realRecDate: "2026-07-20",
    invoiceAmount: 200,
    recFlag: "1",
    recAmount: 200
  }, {
    detailId: "D3",
    planId: "PLAN-3",
    contractNum: "NONE",
    planRecDate: "2027-01-31",
    invoiceAmount: 300,
    recFlag: "0"
  }];
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    pageSize: 2,
    fetch: async function (url) {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get("start"));
      return {
        ok: true,
        json: async function () {
          return { recordsTotal: rawRows.length, rows: rawRows.slice(start, start + 2) };
        }
      };
    }
  });
  const projects = [{
    projectId: "P1",
    projectNo: "JX-1",
    projectName: "项目一",
    projectManagerName: "经理甲",
    contractNo: "HT-1,HT-2"
  }];

  const scoped = await data.fetchReceivables("D1", projects);
  assert.equal(scoped.status, "success");
  assert.equal(scoped.rows.length, 3);
  assert.deepEqual(scoped.rows.slice(0, 2).map(function (row) { return row.projectId; }), ["P1", "P1"]);
  assert.equal(scoped.rows[0].pendingAmount, -100);
  assert.equal(scoped.diagnostics.unmappedCount, 1);
  const scopedUrls = urls.splice(0);
  assert.equal(scopedUrls.length, 2);
  scopedUrls.forEach(function (url) {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/jxpmo/rest/contract/queryInvoicePlanDetailService/query");
    assert.equal(parsed.searchParams.get("saleDept"), "D1");
    assert.equal(parsed.searchParams.get("planRecYear"), null);
    assert.equal(parsed.searchParams.get("meetDateYear"), "undefined");
    assert.equal(parsed.searchParams.get("likeAll_"), "1");
  });

  await data.fetchReceivables("all", projects);
  urls.forEach(function (url) {
    assert.equal(new URL(url).searchParams.get("saleDept"), null);
  });
});
