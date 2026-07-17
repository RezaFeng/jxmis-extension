import assert from "node:assert/strict";
import test from "node:test";
import {
  MODE_ALL,
  MODE_HOURS,
  MODE_PLAN,
  MODE_SUMMARY,
  createBatchWorkRunner
} from "../../src/page/batch-work/batch-work-runner.js";

function createHarness(overrides = {}) {
  const events = [];
  const wkForm = {
    saveAll: function () {
      events.push("final-save");
    }
  };
  const operations = Object.assign(
    {
      waitForForm: async function () {
        events.push("wait-form");
        return wkForm;
      },
      resolveContext: async function (mode) {
        events.push("context:" + mode);
        return { wkId: "WK-1", mode: mode };
      },
      getCurrentWeekTable: function () {
        events.push("current-table");
        return { tableId: "execution", dataArr: [{ id: "ROW-1" }] };
      },
      loadDailyActual: async function (_context, rows) {
        events.push("daily:" + rows.length);
        return {
          dailyActualResolver: { available: true },
          dailyActualResult: { rawRows: [{ id: "DAILY-1" }] }
        };
      },
      applyCurrentWeekPlans: function () {
        events.push("apply-current");
        return {
          updateCount: 1,
          updateModifyData: { update: [{ id: "ROW-1" }] },
          result: [{ row: 1 }]
        };
      },
      generateSummary: async function (_context, _daily, options) {
        events.push("summary:" + Boolean(options && options.skipMissingAiConfig === false));
        return { summaryText: "summary" };
      },
      saveCurrentWeek: async function () {
        events.push("current-save");
        return true;
      },
      fillNextWeek: async function () {
        events.push("next-plan");
        return {
          insertCount: 1,
          missingMajorPersonCount: 0,
          missingMajorPersonRows: [],
          modifyData: { insert: [{ id: "NEXT-1" }] }
        };
      },
      getExecutionModifyData: function () {
        events.push("read-current-modify");
        return { update: [{ id: "ROW-1" }] };
      },
      postRunning: function () {
        events.push("post-running");
      },
      log: function (message) {
        events.push("log:" + message);
      },
      warn: function (message) {
        events.push("warn:" + message);
      }
    },
    overrides
  );
  return {
    events: events,
    runner: createBatchWorkRunner(operations)
  };
}

test("all mode saves current week before planning and saving next week", async function () {
  const harness = createHarness();

  const result = await harness.runner.run(MODE_ALL);

  assert.equal(result.updateCount, 1);
  assert.equal(result.nextInsertCount, 1);
  assert.equal(result.nextSaveSkipped, false);
  assert.ok(harness.events.indexOf("current-save") < harness.events.indexOf("next-plan"));
  assert.ok(harness.events.indexOf("next-plan") < harness.events.indexOf("final-save"));
});

test("summary mode requires AI configuration and saves only the current week", async function () {
  const harness = createHarness();

  const result = await harness.runner.run(MODE_SUMMARY);

  assert.equal(result.mode, MODE_SUMMARY);
  assert.equal(result.weeklySummaryGenerated, true);
  assert.equal(harness.events.includes("summary:true"), true);
  assert.equal(harness.events.includes("next-plan"), false);
  assert.equal(harness.events.includes("final-save"), false);
});

test("hours mode skips summary and next-week planning", async function () {
  const harness = createHarness();

  const result = await harness.runner.run(MODE_HOURS);

  assert.equal(result.mode, MODE_HOURS);
  assert.equal(result.updateCount, 1);
  assert.equal(harness.events.some(function (event) { return event.startsWith("summary:"); }), false);
  assert.equal(harness.events.includes("next-plan"), false);
});

test("plan mode never saves automatically", async function () {
  const harness = createHarness();

  const result = await harness.runner.run(MODE_PLAN);

  assert.equal(result.mode, MODE_PLAN);
  assert.equal(result.nextInsertCount, 1);
  assert.equal(result.nextSaveSkipped, true);
  assert.equal(harness.events.includes("wait-form"), false);
  assert.equal(harness.events.includes("current-save"), false);
  assert.equal(harness.events.includes("final-save"), false);
});

test("all mode skips final save when no current or next-week changes exist", async function () {
  const harness = createHarness({
    applyCurrentWeekPlans: function () {
      harness.events.push("apply-current");
      return { updateCount: 0, updateModifyData: { update: [] }, result: [] };
    },
    fillNextWeek: async function () {
      harness.events.push("next-plan");
      return {
        insertCount: 0,
        missingMajorPersonCount: 0,
        missingMajorPersonRows: [],
        modifyData: { insert: [] }
      };
    }
  });

  const result = await harness.runner.run(MODE_ALL);

  assert.equal(result.skipped, true);
  assert.equal(harness.events.includes("final-save"), false);
});

test("missing major person blocks only the next-week save", async function () {
  const harness = createHarness({
    fillNextWeek: async function () {
      harness.events.push("next-plan");
      return {
        insertCount: 1,
        missingMajorPersonCount: 1,
        missingMajorPersonRows: [{ extName: "Task" }],
        modifyData: { insert: [{ id: "NEXT-1" }] }
      };
    }
  });

  const result = await harness.runner.run(MODE_ALL);

  assert.equal(result.currentSaveTriggered, true);
  assert.equal(result.nextSaveSkipped, true);
  assert.equal(harness.events.includes("current-save"), true);
  assert.equal(harness.events.includes("final-save"), false);
});

test("missing AI configuration is skippable only in all mode", async function () {
  const generateSummary = async function (_context, _daily, options) {
    if (options && options.skipMissingAiConfig === false) {
      throw new Error("请先配置模型");
    }
    return { summaryText: "" };
  };
  const allHarness = createHarness({ generateSummary: generateSummary });
  const summaryHarness = createHarness({ generateSummary: generateSummary });

  const allResult = await allHarness.runner.run(MODE_ALL);
  await assert.rejects(summaryHarness.runner.run(MODE_SUMMARY), /请先配置模型/);

  assert.equal(allResult.weeklySummaryGenerated, false);
  assert.equal(allResult.nextInsertCount, 1);
});
