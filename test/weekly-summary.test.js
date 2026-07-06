const test = require("node:test");
const assert = require("node:assert/strict");

const weeklySummary = require("../weekly-summary");

function context(overrides) {
  return Object.assign(
    {
      wkId: "WK-1",
      projectId: "P-1",
      projectName: "测试项目",
      weekStart: "2026-06-29",
      weekEnd: "2026-07-05"
    },
    overrides || {}
  );
}

const dailyTasks = [
  {
    taskName: "开发",
    realHour: "8",
    taskDetail: "完成接口"
  }
];

test("creates stable prompt payload", function () {
  const prompt = weeklySummary.createUserPrompt(context(), dailyTasks);
  const parsed = JSON.parse(prompt);

  assert.equal(parsed.projectName, "测试项目");
  assert.equal(parsed.weekStart, "2026-06-29");
  assert.equal(parsed.weekEnd, "2026-07-05");
  assert.deepEqual(parsed.dailyTasks, dailyTasks);
});

test("creates cache key from wkId or project range", function () {
  assert.equal(weeklySummary.createSummaryCacheKey(context()), "wk:WK-1");
  assert.equal(
    weeklySummary.createSummaryCacheKey(context({ wkId: "" })),
    "project:P-1:2026-06-29:2026-07-05"
  );
});

test("creates cache payload with prompt and task count", function () {
  const userPrompt = weeklySummary.createUserPrompt(context(), dailyTasks);
  const cache = weeklySummary.createSummaryCachePayload(
    context(),
    dailyTasks,
    userPrompt,
    "2026-07-04T00:00:00.000Z"
  );

  assert.equal(cache.cacheKey, "wk:WK-1");
  assert.equal(cache.payload.dailyTaskCount, 1);
  assert.equal(cache.payload.userPrompt, userPrompt);
  assert.equal(cache.payload.cachedAt, "2026-07-04T00:00:00.000Z");
});

test("resolves progress type and save behavior", function () {
  assert.equal(weeklySummary.getProgressType(), "CW_WEEKLY_SUMMARY_PROGRESS");
  assert.equal(weeklySummary.getProgressType({ progressType: "CW_BATCH_WORK_RUNNING" }), "CW_BATCH_WORK_RUNNING");
  assert.equal(weeklySummary.shouldSaveSummary(), true);
  assert.equal(weeklySummary.shouldSaveSummary({ skipSave: true }), false);
});

test("validates daily tasks and summary text", function () {
  assert.doesNotThrow(function () {
    weeklySummary.assertDailyTasks(dailyTasks);
    weeklySummary.assertSummaryText("完成了本周工作");
  });
  assert.throws(function () {
    weeklySummary.assertDailyTasks([]);
  }, /未找到本周 taskDetail 日报内容/);
  assert.throws(function () {
    weeklySummary.assertSummaryText("  ");
  }, /模型返回内容为空/);
});

test("creates request ids and pending request state", function () {
  const requestId = weeklySummary.createRequestId(
    function () {
      return 123;
    },
    function () {
      return 0.456;
    }
  );
  let resolved = "";
  const pending = weeklySummary.createPendingRequest(
    requestId,
    { name: "field" },
    function (value) {
      resolved = value;
    },
    function () {}
  );

  assert.equal(requestId, "123-456");
  assert.equal(pending.requestId, "123-456");
  assert.deepEqual(pending.targetField, { name: "field" });
  pending.resolve("done");
  assert.equal(resolved, "done");
});

test("aggregates stream chunks", function () {
  const pending = weeklySummary.createPendingRequest("REQ-1", null, function () {}, function () {});

  assert.equal(weeklySummary.appendChunk(pending, "本周"), "本周");
  assert.equal(weeklySummary.appendChunk(pending, "完成"), "本周完成");
  assert.equal(weeklySummary.appendChunk(pending, ""), "本周完成");
});

test("creates summary result and error messages", function () {
  assert.deepEqual(weeklySummary.createResult("总结", 2, "prompt"), {
    summaryText: "总结",
    taskCount: 2,
    userPrompt: "prompt"
  });
  assert.equal(weeklySummary.getErrorMessage({ message: "bad" }), "bad");
  assert.equal(weeklySummary.getErrorMessage({}), "模型请求失败");
});
