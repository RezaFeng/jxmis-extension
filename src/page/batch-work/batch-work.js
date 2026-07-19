import * as transportModule from "../shared/jxmis-transport.js";
import * as weeklyDetailModule from "../shared/weekly-detail.js";
import * as currentWeekPlanModule from "./current-week-execution-plan.js";
import * as dailyActualModule from "./daily-actual.js";
import * as wbsPlanModule from "./wbs-plan.js";
import * as weeklyContextModule from "./weekly-context.js";
import * as weeklySummaryModule from "./weekly-summary.js";
import {
  MODE_ALL,
  MODE_HOURS,
  MODE_PLAN,
  MODE_SUMMARY,
  createBatchWorkRunner
} from "./batch-work-runner.js";
import { MESSAGE_TYPES, SOURCES, parseWindowMessage } from "../../shared/protocol.js";

export function createBatchWorkAutomation(adapters) {
  const window = adapters.window;
  const document = adapters.document || window.document;
  const fetch = adapters.fetch || window.fetch.bind(window);
  const DataTablesUtil = adapters.DataTablesUtil || new Proxy({}, {
    get: function (_target, key) {
      const current = window.DataTablesUtil;
      return current && current[key];
    }
  });
  const Event = adapters.Event || window.Event;
  const URLSearchParams = adapters.URLSearchParams || globalThis.URLSearchParams;
  const performance = adapters.performance || window.performance || globalThis.performance;
  const SOURCE_PAGE = SOURCES.WORK_PAGE;
  const SOURCE_CONTENT = SOURCES.WORK_CONTENT;

  let running = false;
  let pendingAiRequest = null;

  const summaryConfig = {
    pageSize: 100,
    maxPages: 250,
    pageConcurrency: 2
  };

  function createPageMessage(type, message, extra) {
    return Object.assign(
      {
        source: SOURCE_PAGE,
        type: type,
        message: message
      },
      extra || {}
    );
  }

  function getTransport() {
    return transportModule;
  }

  function getWeeklyContextModule() {
    return weeklyContextModule;
  }

  function post(type, message, extra) {
    transportModule.post(window, SOURCE_PAGE, type, message, extra);
  }

  function logWbsStep(step, detail) {
    if (detail === undefined) {
      console.log("[cw-batch-work][wbs] " + step);
      return;
    }
    console.log("[cw-batch-work][wbs] " + step, detail);
  }

  function warnWbsStep(step, detail) {
    if (detail === undefined) {
      console.warn("[cw-batch-work][wbs] " + step);
      return;
    }
    console.warn("[cw-batch-work][wbs] " + step, detail);
  }

  function normalizeRunMode(mode) {
    const value = String(mode || "").trim();
    if (value === MODE_SUMMARY || value === MODE_HOURS || value === MODE_PLAN) {
      return value;
    }
    return MODE_ALL;
  }

  function getRunModeLabel(mode) {
    if (mode === MODE_SUMMARY) {
      return "仅填周报";
    }
    if (mode === MODE_HOURS) {
      return "仅填工时";
    }
    if (mode === MODE_PLAN) {
      return "仅填计划";
    }
    return "一键报工";
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  async function waitForWkFormJS(requiredMethods) {
    const methods = requiredMethods || [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const api = window.WkFormJS;
      const ready =
        api &&
        methods.every(function (method) {
          return typeof api[method] === "function";
        });
      if (ready) {
        return api;
      }
      await delay(100);
    }
    throw new Error("未找到 WkFormJS." + methods.join("/") + "，请等待页面加载完成后重试");
  }

  function getWebapp() {
    return getTransport().getWebapp(window.localStorage);
  }

  function getBaseUrl() {
    return getTransport().getBaseUrl(window.location, window.localStorage);
  }

  async function assertOk(response, label) {
    return getTransport().assertOk(response, label);
  }

  async function fetchJson(url, label) {
    return getTransport().fetchJson(fetch, url, label);
  }

  function parseDate(value) {
    return getWeeklyContextModule().parseDate(value);
  }

  function formatDate(date) {
    return getWeeklyContextModule().formatDate(date);
  }

  function addDays(date, days) {
    return getWeeklyContextModule().addDays(date, days);
  }

  function normalizeWeeklyDetail(data) {
    return weeklyDetailModule.normalizeWeeklyDetail(data);
  }

  async function getWeeklyContext() {
    return getWeeklyContextModule().getWeeklyContext({
      document: document,
      location: window.location,
      fetchJson: fetchJson,
      getBaseUrl: getBaseUrl,
      normalizeWeeklyDetail: normalizeWeeklyDetail
    });
  }

  function dateInRange(value, startDate, endDate) {
    const date = parseDate(value);
    if (!date) {
      return false;
    }
    return date >= startDate && date <= endDate;
  }

  async function fetchTaskDetailPage(projectId, page) {
    const params = new URLSearchParams({
      queryType: "page",
      queryName: "projectTaskDetailList",
      refCols: "default",
      projectId: String(projectId),
      draw: String(page),
      page: String(page),
      start: String((page - 1) * summaryConfig.pageSize),
      length: String(summaryConfig.pageSize),
      rows: String(summaryConfig.pageSize)
    });

    return fetchJson(
      getBaseUrl() + "/rest/project/taskDetailService/query?" + params.toString(),
      "fetch daily task detail page " + page
    );
  }

  function appendWeeklyTaskRows(rows, context, seen, result) {
    rows.forEach(function (row) {
      const taskDetail = String((row && row.taskDetail) || "").trim();
      const dateSource = (row && (row.submissionTime || row.realEndTime || row.createTime)) || "";
      if (!taskDetail || !dateInRange(dateSource, context.startDate, context.endDate)) {
        return;
      }

      const date = formatDate(parseDate(dateSource));
      const userFullname = String((row && row.userFullname) || "").trim() || "未知人员";
      const key = userFullname + "\n" + date + "\n" + taskDetail;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push({
        userFullname: userFullname,
        date: date,
        taskDetail: taskDetail
      });
    });
  }

  function createWeeklyTaskDetailsFromRows(rows, context) {
    const seen = new Set();
    const result = [];
    appendWeeklyTaskRows(rows, context, seen, result);
    result.sort(function (a, b) {
      return (a.date + a.userFullname).localeCompare(b.date + b.userFullname, "zh-CN");
    });
    return result;
  }

  function pageHasRowsBeforeWeek(rows, context) {
    return rows.some(function (row) {
      const dateSource = (row && (row.submissionTime || row.realEndTime || row.createTime)) || "";
      const date = parseDate(dateSource);
      return date && date < context.startDate;
    });
  }

  function getTaskDetailPageCount(data) {
    const total = Number((data && (data.recordsFiltered || data.total || data.recordsTotal)) || 0);
    const pageCount = Number(data && data.pageCount) || (total > 0 ? Math.ceil(total / summaryConfig.pageSize) : 0);
    return Math.min(pageCount || 1, summaryConfig.maxPages);
  }

  function normalizeMatchText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getDailyStatus(row) {
    return normalizeMatchText(row && (row.newstauts || row.newStatus || row.status));
  }

  function getDailyDateSource(row) {
    return (row && (row.submissionTime || row.realEndTime || row.createTime)) || "";
  }

  function parseDateTime(value) {
    const match = String(value || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (!match) {
      return null;
    }
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
  }

  function getDailySortTime(row) {
    const source = getDailyDateSource(row);
    const date = parseDateTime(source);
    return date ? date.getTime() : 0;
  }

  function formatRateValue(value) {
    const text = String(value == null ? "" : value).replace("%", "").trim();
    if (!text) {
      return "";
    }
    const number = Number(text);
    if (!Number.isFinite(number)) {
      return "";
    }
    const rounded = Math.round(number * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }

  function getWeeklyPersonKey(rowData) {
    const personId = normalizeMatchText(rowData && rowData.majorPerson);
    if (personId) {
      return "id:" + personId;
    }
    const personName = normalizeMatchText(rowData && rowData.majorPersonName);
    return personName ? "name:" + personName : "";
  }

  function dailyPersonMatches(row, rowData) {
    const dailyOwner = normalizeMatchText(row && row.taskOwner);
    const weeklyOwner = normalizeMatchText(rowData && rowData.majorPerson);
    if (dailyOwner && weeklyOwner && dailyOwner === weeklyOwner) {
      return true;
    }

    const dailyName = normalizeMatchText(row && (row.userFullname || row.taskcreateperson));
    const weeklyName = normalizeMatchText(rowData && rowData.majorPersonName);
    return Boolean(dailyName && weeklyName && dailyName === weeklyName);
  }

  function getWeeklyWbsId(rowData) {
    return normalizeMatchText(rowData && rowData.wbsId);
  }

  function getDailyWbsId(row) {
    return normalizeMatchText(row && row.wbsId);
  }

  function getWeeklyTaskNames(rowData) {
    const seen = new Set();
    return [
      rowData && rowData.wbsName,
      rowData && rowData.extName,
      rowData && rowData.taskName
    ].map(normalizeMatchText).filter(function (name) {
      if (!name || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    });
  }

  function getDailyTaskNames(row) {
    const seen = new Set();
    return [
      row && row.taskName,
      row && row.wbsName
    ].map(normalizeMatchText).filter(function (name) {
      if (!name || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    });
  }

  function appendWeeklyDailyActualRows(rows, context, seen, result, stats) {
    dailyActualModule.appendDailyActualRows(rows, context, seen, result, stats);
  }

  async function fetchWeeklyDailyActualRows(context) {
    const seen = new Set();
    const result = [];
    const rawRows = [];
    const stats = {
      scanned: 0,
      usable: 0,
      outsideWeek: 0,
      skippedNotApproved: 0,
      skippedNoRealHour: 0,
      duplicate: 0,
      noWbsId: 0
    };

    const firstData = await fetchTaskDetailPage(context.projectId, 1);
    const firstRows = Array.isArray(firstData && firstData.rows) ? firstData.rows : [];
    rawRows.push.apply(rawRows, firstRows);
    appendWeeklyDailyActualRows(firstRows, context, seen, result, stats);

    const pageCount = getTaskDetailPageCount(firstData);
    if (!firstRows.length || pageCount <= 1 || pageHasRowsBeforeWeek(firstRows, context)) {
      return {
        rows: result,
        rawRows: rawRows,
        stats: stats
      };
    }

    let nextPage = 2;
    while (nextPage <= pageCount) {
      const batch = [];
      while (nextPage <= pageCount && batch.length < summaryConfig.pageConcurrency) {
        batch.push(nextPage);
        nextPage += 1;
      }

      post(
        MESSAGE_TYPES.WORK_RUNNING,
        "并发拉取日报工时页 " + batch[0] + "-" + batch[batch.length - 1] + " / " + pageCount
      );

      const pages = await Promise.all(
        batch.map(function (page) {
          return fetchTaskDetailPage(context.projectId, page).then(function (data) {
            return {
              page: page,
              data: data
            };
          });
        })
      );

      let shouldStop = false;
      pages.sort(function (a, b) {
        return a.page - b.page;
      }).forEach(function (item) {
        const rows = Array.isArray(item.data && item.data.rows) ? item.data.rows : [];
        rawRows.push.apply(rawRows, rows);
        appendWeeklyDailyActualRows(rows, context, seen, result, stats);
        if (pageHasRowsBeforeWeek(rows, context)) {
          shouldStop = true;
        }
      });

      if (shouldStop) {
        break;
      }
    }

    return {
      rows: result,
      rawRows: rawRows,
      stats: stats
    };
  }

  function buildWeeklyNameMatchCounts(weeklyRows) {
    return dailyActualModule.buildWeeklyNameMatchCounts(weeklyRows);
  }

  function formatHourValue(value) {
    return dailyActualModule.formatHourValue(value);
  }

  function createDailyActualResolver(dailyRows, weeklyRows) {
    return dailyActualModule.createDailyActualResolver(dailyRows, weeklyRows);
  }

  function findDailyMatchesByWbs(rowData, resolver) {
    return dailyActualModule.findDailyMatchesByWbs(rowData, resolver);
  }

  function findDailyMatchesByName(rowData, resolver) {
    return dailyActualModule.findDailyMatchesByName(rowData, resolver);
  }

  function resolveDailyActualHours(rowData, planDate, resolver) {
    return dailyActualModule.resolveDailyActualHours(rowData, planDate, resolver);
  }

  function resolveDailyFinishRate(rowData, resolver) {
    return dailyActualModule.resolveDailyFinishRate(rowData, resolver);
  }

  function resolveDailyRealEndTime(rowData, fallbackValue, resolver) {
    return dailyActualModule.resolveDailyRealEndTime(rowData, fallbackValue, resolver);
  }

  function buildCurrentWeekExecutionPlan(options) {
    return currentWeekPlanModule.buildCurrentWeekExecutionPlan(options);
  }

  function createUserPrompt(context, dailyTasks) {
    return weeklySummaryModule.createUserPrompt(context, dailyTasks);
  }

  function createSummaryCacheKey(context) {
    return weeklySummaryModule.createSummaryCacheKey(context);
  }

  function createSummaryCachePayload(context, dailyTasks, userPrompt) {
    return weeklySummaryModule.createSummaryCachePayload(
      context,
      dailyTasks,
      userPrompt,
      new Date().toISOString()
    );
  }

  function assertDailyTasks(dailyTasks) {
    weeklySummaryModule.assertDailyTasks(dailyTasks);
  }

  function assertSummaryText(summaryText) {
    weeklySummaryModule.assertSummaryText(summaryText);
  }

  function getSummaryProgressType(options) {
    return weeklySummaryModule.getProgressType(options);
  }

  function shouldSaveSummary(options) {
    return weeklySummaryModule.shouldSaveSummary(options);
  }

  function createAiSummaryRequestId() {
    return weeklySummaryModule.createRequestId();
  }

  function createPendingAiSummaryRequest(requestId, targetField, resolve, reject) {
    return weeklySummaryModule.createPendingRequest(requestId, targetField, resolve, reject);
  }

  function appendAiSummaryChunk(request, text) {
    return weeklySummaryModule.appendChunk(request, text);
  }

  function createWeeklySummaryResult(summaryText, taskCount, userPrompt) {
    return weeklySummaryModule.createResult(summaryText, taskCount, userPrompt);
  }

  function getAiSummaryErrorMessage(data) {
    return weeklySummaryModule.getErrorMessage(data);
  }

  function isMissingAiConfigError(error) {
    return weeklySummaryModule.isMissingConfigError(error);
  }

  function requestContentBridge(type, payload) {
    return new Promise(function (resolve, reject) {
      const requestId = String(Date.now()) + "-" + String(Math.random()).slice(2);

      function onMessage(event) {
        if (event.source !== window) {
          return;
        }
        const data = event.data;
        if (
          !data ||
          data.source !== SOURCE_CONTENT ||
          data.type !== type + "_RESULT" ||
          data.requestId !== requestId
        ) {
          return;
        }

        window.removeEventListener("message", onMessage);
        if (data.ok) {
          resolve(data);
        } else {
          reject(new Error(data.error || "请求扩展缓存失败"));
        }
      }

      window.addEventListener("message", onMessage);
      post(type, "", Object.assign({}, payload || {}, {
        requestId: requestId
      }));
    });
  }

  async function setSummaryCache(cacheKey, value) {
    await requestContentBridge(MESSAGE_TYPES.CACHE_SET, {
      key: cacheKey,
      value: value
    });
  }

  function findByLabelText(text) {
    const nodes = Array.from(document.querySelectorAll("label,td,th,div,span"));
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (String(node.textContent || "").trim().indexOf(text) < 0) {
        continue;
      }

      const containers = [
        node,
        node.parentElement,
        node.parentElement && node.parentElement.parentElement,
        node.nextElementSibling
      ].filter(Boolean);

      for (let j = 0; j < containers.length; j += 1) {
        const target = containers[j].querySelector && containers[j].querySelector("textarea,input,[contenteditable='true']");
        if (target) {
          return target;
        }
      }
    }
    return null;
  }

  function findCurrWkResultField() {
    const selectors = [
      "[name='currWkResult']",
      "#currWkResult",
      "[data-name='currWkResult']",
      "textarea[name*='currWk']",
      "textarea[id*='currWk']",
      "textarea[name*='Result']",
      "textarea[id*='Result']"
    ];

    for (let i = 0; i < selectors.length; i += 1) {
      const el = document.querySelector(selectors[i]);
      if (el) {
        return el;
      }
    }

    return findByLabelText("本周执行情况");
  }

  function setFieldValue(field, value) {
    if (!field) {
      return;
    }

    if (field.isContentEditable) {
      field.textContent = value;
    } else {
      field.value = value;
      field.setAttribute("value", value);
    }

    const $ = window.jQuery || window.$;
    if ($) {
      $(field).val(value).trigger("input").trigger("change");
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function requestAiSummary(userPrompt, targetField, options) {
    return new Promise(function (resolve, reject) {
      const requestId = createAiSummaryRequestId();
      pendingAiRequest = createPendingAiSummaryRequest(requestId, targetField, resolve, reject);
      pendingAiRequest.progressType =
        options && options.progressType ? options.progressType : MESSAGE_TYPES.WORK_RUNNING;
      console.info("[cw-weekly-summary-ai] page request", {
        requestId: requestId,
        promptLength: String(userPrompt || "").length
      });

      post(pendingAiRequest.progressType, "请求大模型，等待扩展后台响应");
      post(MESSAGE_TYPES.AI_REQUEST, "请求大模型", {
        requestId: requestId,
        userPrompt: userPrompt
      });
    });
  }

  function saveWeeklySummary(summaryText, targetField, options) {
    setFieldValue(targetField, summaryText);

    if (options && options.skipSave) {
      return;
    }

    if (window.WkFormJS && typeof window.WkFormJS.saveAll === "function") {
      window.WkFormJS.saveAll();
      return;
    }

    throw new Error("未找到 WkFormJS.saveAll，无法自动保存周报");
  }

  async function generateWeeklySummaryWithTasks(context, dailyTasks, targetField, options) {
    assertDailyTasks(dailyTasks);

    const taskCount = dailyTasks.length;
    const progressType = getSummaryProgressType(options);
    const saveSummary = shouldSaveSummary(options);
    const userPrompt = createUserPrompt(context, dailyTasks);
    const cache = createSummaryCachePayload(context, dailyTasks, userPrompt);

    await setSummaryCache(cache.cacheKey, cache.payload).catch(function (error) {
      console.warn("[cw-weekly-summary] cache write failed", error);
    });

    post(progressType, "请求大模型，总计 " + taskCount + " 条日报");
    const summaryText = await requestAiSummary(userPrompt, targetField, {
      progressType: progressType
    });
    assertSummaryText(summaryText);

    post(progressType, saveSummary ? "保存周报总结" : "回填周报总结，等待批量报工统一保存");
    saveWeeklySummary(summaryText, targetField, {
      skipSave: !saveSummary
    });

    return createWeeklySummaryResult(summaryText, taskCount, userPrompt);
  }

  const HOLIDAY_WORKDAY_OVERRIDES = {
    "2026": {
      holidays: [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-02-15",
        "2026-02-16",
        "2026-02-17",
        "2026-02-18",
        "2026-02-19",
        "2026-02-20",
        "2026-02-21",
        "2026-02-22",
        "2026-02-23",
        "2026-04-04",
        "2026-04-05",
        "2026-04-06",
        "2026-05-01",
        "2026-05-02",
        "2026-05-03",
        "2026-05-04",
        "2026-05-05",
        "2026-06-19",
        "2026-06-20",
        "2026-06-21",
        "2026-09-25",
        "2026-09-26",
        "2026-09-27",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07"
      ],
      workdays: [
        "2026-01-04",
        "2026-02-14",
        "2026-02-28",
        "2026-05-09",
        "2026-09-20",
        "2026-10-10"
      ]
    }
  };

  function hasHolidayTable(year) {
    return Boolean(HOLIDAY_WORKDAY_OVERRIDES[String(year)]);
  }

  function isChinaWorkday(date) {
    const key = formatDate(date);
    const config = HOLIDAY_WORKDAY_OVERRIDES[String(date.getFullYear())];
    if (config) {
      if (config.workdays.indexOf(key) >= 0) {
        return true;
      }
      if (config.holidays.indexOf(key) >= 0) {
        return false;
      }
    }
    const day = date.getDay();
    return day !== 0 && day !== 6;
  }

  function getNextWeekInfo(context) {
    return wbsPlanModule.getNextWeekInfo(context);
  }

  function countWorkdaysInRange(startDate, endDate) {
    if (!startDate || !endDate || startDate > endDate) {
      return 0;
    }
    let count = 0;
    let cursor = new Date(startDate.getTime());
    while (cursor <= endDate) {
      if (isChinaWorkday(cursor)) {
        count += 1;
      }
      cursor = addDays(cursor, 1);
    }
    return count;
  }

  function intervalsIntersect(startA, endA, startB, endB) {
    return startA && endA && startB && endB && startA <= endB && endA >= startB;
  }

  function normalizeRows(data) {
    if (Array.isArray(data)) {
      return data;
    }
    if (data && Array.isArray(data.rows)) {
      return data.rows;
    }
    if (data && Array.isArray(data.data)) {
      return data.data;
    }
    return [];
  }

  async function fetchProjectPlanDetails(context, dateRange) {
    const query = {
      queryName: "queryVer",
      filterQuery: "true",
      queryType: "page",
      max1: String(context.projectId),
      planId1: String(context.projectId),
      draw: "1",
      page: "1",
      start: "0",
      length: "-1",
      rows: "1073741824"
    };
    if (dateRange && dateRange.startTime) query.startTime = String(dateRange.startTime);
    if (dateRange && dateRange.endTime) query.endTime = String(dateRange.endTime);
    const params = new URLSearchParams(query);
    const url = getBaseUrl() + "/rest/project/ProjectPlanDetailService/query?" + params.toString();
    const startedAt = performance.now();
    logWbsStep("request ProjectPlanDetailService/query", {
      projectId: context.projectId,
      dateRange: dateRange || null,
      url: url
    });
    const data = await fetchJson(
      url,
      "fetch WBS plan details"
    );
    const rows = normalizeRows(data);
    logWbsStep("response ProjectPlanDetailService/query", {
      ms: Math.round(performance.now() - startedAt),
      rows: rows.length,
      total: data && (data.recordsFiltered || data.recordsTotal || data.total),
      sample: rows.slice(0, 3).map(function (row) {
        return {
          detailId: row && row.detailId,
          detailName: row && row.detailName,
          majorPerson: row && row.majorPerson,
          roleName: row && row.roleName,
          duration: row && row.duration,
          planStartTime: row && row.planStartTime,
          planEndTime: row && row.planEndTime
        };
      })
    });
    return rows;
  }

  async function fetchExistingNextExecutions(wkId) {
    if (!wkId) {
      return [];
    }
    const params = new URLSearchParams({
      queryName: "queryReportExtList",
      filterQuery: "true",
      queryType: "page",
      reportId: String(wkId),
      type: "2",
      draw: "1",
      page: "1",
      start: "0",
      length: "-1",
      rows: "1073741824"
    });
    const url = getBaseUrl() + "/rest/project/WkExecutionService/query?" + params.toString();
    const startedAt = performance.now();
    logWbsStep("request WkExecutionService/query type=2", {
      wkId: wkId,
      url: url
    });
    const data = await fetchJson(
      url,
      "fetch next week executions"
    );
    const rows = normalizeRows(data);
    logWbsStep("response WkExecutionService/query type=2", {
      ms: Math.round(performance.now() - startedAt),
      rows: rows.length,
      total: data && (data.recordsFiltered || data.recordsTotal || data.total),
      sample: rows.slice(0, 3).map(function (row) {
        return {
          extId: row && row.extId,
          extName: row && row.extName,
          wbsId: row && row.wbsId,
          majorPerson: row && row.majorPerson,
          majorPersonName: row && row.majorPersonName,
          planDate: row && row.planDate
        };
      })
    });
    return rows;
  }

  function getDataTableApi($table) {
    if (!$table || !$table.length) {
      return null;
    }
    return $table.data("dataTablesDT") || null;
  }

  function getNativeNextDataTable($table) {
    if (!$table || !$table.length) {
      return null;
    }
    return $table.data("dataTablesDT") || ($table.DataTable && $table.DataTable());
  }

  function findNextExecutionTable($) {
    const candidates = [];
    const inspected = [];
    $("table").each(function () {
      const $table = $(this);
      const url = String($table.attr("data-url") || "");
      const id = String($table.attr("id") || "");
      const matchedByUrl = url.indexOf("WkExecutionService/query") >= 0 && url.indexOf("type=2") >= 0;
      const matchedById = /next|ExecutionNext|WkExecutionNext|NextWk|WkNext/i.test(id);
      inspected.push({
        id: id,
        hasDt: Boolean(getDataTableApi($table)),
        matchedByUrl: matchedByUrl,
        matchedById: matchedById,
        dataUrl: url
      });
      if (matchedByUrl) {
        candidates.push($table);
        return;
      }
      if (matchedById) {
        candidates.push($table);
      }
    });

    const fallbackIds = [
      "WkExecutionNextgrid",
      "WkExecutionNextGrid",
      "WkExecutiongridNext",
      "WkExecutionNext",
      "executionNextgrid"
    ];
    for (let i = 0; i < fallbackIds.length; i += 1) {
      const $fallback = $("#" + fallbackIds[i]);
      if ($fallback.length) {
        candidates.push($fallback);
      }
    }

    logWbsStep("inspect next execution tables", {
      inspectedCount: inspected.length,
      candidates: candidates.map(function ($candidate) {
        return {
          id: $candidate.attr("id") || "",
          hasDt: Boolean(getDataTableApi($candidate)),
          dataUrl: String($candidate.attr("data-url") || "")
        };
      }),
      inspected: inspected
    });

    for (let j = 0; j < candidates.length; j += 1) {
      if (getDataTableApi(candidates[j])) {
        logWbsStep("selected next execution table", {
          id: candidates[j].attr("id") || "",
          dataUrl: String(candidates[j].attr("data-url") || "")
        });
        return candidates[j];
      }
    }
    warnWbsStep("no initialized next execution table candidate found", {
      candidateCount: candidates.length
    });
    return candidates[0] || $();
  }

  function createDedupKey(row) {
    return [
      String((row && row.majorPerson) || ""),
      String((row && (row.wbsId || row.detailId)) || ""),
      String((row && (row.extName || row.detailName || row.wbsName)) || "")
    ].join("|");
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isTentativeOwner(row) {
    return String((row && (row.roleName || row.majorPersonName || row.majorPerson)) || "").trim() === "待定";
  }

  function getWbsOwnerId(row) {
    return String((row && (row.roleId || row.majorPerson)) || "").trim();
  }

  function getWbsOwnerName(row) {
    return String((row && (row.roleName || row.majorPersonName)) || "").trim();
  }

  function hasWbsDuration(row) {
    return toNumber(row && row.duration) > 0;
  }

  function splitHours(totalHours) {
    const chunks = [];
    let remaining = Math.max(0, Math.floor(totalHours));
    while (remaining > 0) {
      const chunk = Math.min(24, remaining);
      chunks.push(chunk);
      remaining -= chunk;
    }
    return chunks;
  }

  function createNextExecutionRow(wbs, hours, context, options) {
    const manualPerson = Boolean(options && options.manualPerson);
    const tentative = isTentativeOwner(wbs);
    const ownerId = tentative || manualPerson ? "" : getWbsOwnerId(wbs);
    const ownerName = tentative || manualPerson ? "" : getWbsOwnerName(wbs);
    const detailName = String((wbs && wbs.detailName) || "").trim();
    const creator = context.prodPerson || context.projectManager || "";
    const creatorName = context.prodPersonName || context.projectManagerName || "";
    const planEndTime = String((options && options.planEndTime) || (wbs && wbs.planEndTime) || "");

    return {
      isProjectType: "",
      isLaskTask: "1",
      memo: "",
      confrontId: "",
      nextWkId: context.wkId,
      wbsName: detailName,
      workItemId: String((wbs && wbs.workItemId) || ""),
      majorPersonName: ownerName,
      modifyPerson: "",
      orgId: String((wbs && wbs.orgId) || ""),
      wageLevelCost: "",
      taskResouce: "2",
      modifyTime: "",
      majorPerson: ownerId,
      dingTaskId: "",
      subOrgId: String((wbs && wbs.subOrgId) || ""),
      taskField: "WBS任务",
      taskNo: "",
      extId: "",
      createPersonName: "",
      isConfirmPmo: "",
      finishDesc: "",
      taskDetails: "",
      realEndTime: "",
      processInstanceId: "",
      wageLevelCosts: "",
      createPerson: creator,
      svn: "",
      isNeedDo: "",
      extName: detailName,
      planDate: manualPerson ? "" : String(hours),
      realTime: "",
      finishRate: "",
      actualHour: "",
      isState: "",
      createTime: "",
      grade: "",
      actualDate: "",
      wbsId: String((wbs && wbs.detailId) || ""),
      wkId: "",
      planEndTime: planEndTime,
      projectAttribute: "",
      isConfirmCompletion: "",
      projectName: context.projectName,
      projectId: context.projectId,
      taskId: "",
      createName: creatorName,
      wkStatus: "0",
      _add_: true,
      _id_: Date.now() + Math.floor(Math.random() * 1000000),
      _v_checkbox: "",
      "[object HTMLCollection]": "WBS任务"
    };
  }

  function buildNextExecutionRows(wbsRows, existingRows, context, nextWeek) {
    return wbsPlanModule.buildNextExecutionRows(wbsRows, existingRows, context, nextWeek, {
      logWbsStep: logWbsStep
    });
  }

  function fireInputEvent(el, type) {
    if (!el) {
      return;
    }
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function setNativeInputValue($row, selector, value) {
    const $input = $row.find(selector);
    const input = $input[0];
    $input.val(value);
    if (input) {
      input.value = value;
      input.setAttribute("value", value);
      fireInputEvent(input, "input");
      fireInputEvent(input, "change");
    }
  }

  function setNativeColumnInputValue($row, colIndex, value) {
    const input = $row.children().eq(colIndex).find("input,textarea,select")[0];
    if (!input) {
      warnWbsStep("native column input not found", {
        colIndex: colIndex,
        value: value
      });
      return;
    }
    input.value = value;
    input.setAttribute("value", value);
    fireInputEvent(input, "input");
    fireInputEvent(input, "change");
  }

  function syncNativeNextRow(rowData, $row, sourceRow) {
    const taskField = $row && $row.length ? $row.find("select#taskField")[0] : null;
    if (taskField) {
      $(taskField).val("WBS任务").trigger("change");
      fireInputEvent(taskField, "change");
    }
    rowData.taskField = "WBS任务";
    if ($row && $row.length) {
      $row.find("#wbsName").addClass("validate[required]");

      setNativeInputValue($row, "#wbsName", sourceRow.wbsName || sourceRow.extName || "");
      setNativeInputValue($row, "#wbsId", sourceRow.wbsId || "");
    }
    rowData.wbsName = sourceRow.wbsName || sourceRow.extName || "";
    rowData.wbsId = sourceRow.wbsId || "";

    if ($row && $row.length) {
      setNativeColumnInputValue($row, 4, sourceRow.extName || sourceRow.wbsName || "");
    }
    rowData.extName = sourceRow.extName || sourceRow.wbsName || "";

    if ($row && $row.length) {
      setNativeInputValue($row, "#majorPersonName", sourceRow.majorPersonName || "");
      setNativeInputValue($row, "#majorPerson", sourceRow.majorPerson || "");
    }
    rowData.majorPersonName = sourceRow.majorPersonName || "";
    rowData.majorPerson = sourceRow.majorPerson || "";

    if ($row && $row.length) {
      setNativeColumnInputValue($row, 6, sourceRow.planDate || "");
    }
    rowData.planDate = sourceRow.planDate || "";

    if ($row && $row.length) {
      setNativeColumnInputValue($row, 7, sourceRow.planEndTime || "");
    }
    rowData.planEndTime = sourceRow.planEndTime || "";
    rowData.wkStatus = sourceRow.wkStatus || "0";
    if ($row && $row.length) {
      $row.find("#wkStatus").text(rowData.wkStatus === "0" ? "正常" : "异常");
    }

    Object.keys(sourceRow).forEach(function (key) {
      if (rowData[key] === undefined || rowData[key] === null || rowData[key] === "") {
        rowData[key] = sourceRow[key];
      }
    });
  }

  function findNativeAddedRow($table, dt, beforeNewDataCount, beforeDtCount) {
    const tableId = $table.attr("id") || "WkExecutiongrid_1";
    const newData = $table.data("newData") || [];
    const addedFromNewData = newData.length > beforeNewDataCount
      ? newData[newData.length - 1]
      : null;
    if (addedFromNewData) {
      const $addRows = $("#" + tableId + " tbody tr.add");
      if ($addRows.length) {
        return {
          rowData: addedFromNewData,
          $row: $addRows.last(),
          source: "newData+tr.add"
        };
      }
      return {
        rowData: addedFromNewData,
        $row: $(),
        source: "newData"
      };
    }

    const dtRows = dt.rows().data().toArray();
    if (dtRows.length > beforeDtCount) {
      const rowData = dtRows[dtRows.length - 1];
      const node = dt.row(dtRows.length - 1).node && dt.row(dtRows.length - 1).node();
      return {
        rowData: rowData,
        $row: node ? $(node) : $(),
        source: "dt-last"
      };
    }

    const $lastDomRow = $("#" + tableId + " tbody tr").not(".dataTables_empty").last();
    if ($lastDomRow.length) {
      const rowDataFromDom = dt.row($lastDomRow[0]).data();
      if (rowDataFromDom && rowDataFromDom._add_) {
        return {
          rowData: rowDataFromDom,
          $row: $lastDomRow,
          source: "dom-last-add-data"
        };
      }
    }

    return null;
  }

  async function waitForNativeAddedRow($table, dt, beforeNewDataCount, beforeDtCount) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1500) {
      const found = findNativeAddedRow($table, dt, beforeNewDataCount, beforeDtCount);
      if (found) {
        return found;
      }
      await delay(100);
    }
    return null;
  }

  async function insertRowsWithNativeAddWkPlan(rows) {
    const tableId = "WkExecutiongrid_1";
    const $table = $("#" + tableId);
    const dt = getNativeNextDataTable($table);
    const wkForm = await waitForWkFormJS(["addWkPlan"]);
    logWbsStep("native insert start", {
      tableId: tableId,
      incomingRows: rows.length,
      hasTable: Boolean($table.length),
      hasDt: Boolean(dt),
      hasAddWkPlan: Boolean(wkForm && typeof wkForm.addWkPlan === "function")
    });

    if (!rows.length) {
      warnWbsStep("skip native insert because generated rows is empty", {
        tableId: tableId
      });
      return {
        tableId: tableId,
        insertedRows: [],
        modifyData: DataTablesUtil.data.getModifyData(tableId)
      };
    }

    if (!$table.length || !dt) {
      throw new Error("未找到下周计划表 WkExecutiongrid_1 或 DataTable");
    }
    const beforeNewData = $table.data("newData") || [];
    const beforeDtCount = dt.rows().data().toArray().length;
    const insertedRows = [];

    for (let i = 0; i < rows.length; i += 1) {
      const sourceRow = rows[i];
      const rowBeforeNewDataCount = ($table.data("newData") || []).length;
      const rowBeforeDtCount = dt.rows().data().toArray().length;
      wkForm.addWkPlan();
      const added = await waitForNativeAddedRow($table, dt, rowBeforeNewDataCount, rowBeforeDtCount);
      if (!added || !added.rowData) {
        warnWbsStep("native add row not found after addWkPlan", {
          rowIndex: i,
          beforeNewDataCount: rowBeforeNewDataCount,
          afterNewDataCount: ($table.data("newData") || []).length,
          beforeDtCount: rowBeforeDtCount,
          afterDtCount: dt.rows().data().toArray().length,
          tbodyRowCount: $("#" + tableId + " tbody tr").length,
          addRowCount: $("#" + tableId + " tbody tr.add").length
        });
        throw new Error("页面原生新增下周计划后，未找到新增行");
      }

      syncNativeNextRow(added.rowData, added.$row, sourceRow);
      insertedRows.push(added.rowData);
      logWbsStep("native added row filled", {
        rowIndex: i,
        source: added.source,
        hasDomRow: Boolean(added.$row && added.$row.length),
        extName: added.rowData.extName,
        wbsId: added.rowData.wbsId,
        majorPerson: added.rowData.majorPerson,
        planDate: added.rowData.planDate
      });
    }

    if (typeof dt.draw === "function") {
      dt.draw(false);
    }

    const afterNewData = $table.data("newData") || [];
    const afterDtCount = dt.rows().data().toArray().length;
    const modifyData = DataTablesUtil.data.getModifyData(tableId);
    logWbsStep("native insert done", {
      tableId: tableId,
      beforeNewDataCount: beforeNewData.length,
      afterNewDataCount: afterNewData.length,
      beforeDtCount: beforeDtCount,
      afterDtCount: afterDtCount,
      insertedCount: insertedRows.length,
      modifyData: modifyData,
      insertedSample: insertedRows.slice(0, 5).map(function (row) {
        return {
          extName: row.extName,
          wbsId: row.wbsId,
          majorPerson: row.majorPerson,
          majorPersonName: row.majorPersonName,
          planDate: row.planDate,
          planEndTime: row.planEndTime,
          _add_: row._add_
        };
      })
    });

    return {
      tableId: tableId,
      insertedRows: insertedRows,
      modifyData: modifyData
    };
  }

  function getMissingMajorPersonRows(rows) {
    return rows.filter(function (row) {
      return !String((row && row.majorPerson) || "").trim();
    });
  }

  async function fillNextWeekWbsPlan(context) {
    if (!context.wkId) {
      throw new Error("未找到当前周报 wkId，无法填写下周 WBS 明细");
    }

    const $ = window.jQuery;
    logWbsStep("fill next week WBS plan start", {
      context: {
        wkId: context.wkId,
        projectId: context.projectId,
        projectName: context.projectName,
        weekStart: context.weekStart,
        weekEnd: context.weekEnd
      }
    });
    const $table = $("#WkExecutiongrid_1");
    const dt = getNativeNextDataTable($table);
    if (!$table.length || !dt) {
      warnWbsStep("next execution native DataTable not found", {
        tableId: "WkExecutiongrid_1",
        hasTable: Boolean($table.length),
        hasDt: Boolean(dt)
      });
      throw new Error("未找到下周计划表 WkExecutiongrid_1，无法写入 executionNext");
    }

    const nextWeek = getNextWeekInfo(context);
    logWbsStep("next week range resolved", {
      start: nextWeek.startText,
      end: nextWeek.endText,
      workdays: nextWeek.workdays.map(formatDate),
      hasHolidayTable: nextWeek.hasHolidayTable
    });
    if (!nextWeek.hasHolidayTable) {
      console.warn("[cw-batch-work] 未内置 " + nextWeek.start.getFullYear() + " 年完整节假日表，下周工作日按周一至周五计算");
    }

    post(
      MESSAGE_TYPES.WORK_RUNNING,
      "查询下周 WBS 计划 " + nextWeek.startText + " 至 " + nextWeek.endText
    );
    const wbsRows = await fetchProjectPlanDetails(context, {
      startTime: nextWeek.startText,
      endTime: nextWeek.endText
    });
    const existingRows = await fetchExistingNextExecutions(context.wkId);
    logWbsStep("source rows loaded", {
      wbsRows: wbsRows.length,
      existingNextRows: existingRows.length
    });
    const generatedRows = buildNextExecutionRows(wbsRows, existingRows, context, nextWeek);
    const missingMajorPersonRows = getMissingMajorPersonRows(generatedRows);
    logWbsStep("generated executionNext rows", {
      count: generatedRows.length,
      missingMajorPersonCount: missingMajorPersonRows.length,
      sample: generatedRows.slice(0, 10).map(function (row) {
        return {
          extName: row.extName,
          wbsId: row.wbsId,
          majorPerson: row.majorPerson,
          majorPersonName: row.majorPersonName,
          planDate: row.planDate
        };
      }),
      missingMajorPersonSample: missingMajorPersonRows.slice(0, 10).map(function (row) {
        return {
          extName: row.extName,
          wbsId: row.wbsId,
          majorPerson: row.majorPerson,
          majorPersonName: row.majorPersonName,
          planDate: row.planDate
        };
      })
    });

    const insertResult = await insertRowsWithNativeAddWkPlan(generatedRows);
    const tableId = insertResult.tableId;
    const modifyData = insertResult.modifyData;
    logWbsStep("executionNext modifyData before save", {
      tableId: tableId,
      insertCount: modifyData && modifyData.insert ? modifyData.insert.length : null,
      updateCount: modifyData && modifyData.update ? modifyData.update.length : null,
      deleteCount: modifyData && modifyData.delete ? modifyData.delete.length : null,
      modifyData: modifyData
    });

    return {
      insertCount: generatedRows.length,
      wbsCount: wbsRows.length,
      existingCount: existingRows.length,
      missingMajorPersonCount: missingMajorPersonRows.length,
      missingMajorPersonRows: missingMajorPersonRows,
      insertedRows: insertResult.insertedRows,
      tableId: tableId,
      modifyData: modifyData
    };
  }

  function setInputValue(input, value) {
    if (!input) {
      return;
    }
    input.value = value;
    input.setAttribute("value", value);
  }

  function setSelectValue(select, value) {
    if (!select) {
      return false;
    }
    select.value = value;
    window.jQuery(select).val(value);
    return true;
  }

  function getColumnInputValue(tr, colIndex) {
    const input = tr && tr.cells && tr.cells[colIndex]
      ? tr.cells[colIndex].querySelector("input,textarea,select")
      : null;
    return input && input.value != null ? String(input.value).trim() : "";
  }

  function getCurrentWeekExecutionTableState() {
    const $ = window.jQuery;
    const tableId = "WkExecutiongrid";
    const $table = $("#" + tableId);
    const dt = $table.data("dataTablesDT");

    if (!$table.length || !dt) {
      throw new Error("未找到 WkExecutiongrid 或 dataTablesDT");
    }

    const changedClassName = DataTablesUtil.const.CHANGED_CLASS_NAME || "changed";
    const changeStoreName = DataTablesUtil.const.DATA_STORE_CHG || "changeData";
    const pk = $table.attr("data-pk-column") || "extId";

    const rows = dt.rows();
    const dataArr = rows.data().toArray();
    const nodeArr = rows.nodes().toArray();
    const changeData = $table.data(changeStoreName) || [];
    logWbsStep("current week execution table loaded", {
      tableId: tableId,
      rows: dataArr.length,
      nodeRows: nodeArr.length,
      changeStoreRows: changeData.length,
      pk: pk
    });

    return {
      tableId: tableId,
      $table: $table,
      changedClassName: changedClassName,
      changeStoreName: changeStoreName,
      pk: pk,
      dataArr: dataArr,
      nodeArr: nodeArr,
      changeData: changeData,
      changedPkSet: new Set(changeData.map(function (x) {
        return x && x[pk];
      }).filter(Boolean))
    };
  }

  async function loadWeeklyDailyActual(context, weeklyRows) {
    let dailyActualResolver = {
      available: false,
      error: "notLoaded"
    };
    let dailyActualResult = {
      rows: [],
      rawRows: [],
      stats: null
    };

    post(MESSAGE_TYPES.WORK_RUNNING, "查询本周日报实际工时");
    try {
      dailyActualResult = await fetchWeeklyDailyActualRows(context);
      dailyActualResolver = createDailyActualResolver(dailyActualResult.rows, weeklyRows);
      logWbsStep("weekly daily actual hours loaded", {
        stats: dailyActualResult.stats,
        usableRows: dailyActualResult.rows.length,
        rawRows: dailyActualResult.rawRows.length,
        sample: dailyActualResult.rows.slice(0, 10).map(function (row) {
          return {
            date: row.date,
            wbsId: row.wbsId,
            taskOwner: row.taskOwner,
            userFullname: row.userFullname,
            taskNames: row.taskNames,
            realHour: row.realHour,
            realFinishRate: row.realFinishRate,
            dailyEndTime: row.dailyEndTime,
            status: row.status
          };
        })
      });
    } catch (error) {
      dailyActualResolver = {
        available: false,
        error: error && error.message ? error.message : String(error)
      };
      warnWbsStep("fetch weekly daily actual hours failed, fallback to planDate", {
        error: dailyActualResolver.error
      });
    }

    return {
      dailyActualResolver: dailyActualResolver,
      dailyActualResult: dailyActualResult
    };
  }

  function logUnmatchedWeeklyDailyRows(dailyActualResolver) {
    if (!dailyActualResolver || !dailyActualResolver.available) {
      return;
    }

    const unmatchedDailyRows = dailyActualResolver.dailyRows.filter(function (row) {
      return !dailyActualResolver.usedDailyKeys.has(row.key);
    });
    logWbsStep("weekly daily actual hours unmatched rows", {
      count: unmatchedDailyRows.length,
      sample: unmatchedDailyRows.slice(0, 20).map(function (row) {
        return {
          date: row.date,
          wbsId: row.wbsId,
          taskOwner: row.taskOwner,
          userFullname: row.userFullname,
          taskNames: row.taskNames,
          realHour: row.realHour,
          realFinishRate: row.realFinishRate,
          dailyEndTime: row.dailyEndTime,
          status: row.status
        };
      })
    });
  }

  function applyCurrentWeekExecutionPlans(tableState, dailyActualResolver) {
    const result = [];

    tableState.dataArr.forEach(function (rowData, i) {
      if (!rowData) {
        return;
      }

      const tr = tableState.nodeArr[i];
      const planDate = rowData.planDate != null && rowData.planDate !== ""
        ? String(rowData.planDate)
        : "";
      const planEndTime = normalizeMatchText(rowData.planEndTime) ||
        getColumnInputValue(tr, 7) ||
        normalizeMatchText(rowData.realEndTime);
      const actualTime = resolveDailyActualHours(rowData, planDate, dailyActualResolver);
      const finishRate = resolveDailyFinishRate(rowData, dailyActualResolver);
      const realEndTime = resolveDailyRealEndTime(rowData, planEndTime, dailyActualResolver);
      const executionPlan = buildCurrentWeekExecutionPlan({
        rowData: rowData,
        rowNumber: i + 1,
        planDate: planDate,
        actualTime: actualTime,
        finishRate: finishRate,
        realEndTime: realEndTime
      });
      const nextValues = executionPlan.nextValues;

      if (!executionPlan.hasChanged) {
        result.push(executionPlan.summaryRow);
        return;
      }

      Object.assign(rowData, nextValues);

      rowData["6"] = nextValues.finishRate;
      rowData["7"] = nextValues.realEndTime;
      rowData["10"] = nextValues.realTime;
      rowData["12"] = nextValues.isNeedDo;
      rowData["13"] = nextValues.memo;
      rowData["16"] = nextValues.isState;

      if (tr && tr.cells) {
        setInputValue(tr.cells[6] && tr.cells[6].querySelector("input"), nextValues.finishRate);
        setInputValue(tr.cells[7] && tr.cells[7].querySelector("input"), nextValues.realEndTime);
        setInputValue(tr.cells[10] && tr.cells[10].querySelector("input"), nextValues.realTime);
        setSelectValue(tr.cells[12] && tr.cells[12].querySelector("select"), nextValues.isNeedDo);
        setInputValue(tr.cells[13] && tr.cells[13].querySelector("input,textarea"), nextValues.memo);
        setSelectValue(tr.cells[16] && tr.cells[16].querySelector("select"), nextValues.isState);

        tr.classList.add(tableState.changedClassName);
      }

      const rowPk = rowData[tableState.pk];
      if (rowPk && !tableState.changedPkSet.has(rowPk)) {
        tableState.changeData.push(rowData);
        tableState.changedPkSet.add(rowPk);
      }

      result.push(executionPlan.summaryRow);
    });

    logUnmatchedWeeklyDailyRows(dailyActualResolver);
    tableState.$table.data(tableState.changeStoreName, tableState.changeData);

    const updateModifyData = DataTablesUtil.data.getModifyData(tableState.tableId);
    const updateCount = updateModifyData && updateModifyData.update ? updateModifyData.update.length : 0;

    console.table(result);
    logWbsStep("current week execution modifyData before WBS", {
      updateCount: updateCount,
      insertCount: updateModifyData && updateModifyData.insert ? updateModifyData.insert.length : null,
      deleteCount: updateModifyData && updateModifyData.delete ? updateModifyData.delete.length : null,
      modifyData: updateModifyData
    });

    return {
      result: result,
      updateModifyData: updateModifyData,
      updateCount: updateCount
    };
  }

  async function generateWeeklySummaryBeforeCurrentWeekSave(context, dailyActualResult, options) {
    post(MESSAGE_TYPES.WORK_RUNNING, "基于本次日报数据生成周报总结");
    try {
      const targetField = findCurrWkResultField();
      if (!targetField) {
        throw new Error("未找到“本周执行情况”文本框");
      }
      const summaryRows = Array.isArray(dailyActualResult.rawRows) ? dailyActualResult.rawRows : [];
      const dailyTasks = createWeeklyTaskDetailsFromRows(summaryRows, context);
      logWbsStep("weekly summary task details extracted from shared daily rows", {
        rawRows: summaryRows.length,
        taskCount: dailyTasks.length,
        sample: dailyTasks.slice(0, 10)
      });
      const summaryResult = await generateWeeklySummaryWithTasks(context, dailyTasks, targetField, {
        progressType: MESSAGE_TYPES.WORK_RUNNING,
        skipSave: true
      });
      logWbsStep("weekly summary generated before current week save", {
        taskCount: summaryResult.taskCount,
        summaryLength: String(summaryResult.summaryText || "").length
      });
      return summaryResult;
    } catch (error) {
      const canSkipMissingConfig = !options || options.skipMissingAiConfig !== false;
      if (canSkipMissingConfig && isMissingAiConfigError(error)) {
        const message = "未配置大模型，已跳过周报总结";
        warnWbsStep("skip weekly summary because AI config is missing", {
          error: error && error.message ? error.message : String(error)
        });
        post(MESSAGE_TYPES.WORK_RUNNING, message);
        return createWeeklySummaryResult("", 0, "");
      }
      warnWbsStep("weekly summary generation failed before current week save", {
        error: error && error.message ? error.message : String(error)
      });
      throw error;
    }
  }

  async function saveCurrentWeekIfNeeded(wkForm, updateCount, summaryResult, updateModifyData) {
    const shouldSaveCurrentWeek = updateCount > 0 || Boolean(summaryResult && summaryResult.summaryText);
    if (shouldSaveCurrentWeek) {
      logWbsStep("current week saveAll start after summary", {
        updateCount: updateCount,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        modifyData: updateModifyData
      });
      wkForm.saveAll();
      logWbsStep("current week saveAll called after summary");
      await delay(800);
      return true;
    }

    logWbsStep("skip current week save because no update data and no weekly summary");
    return false;
  }

  async function resolveBatchContext(mode) {
    logWbsStep(getRunModeLabel(mode) + " start", {
      mode: mode,
      href: window.location.href,
      webapp: getWebapp(),
      baseUrl: getBaseUrl()
    });

    const context = await getWeeklyContext();
    logWbsStep("weekly context resolved", {
      wkId: context.wkId,
      projectId: context.projectId,
      projectName: context.projectName,
      weekDate: context.weekDate,
      weekStart: context.weekStart,
      weekEnd: context.weekEnd,
      prodPerson: context.prodPerson,
      prodPersonName: context.prodPersonName,
      projectManager: context.projectManager,
      projectManagerName: context.projectManagerName
    });
    return context;
  }

  const batchWorkRunner = createBatchWorkRunner({
    waitForForm: function () {
      return waitForWkFormJS(["saveAll"]);
    },
    resolveContext: resolveBatchContext,
    getCurrentWeekTable: getCurrentWeekExecutionTableState,
    loadDailyActual: loadWeeklyDailyActual,
    applyCurrentWeekPlans: applyCurrentWeekExecutionPlans,
    generateSummary: generateWeeklySummaryBeforeCurrentWeekSave,
    saveCurrentWeek: saveCurrentWeekIfNeeded,
    fillNextWeek: fillNextWeekWbsPlan,
    getExecutionModifyData: function (tableId) {
      return DataTablesUtil.data.getModifyData(tableId);
    },
    postRunning: function (message) {
      post(MESSAGE_TYPES.WORK_RUNNING, message);
    },
    log: logWbsStep,
    warn: warnWbsStep
  });

  async function runSummaryOnly() {
    const wkForm = await waitForWkFormJS(["saveAll"]);
    const context = await resolveBatchContext(MODE_SUMMARY);
    const dailyActual = await loadWeeklyDailyActual(context, []);
    const summaryResult = await generateWeeklySummaryBeforeCurrentWeekSave(
      context,
      dailyActual.dailyActualResult,
      {
        skipMissingAiConfig: false
      }
    );
    const saved = await saveCurrentWeekIfNeeded(wkForm, 0, summaryResult, null);
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
    const wkForm = await waitForWkFormJS(["saveAll"]);
    const context = await resolveBatchContext(MODE_HOURS);
    const currentWeekTable = getCurrentWeekExecutionTableState();
    const dailyActual = await loadWeeklyDailyActual(context, currentWeekTable.dataArr);
    const currentWeekPlan = applyCurrentWeekExecutionPlans(
      currentWeekTable,
      dailyActual.dailyActualResolver
    );
    const saved = await saveCurrentWeekIfNeeded(
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
    const context = await resolveBatchContext(MODE_PLAN);
    post(MESSAGE_TYPES.WORK_RUNNING, "生成下周 WBS 计划明细");
    const nextPlanResult = await fillNextWeekWbsPlan(context);
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

  async function runBatchWork(mode) {
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

    const wkForm = await waitForWkFormJS(["saveAll"]);
    const context = await resolveBatchContext(MODE_ALL);
    const currentWeekTable = getCurrentWeekExecutionTableState();
    const dailyActual = await loadWeeklyDailyActual(context, currentWeekTable.dataArr);
    const currentWeekPlan = applyCurrentWeekExecutionPlans(
      currentWeekTable,
      dailyActual.dailyActualResolver
    );
    const summaryResult = await generateWeeklySummaryBeforeCurrentWeekSave(
      context,
      dailyActual.dailyActualResult
    );
    const shouldSaveCurrentWeek = await saveCurrentWeekIfNeeded(
      wkForm,
      currentWeekPlan.updateCount,
      summaryResult,
      currentWeekPlan.updateModifyData
    );

    post(MESSAGE_TYPES.WORK_RUNNING, "生成下周 WBS 计划明细");
    const nextPlanResult = await fillNextWeekWbsPlan(context);
    const finalModifyData = {
      execution: DataTablesUtil.data.getModifyData(currentWeekTable.tableId),
      executionNext: nextPlanResult.modifyData
    };

    if (currentWeekPlan.updateCount <= 0 && nextPlanResult.insertCount <= 0) {
      warnWbsStep("skip save because no update/insert data", {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        nextPlan: nextPlanResult
      });
      return {
        updateCount: 0,
        nextInsertCount: 0,
        currentSaveTriggered: shouldSaveCurrentWeek,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        result: currentWeekPlan.result,
        skipped: true
      };
    }

    if (nextPlanResult.missingMajorPersonCount > 0) {
      warnWbsStep("skip executionNext save because missing majorPerson", {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
        missingMajorPersonRows: nextPlanResult.missingMajorPersonRows.slice(0, 20)
      });
      return {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
        currentSaveTriggered: shouldSaveCurrentWeek,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        nextPlan: nextPlanResult,
        result: currentWeekPlan.result,
        skipped: false,
        nextSaveSkipped: true
      };
    }

    if (nextPlanResult.insertCount <= 0) {
      logWbsStep("skip executionNext save because no generated insert rows", {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: nextPlanResult.insertCount
      });
      return {
        updateCount: currentWeekPlan.updateCount,
        nextInsertCount: 0,
        currentSaveTriggered: shouldSaveCurrentWeek,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        nextPlan: nextPlanResult,
        result: currentWeekPlan.result,
        skipped: false,
        nextSaveSkipped: false
      };
    }

    logWbsStep("executionNext saveAll start", {
      updateCount: currentWeekPlan.updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      finalModifyData: finalModifyData
    });
    wkForm.saveAll();
    logWbsStep("executionNext saveAll called");

    return {
      updateCount: currentWeekPlan.updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      currentSaveTriggered: shouldSaveCurrentWeek,
      weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
      nextPlan: nextPlanResult,
      result: currentWeekPlan.result,
      skipped: false,
      nextSaveSkipped: false
    };
  }

  function getModeRunningMessage(mode) {
    if (mode === MODE_SUMMARY) {
      return "仅填周报中";
    }
    if (mode === MODE_HOURS) {
      return "仅填工时中";
    }
    if (mode === MODE_PLAN) {
      return "仅填计划中";
    }
    return "一键报工中";
  }

  function postModeDone(result) {
    if (result.mode === MODE_SUMMARY) {
      post(MESSAGE_TYPES.WORK_DONE, result.currentSaveTriggered ? "周报总结已生成并保存" : "未生成可保存的周报总结");
      return;
    }
    if (result.mode === MODE_HOURS) {
      post(
        MESSAGE_TYPES.WORK_DONE,
        result.currentSaveTriggered
          ? "本周工时已填写并保存，update " + result.updateCount + " 条"
          : "没有可保存的本周工时变更"
      );
      return;
    }
    if (result.mode === MODE_PLAN) {
      if (result.nextInsertCount <= 0) {
        post(MESSAGE_TYPES.WORK_DONE, "没有可填入的下周计划，未自动保存");
        return;
      }
      const missingText = result.missingMajorPersonCount > 0
        ? "，其中 " + result.missingMajorPersonCount + " 条缺少人员"
        : "";
      post(
        MESSAGE_TYPES.WORK_DONE,
        "已填下周计划 " + result.nextInsertCount + " 行" + missingText + "，未自动保存，请检查后手动保存"
      );
      return;
    }

    if (result.skipped) {
      if (result.currentSaveTriggered) {
        post(MESSAGE_TYPES.WORK_DONE, "本周报工/周报总结已保存；没有可插入的下周计划");
      } else {
        post(MESSAGE_TYPES.WORK_DONE, "没有可提交的 update/insert 数据");
      }
      return;
    }

    if (result.nextSaveSkipped) {
      const currentMessage = result.currentSaveTriggered ? "本周报工已保存；" : "";
      post(
        MESSAGE_TYPES.WORK_DONE,
        currentMessage + "下周计划已填入 " + result.nextInsertCount + " 条，其中 " + result.missingMajorPersonCount + " 条缺少人员，需手工保存"
      );
      return;
    }

    post(MESSAGE_TYPES.WORK_DONE, "已触发保存，update " + result.updateCount + " 条，下周计划 insert " + result.nextInsertCount + " 条");
  }

  async function run(mode) {
    const normalizedMode = normalizeRunMode(mode);
    if (running) {
      post(MESSAGE_TYPES.WORK_RUNNING, "已有" + getRunModeLabel(normalizedMode) + "任务运行中");
      return;
    }

    running = true;

    try {
      post(MESSAGE_TYPES.WORK_RUNNING, getModeRunningMessage(normalizedMode));
      const result = await batchWorkRunner.run(normalizedMode);
      postModeDone(result);
    } catch (error) {
      post(MESSAGE_TYPES.WORK_ERROR, getRunModeLabel(normalizedMode) + "失败: " + (error && error.message ? error.message : String(error)));
      throw error;
    } finally {
      running = false;
    }
  }

  async function runToolbarAction(action) {
    if (action !== "save") {
      throw new Error("未知工具栏动作: " + String(action || ""));
    }

    post(MESSAGE_TYPES.TOOLBAR_RUNNING, "保存中...");
    const wkForm = await waitForWkFormJS(["saveAll"]);
    wkForm.saveAll();
    logWbsStep("toolbar fallback action called", {
      action: "save",
      method: "saveAll"
    });
    post(MESSAGE_TYPES.TOOLBAR_DONE, "保存完成");
  }

  function handleMessage(event) {
    const parsed = parseWindowMessage(event, {
      windowRef: window,
      source: SOURCE_CONTENT,
      types: [
        MESSAGE_TYPES.WORK_START,
        MESSAGE_TYPES.TOOLBAR_ACTION,
        MESSAGE_TYPES.AI_STATUS,
        MESSAGE_TYPES.AI_REASONING,
        MESSAGE_TYPES.AI_CHUNK,
        MESSAGE_TYPES.AI_DONE,
        MESSAGE_TYPES.AI_ERROR,
        MESSAGE_TYPES.CACHE_SET_RESULT
      ]
    });
    if (!parsed.ok) {
      return;
    }
    const data = parsed.value;

    if (data.type === MESSAGE_TYPES.WORK_START) {
      run(data.mode).catch(function (error) {
        console.error("[cw-batch-work]", error);
      });
      return;
    }

    if (data.type === MESSAGE_TYPES.TOOLBAR_ACTION) {
      runToolbarAction(data.action).catch(function (error) {
        const message = error && error.message ? error.message : String(error);
        console.error("[cw-batch-work][toolbar]", error);
        post(MESSAGE_TYPES.TOOLBAR_ERROR, message);
      });
      return;
    }

    if (!pendingAiRequest || data.requestId !== pendingAiRequest.requestId) {
      return;
    }

    if (data.type === MESSAGE_TYPES.AI_STATUS) {
      const message = data.message || "模型请求处理中";
      console.info("[cw-weekly-summary-ai] page status", {
        requestId: data.requestId,
        message: message
      });
      post(pendingAiRequest.progressType || MESSAGE_TYPES.WORK_RUNNING, message, {
        requestId: data.requestId
      });
      return;
    }

    if (data.type === MESSAGE_TYPES.AI_REASONING) {
      console.info("[cw-weekly-summary-ai] page reasoning", {
        requestId: data.requestId,
        index: data.index,
        length: String(data.text || "").length,
        text: data.text || ""
      });
      return;
    }

    if (data.type === MESSAGE_TYPES.AI_CHUNK) {
      const text = appendAiSummaryChunk(pendingAiRequest, data.text);
      console.info("[cw-weekly-summary-ai] page chunk", {
        requestId: data.requestId,
        chunkLength: String(data.text || "").length,
        totalLength: text.length,
        chunkText: data.text || "",
        totalText: text
      });
      setFieldValue(pendingAiRequest.targetField, text);
      return;
    }

    if (data.type === MESSAGE_TYPES.AI_DONE) {
      const request = pendingAiRequest;
      pendingAiRequest = null;
      console.info("[cw-weekly-summary-ai] page done", {
        requestId: data.requestId,
        totalLength: request.text.length
      });
      request.resolve(request.text);
      return;
    }

    if (data.type === MESSAGE_TYPES.AI_ERROR) {
      const request = pendingAiRequest;
      pendingAiRequest = null;
      console.error("[cw-weekly-summary-ai] page error", {
        requestId: data.requestId,
        message: getAiSummaryErrorMessage(data)
      });
      request.reject(new Error(getAiSummaryErrorMessage(data)));
    }
  }

  return {
    run: run,
    runToolbarAction: runToolbarAction,
    handleMessage: handleMessage
  };
}

export function installBatchWorkPage(windowRef = window) {
  if (windowRef.__cwBatchWorkPageLoaded) {
    return null;
  }
  windowRef.__cwBatchWorkPageLoaded = true;
  const automation = createBatchWorkAutomation({
    window: windowRef,
    document: windowRef.document,
    fetch: windowRef.fetch.bind(windowRef),
    DataTablesUtil: windowRef.DataTablesUtil,
    Event: windowRef.Event,
    performance: windowRef.performance
  });
  windowRef.addEventListener("message", automation.handleMessage);
  return automation;
}
