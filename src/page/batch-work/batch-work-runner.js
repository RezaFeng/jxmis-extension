export const MODE_ALL = "all";
export const MODE_SUMMARY = "summary";
export const MODE_HOURS = "hours";
export const MODE_PLAN = "plan";

export function normalizeRunMode(mode) {
  const value = String(mode || "").trim();
  if (value === MODE_SUMMARY || value === MODE_HOURS || value === MODE_PLAN) {
    return value;
  }
  return MODE_ALL;
}

export function createBatchWorkRunner(operations) {
  async function runSummaryOnly() {
    const wkForm = await operations.waitForForm();
    const context = await operations.resolveContext(MODE_SUMMARY);
    const dailyActual = await operations.loadDailyActual(context, []);
    const summaryResult = await operations.generateSummary(
      context,
      dailyActual.dailyActualResult,
      { skipMissingAiConfig: false }
    );
    const saved = await operations.saveCurrentWeek(wkForm, 0, summaryResult, null);
    return {
      mode: MODE_SUMMARY,
      updateCount: 0,
      nextInsertCount: 0,
      currentSaveTriggered: saved,
      weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
      skipped: !saved
    };
  }

  async function runHoursOnly() {
    const wkForm = await operations.waitForForm();
    const context = await operations.resolveContext(MODE_HOURS);
    const currentWeekTable = operations.getCurrentWeekTable();
    const dailyActual = await operations.loadDailyActual(context, currentWeekTable.dataArr);
    const currentWeekPlan = operations.applyCurrentWeekPlans(
      currentWeekTable,
      dailyActual.dailyActualResolver
    );
    const saved = await operations.saveCurrentWeek(
      wkForm,
      currentWeekPlan.updateCount,
      null,
      currentWeekPlan.updateModifyData
    );
    return {
      mode: MODE_HOURS,
      updateCount: currentWeekPlan.updateCount,
      nextInsertCount: 0,
      currentSaveTriggered: saved,
      weeklySummaryGenerated: false,
      result: currentWeekPlan.result,
      skipped: currentWeekPlan.updateCount <= 0
    };
  }

  async function runPlanOnly() {
    const context = await operations.resolveContext(MODE_PLAN);
    operations.postRunning("生成下周 WBS 计划明细");
    const nextPlanResult = await operations.fillNextWeek(context);
    return {
      mode: MODE_PLAN,
      updateCount: 0,
      nextInsertCount: nextPlanResult.insertCount,
      missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
      missingMajorPersonRows: nextPlanResult.missingMajorPersonRows,
      currentSaveTriggered: false,
      weeklySummaryGenerated: false,
      nextPlan: nextPlanResult,
      skipped: nextPlanResult.insertCount <= 0,
      nextSaveSkipped: true
    };
  }

  async function runAll() {
    const wkForm = await operations.waitForForm();
    const context = await operations.resolveContext(MODE_ALL);
    const currentWeekTable = operations.getCurrentWeekTable();
    const dailyActual = await operations.loadDailyActual(context, currentWeekTable.dataArr);
    const currentWeekPlan = operations.applyCurrentWeekPlans(
      currentWeekTable,
      dailyActual.dailyActualResolver
    );
    const summaryResult = await operations.generateSummary(
      context,
      dailyActual.dailyActualResult
    );
    const currentSaveTriggered = await operations.saveCurrentWeek(
      wkForm,
      currentWeekPlan.updateCount,
      summaryResult,
      currentWeekPlan.updateModifyData
    );

    operations.postRunning("生成下周 WBS 计划明细");
    const nextPlanResult = await operations.fillNextWeek(context);
    const finalModifyData = {
      execution: operations.getExecutionModifyData(currentWeekTable.tableId),
      executionNext: nextPlanResult.modifyData
    };

    if (currentWeekPlan.updateCount <= 0 && nextPlanResult.insertCount <= 0) {
      operations.warn("skip save because no update/insert data", {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        nextPlan: nextPlanResult
      });
      return {
        updateCount: 0,
        nextInsertCount: 0,
        currentSaveTriggered: currentSaveTriggered,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        result: currentWeekPlan.result,
        skipped: true
      };
    }

    if (nextPlanResult.missingMajorPersonCount > 0) {
      operations.warn("skip executionNext save because missing majorPerson", {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
        missingMajorPersonRows: nextPlanResult.missingMajorPersonRows.slice(0, 20)
      });
      return {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
        currentSaveTriggered: currentSaveTriggered,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        nextPlan: nextPlanResult,
        result: currentWeekPlan.result,
        skipped: false,
        nextSaveSkipped: true
      };
    }

    if (nextPlanResult.insertCount <= 0) {
      operations.log("skip executionNext save because no generated insert rows", {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount
      });
      return {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: 0,
        currentSaveTriggered: currentSaveTriggered,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        nextPlan: nextPlanResult,
        result: currentWeekPlan.result,
        skipped: false,
        nextSaveSkipped: false
      };
    }

    operations.log("executionNext saveAll start", {
      updateCount: currentWeekPlan.updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      finalModifyData: finalModifyData
    });
    wkForm.saveAll();
    operations.log("executionNext saveAll called");

    return {
      updateCount: currentWeekPlan.updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      currentSaveTriggered: currentSaveTriggered,
      weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
      nextPlan: nextPlanResult,
      result: currentWeekPlan.result,
      skipped: false,
      nextSaveSkipped: false
    };
  }

  async function run(mode) {
    const normalizedMode = normalizeRunMode(mode);
    if (normalizedMode === MODE_SUMMARY) {
      return runSummaryOnly();
    }
    if (normalizedMode === MODE_HOURS) {
      return runHoursOnly();
    }
    if (normalizedMode === MODE_PLAN) {
      return runPlanOnly();
    }
    return runAll();
  }

  return { run };
}
