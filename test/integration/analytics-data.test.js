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
          subcontractAmount: "100"
        };
      });
      return { ok: true, json: async function () { return { recordsTotal: 3, rows: raw }; } };
    }
  });
  assert.equal((await data.fetchDepartments()).length, 1);
  const projects = await data.fetchProjects();
  assert.equal(projects.length, 3);
  assert.equal(projects[0].subcontractAmount, 100);
  requests.forEach(function (request) {
    assert.equal(request.options.credentials, "same-origin");
  });
  const projectUrls = requests.filter(function (request) { return request.url.includes("ProjectInfoService"); });
  assert.equal(projectUrls.length, 2);
  assert.equal(projectUrls.some(function (request) { return request.url.includes("likeAll"); }), false);
  assert.equal(projectUrls.some(function (request) { return request.url.includes("projectDept"); }), false);
});

test("analytics data requires daily cost and normalizes date and hours", async function () {
  let invalidCost = false;
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function () {
      return {
        ok: true,
        json: async function () {
          return { recordsTotal: 1, rows: [{ projectId: "P1", costTime: "20260708", realHour: "8", cost: invalidCost ? null : "120.5" }] };
        }
      };
    }
  });
  const result = await data.fetchDailyRows("2026-07-06", "2026-07-12");
  assert.equal(result.status, "success");
  assert.deepEqual(result.rows[0], { projectId: "P1", taskDate: "2026-07-08", realHour: 8, cost: 120.5 });
  invalidCost = true;
  await assert.rejects(data.fetchDailyRows("2026-07-06", "2026-07-12"), /daily.cost: is required/);
});

test("analytics data distinguishes empty WBS and normalizes milestone completion", async function () {
  const data = createJxpmoAnalyticsData({
    location: { origin: "https://jxmis.example.com" },
    storage: { getItem: function () { return "/jxpmo"; } },
    fetch: async function (url) {
      const query = new URL(url).searchParams;
      if (query.get("queryName") === "queryLandmark") {
        return { ok: true, json: async function () { return { rows: [{ detailId: "M1", detailName: "上线", planEndTime: "2026-07-12 00:00:00", realEndTime: "2026-07-11", confirmStatus: 2 }] }; } };
      }
      return { ok: true, json: async function () { return { rows: [{ detailId: "W0", costLevel: null }] }; } };
    }
  });
  assert.deepEqual(await data.fetchWbs("P1"), { status: "empty", rows: [] });
  const milestones = await data.fetchMilestones("P1");
  assert.equal(milestones.status, "success");
  assert.deepEqual(milestones.rows[0], {
    milestoneId: "M1",
    nodeName: "上线",
    planEndTime: "2026-07-12",
    actualEndTime: "2026-07-11",
    confirmStatus: "2"
  });
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
