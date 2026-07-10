(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.CwWeeklySummary = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function createUserPrompt(context, dailyTasks) {
    return JSON.stringify(
      {
        projectName: context.projectName,
        weekStart: context.weekStart,
        weekEnd: context.weekEnd,
        dailyTasks: dailyTasks
      },
      null,
      2
    );
  }

  function createSummaryCacheKey(context) {
    if (context.wkId) {
      return "wk:" + context.wkId;
    }
    return [
      "project",
      context.projectId,
      context.weekStart,
      context.weekEnd
    ].join(":");
  }

  function createSummaryCachePayload(context, dailyTasks, userPrompt, nowIso) {
    const cacheKey = createSummaryCacheKey(context);
    return {
      cacheKey: cacheKey,
      payload: {
        cacheKey: cacheKey,
        wkId: context.wkId,
        projectId: context.projectId,
        projectName: context.projectName,
        weekStart: context.weekStart,
        weekEnd: context.weekEnd,
        dailyTaskCount: dailyTasks.length,
        userPrompt: userPrompt,
        cachedAt: nowIso
      }
    };
  }

  function getProgressType(options) {
    return options && options.progressType ? options.progressType : "CW_WEEKLY_SUMMARY_PROGRESS";
  }

  function shouldSaveSummary(options) {
    return !(options && options.skipSave);
  }

  function assertDailyTasks(dailyTasks) {
    if (!dailyTasks.length) {
      throw new Error("未找到本周 taskDetail 日报内容");
    }
  }

  function assertSummaryText(summaryText) {
    if (!String(summaryText || "").trim()) {
      throw new Error("模型返回内容为空");
    }
  }

  function createRequestId(nowFn, randomFn) {
    const now = nowFn || Date.now;
    const random = randomFn || Math.random;
    return String(now()) + "-" + String(random()).slice(2);
  }

  function createPendingRequest(requestId, targetField, resolve, reject) {
    return {
      requestId: requestId,
      text: "",
      targetField: targetField,
      resolve: resolve,
      reject: reject
    };
  }

  function appendChunk(request, text) {
    request.text += text || "";
    return request.text;
  }

  function createResult(summaryText, taskCount, userPrompt) {
    return {
      summaryText: summaryText,
      taskCount: taskCount,
      userPrompt: userPrompt
    };
  }

  function getErrorMessage(data) {
    return (data && data.message) || "模型请求失败";
  }

  function isMissingConfigError(error) {
    const message = String((error && error.message) || error || "");
    return message.indexOf("请先配置模型 URL") >= 0 ||
      message.indexOf("请先配置模型") >= 0 ||
      message.indexOf("未配置大模型") >= 0;
  }

  return {
    createUserPrompt: createUserPrompt,
    createSummaryCacheKey: createSummaryCacheKey,
    createSummaryCachePayload: createSummaryCachePayload,
    getProgressType: getProgressType,
    shouldSaveSummary: shouldSaveSummary,
    assertDailyTasks: assertDailyTasks,
    assertSummaryText: assertSummaryText,
    createRequestId: createRequestId,
    createPendingRequest: createPendingRequest,
    appendChunk: appendChunk,
    createResult: createResult,
    getErrorMessage: getErrorMessage,
    isMissingConfigError: isMissingConfigError
  };
});
