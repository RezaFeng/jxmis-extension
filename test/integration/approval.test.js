import assert from "node:assert/strict";
import test from "node:test";
import { createDailyApprovalAutomation } from "../../src/page/daily-approval/daily-approval.js";
import { createWeeklyApprovalAutomation } from "../../src/page/weekly-approval/weekly-approval.js";
import { MESSAGE_TYPES } from "../../src/shared/protocol.js";

function createWindow() {
  return {
    location: { origin: "https://jxmis.cyberwing.cn" },
    localStorage: { getItem: function () { return "/jxpmo"; } },
    setTimeout: setTimeout
  };
}

function createTransport(overrides = {}) {
  const posts = [];
  const sleeps = [];
  const textCalls = [];
  return Object.assign(
    {
      posts: posts,
      sleeps: sleeps,
      textCalls: textCalls,
      post: function (_window, source, type, message, extra) {
        posts.push(Object.assign({ source: source, type: type, message: message }, extra || {}));
      },
      sleep: async function (_window, ms) {
        sleeps.push(ms);
      },
      randomDelay: function () {
        return 125;
      },
      getBaseUrl: function () {
        return "https://jxmis.cyberwing.cn/jxpmo";
      },
      fetchJson: async function () {
        throw new Error("unexpected JSON request");
      },
      fetchText: async function (_fetch, url, label, options) {
        textCalls.push({ url: url, label: label, options: options });
        return "success";
      }
    },
    overrides
  );
}

function dailyRow(id) {
  return {
    id: id,
    type: "task",
    createTime: "2026-07-17",
    realFinishRate: 100,
    planTime: 8,
    extId: "WBS-" + id,
    peopleName: "Tester",
    taskName: "Task " + id
  };
}

test("daily approval runs sequentially and reports completion", async function () {
  const transport = createTransport({
    fetchJson: async function (_fetch, url) {
      if (url.endsWith("/rest/org/user")) {
        return { userId: "USER-1" };
      }
      return { rows: [dailyRow("1"), dailyRow("2")], pageCount: 1, total: 2 };
    }
  });
  const automation = createDailyApprovalAutomation({
    window: createWindow(),
    fetch: async function () {},
    transport: transport
  });

  await automation.run();

  assert.equal(transport.textCalls.length, 2);
  assert.deepEqual(transport.sleeps, [125]);
  assert.deepEqual(
    transport.textCalls.map(function (call) {
      return JSON.parse(call.options.body)[0].id;
    }),
    ["1", "2"]
  );
  const done = transport.posts.at(-1);
  assert.equal(done.type, MESSAGE_TYPES.DAILY_DONE);
  assert.equal(done.shouldReload, true);
});

test("daily approval stops cleanly when there are no pending rows", async function () {
  const transport = createTransport({
    fetchJson: async function (_fetch, url) {
      return url.endsWith("/rest/org/user") ? { userId: "USER-1" } : { rows: [], pageCount: 1 };
    }
  });
  const automation = createDailyApprovalAutomation({
    window: createWindow(),
    fetch: async function () {},
    transport: transport
  });

  await automation.run();

  assert.equal(transport.textCalls.length, 0);
  assert.equal(transport.posts.at(-1).type, MESSAGE_TYPES.DAILY_DONE);
  assert.equal(transport.posts.at(-1).shouldReload, false);
});

function createWeeklyHarness(confirmPreview) {
  const detailReads = new Map();
  const transport = createTransport({
    fetchJson: async function (_fetch, url) {
      if (url.endsWith("/rest/org/user")) {
        return { userId: "OWNER-1", userFullName: "Owner One" };
      }
      if (url.includes("/rest/project/WkReportService/query?")) {
        return {
          rows: [
            { wkId: "WK-1", prodPerson: "OWNER-1", prodPersonName: "Owner One", status: "20" },
            { wkId: "WK-2", prodPerson: "OTHER", prodPersonName: "Other", status: "20" }
          ],
          pageCount: 1,
          recordsFiltered: 2
        };
      }
      if (url.includes("queryByProjectInfosService")) {
        const wkId = new URL(url).searchParams.get("wkId");
        const count = (detailReads.get(wkId) || 0) + 1;
        detailReads.set(wkId, count);
        return [{
          wkId: wkId,
          prodPerson: "OWNER-1",
          status: count === 1 ? "20" : "30",
          approvalTime: "2026-07-17 10:00:00"
        }];
      }
      throw new Error("unexpected URL: " + url);
    },
    fetchText: async function (_fetch, url, label, options) {
      transport.textCalls.push({ url: url, label: label, options: options });
      return "批复完成";
    }
  });
  const automation = createWeeklyApprovalAutomation({
    window: createWindow(),
    document: { querySelector: function () { return null; } },
    fetch: async function () {},
    transport: transport,
    now: function () { return new Date(2026, 6, 17); },
    confirmPreview: confirmPreview
  });
  return { automation: automation, transport: transport, detailReads: detailReads };
}

test("weekly approval filters candidates and verifies state before and after approval", async function () {
  let previewRows = [];
  const harness = createWeeklyHarness(async function (rows) {
    previewRows = rows;
    return true;
  });

  await harness.automation.run();

  assert.deepEqual(previewRows.map(function (row) { return row.wkId; }), ["WK-1"]);
  assert.equal(harness.transport.textCalls.length, 1);
  assert.equal(harness.detailReads.get("WK-1"), 2);
  const done = harness.transport.posts.at(-1);
  assert.equal(done.type, MESSAGE_TYPES.WEEKLY_DONE);
  assert.match(done.message, /成功 1/);
  assert.equal(done.shouldReload, true);
});

test("weekly approval cancellation does not call the approval endpoint", async function () {
  const harness = createWeeklyHarness(async function () { return false; });

  await harness.automation.run();

  assert.equal(harness.transport.textCalls.length, 0);
  assert.equal(harness.transport.posts.at(-1).type, MESSAGE_TYPES.WEEKLY_DONE);
  assert.equal(harness.transport.posts.at(-1).shouldReload, false);
});
