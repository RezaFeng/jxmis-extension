  function valueOrEmpty(value) {
    return value == null ? "" : String(value);
  }

  function buildNextValues(actualTime, finishRate, realEndTime) {
    return {
      finishRate: finishRate.value,
      realEndTime: realEndTime.value,
      realTime: actualTime.value,
      isNeedDo: "0",
      isState: "50",
      memo: ""
    };
  }

  function hasChanged(rowData, nextValues) {
    return (
      String(rowData.finishRate ?? "") !== nextValues.finishRate ||
      String(rowData.realEndTime ?? "") !== nextValues.realEndTime ||
      String(rowData.realTime ?? "") !== nextValues.realTime ||
      String(rowData.isNeedDo ?? "") !== nextValues.isNeedDo ||
      String(rowData.isState ?? "") !== nextValues.isState ||
      String(rowData.memo ?? "") !== nextValues.memo
    );
  }

  function buildSkippedSummary(rowData, rowNumber, nextValues, actualTime, finishRate, realEndTime) {
    return {
      row: rowNumber,
      extName: rowData.extName,
      realTime: rowData.realTime,
      resolvedRealTime: nextValues.realTime,
      realTimeSource: actualTime.source,
      realTimeFallbackReason: actualTime.reason || "",
      dailyRealHour: actualTime.dailyRealHour || "",
      matchedDailyRows: actualTime.matchedDailyRows || 0,
      resolvedFinishRate: nextValues.finishRate,
      finishRateSource: finishRate.source,
      finishRateFallbackReason: finishRate.reason || "",
      dailyFinishRate: finishRate.dailyFinishRate || "",
      finishRateDailyDate: finishRate.latestDailyDate || "",
      resolvedRealEndTime: nextValues.realEndTime,
      realEndTimeSource: realEndTime.source,
      realEndTimeFallbackReason: realEndTime.reason || "",
      dailyEndTime: realEndTime.dailyEndTime || "",
      realEndTimeDailyDate: realEndTime.latestDailyDate || "",
      skipped: true
    };
  }

  function buildChangedSummary(rowData, rowNumber, planDate, nextValues, actualTime, finishRate, realEndTime) {
    return {
      row: rowNumber,
      extId: rowData.extId,
      extName: rowData.extName,
      finishRate: nextValues.finishRate,
      realEndTime: nextValues.realEndTime,
      realTime: nextValues.realTime,
      planDate: planDate,
      realTimeSource: actualTime.source,
      realTimeFallbackReason: actualTime.reason || "",
      dailyRealHour: actualTime.dailyRealHour || "",
      matchedDailyRows: actualTime.matchedDailyRows || 0,
      finishRateSource: finishRate.source,
      finishRateFallbackReason: finishRate.reason || "",
      dailyFinishRate: finishRate.dailyFinishRate || "",
      finishRateDailyDate: finishRate.latestDailyDate || "",
      realEndTimeSource: realEndTime.source,
      realEndTimeFallbackReason: realEndTime.reason || "",
      dailyEndTime: realEndTime.dailyEndTime || "",
      realEndTimeDailyDate: realEndTime.latestDailyDate || "",
      isNeedDo: nextValues.isNeedDo,
      isState: nextValues.isState
    };
  }

  function buildCurrentWeekExecutionPlan(options) {
    const rowData = options.rowData || {};
    const actualTime = options.actualTime || {};
    const finishRate = options.finishRate || {};
    const realEndTime = options.realEndTime || {};
    const rowNumber = options.rowNumber;
    const planDate = valueOrEmpty(options.planDate);
    const nextValues = buildNextValues(actualTime, finishRate, realEndTime);
    const changed = hasChanged(rowData, nextValues);

    return {
      nextValues: nextValues,
      hasChanged: changed,
      summaryRow: changed
        ? buildChangedSummary(rowData, rowNumber, planDate, nextValues, actualTime, finishRate, realEndTime)
        : buildSkippedSummary(rowData, rowNumber, nextValues, actualTime, finishRate, realEndTime)
    };
  }

  export { buildCurrentWeekExecutionPlan, buildNextValues, hasChanged };
