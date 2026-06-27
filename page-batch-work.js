(function () {
  if (window.__cwBatchWorkPageLoaded) {
    return;
  }
  window.__cwBatchWorkPageLoaded = true;

  const SOURCE_PAGE = "cw-batch-work-page";
  const SOURCE_CONTENT = "cw-batch-work-content";

  let running = false;
  let summaryRunning = false;
  let pendingAiRequest = null;

  const summaryConfig = {
    pageSize: 100,
    maxPages: 250,
    pageConcurrency: 2
  };

  function post(type, message, extra) {
    window.postMessage(
      Object.assign(
        {
          source: SOURCE_PAGE,
          type: type,
          message: message
        },
        extra || {}
      ),
      "*"
    );
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

  function getWebapp() {
    const raw = String(window.localStorage.getItem("webapp") || "/jxpmo").trim();
    if (!raw || raw === "/") {
      return "";
    }
    return raw.charAt(0) === "/" ? raw.replace(/\/+$/, "") : "/" + raw.replace(/\/+$/, "");
  }

  function getBaseUrl() {
    return window.location.origin + getWebapp();
  }

  async function assertOk(response, label) {
    if (response.ok) {
      return response;
    }
    const text = await response.text().catch(function () {
      return "";
    });
    throw new Error(label + " failed: HTTP " + response.status + " " + response.statusText + " " + text);
  }

  async function fetchJson(url, label) {
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest"
        },
        cache: "no-store"
      });
    } catch (error) {
      throw new Error(label + " failed: " + (error && error.message ? error.message : String(error)) + " url=" + url);
    }
    await assertOk(response, label);
    return response.json();
  }

  function readControlValue(names) {
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const selectors = [
        "[name='" + name + "']",
        "#" + name,
        "[data-name='" + name + "']"
      ];
      for (let j = 0; j < selectors.length; j += 1) {
        const el = document.querySelector(selectors[j]);
        if (el && el.value != null && String(el.value).trim() !== "") {
          return String(el.value).trim();
        }
        if (el && el.textContent != null && String(el.textContent).trim() !== "") {
          return String(el.textContent).trim();
        }
      }
    }
    return "";
  }

  function parseWkIdFromLocation() {
    const text = window.location.href + " " + window.location.hash;
    const match = text.match(/\/WkReportService\/id\/([^/?#\s]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function parseDate(value) {
    const match = String(value || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) {
      return null;
    }
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function mondayOf(date) {
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(date, diff);
  }

  function normalizeWeekRange(weekDate) {
    const matches = String(weekDate || "").match(/\d{4}-\d{1,2}-\d{1,2}/g) || [];
    const first = matches[0] ? parseDate(matches[0]) : null;
    const second = matches[1] ? parseDate(matches[1]) : null;

    if (first && second && first.getDay() === 0 && second.getDay() === 6) {
      return {
        start: addDays(first, 1),
        end: addDays(second, 1)
      };
    }

    const base = first || new Date();
    const start = mondayOf(base);
    return {
      start: start,
      end: addDays(start, 6)
    };
  }

  function normalizeWeeklyDetail(data) {
    if (Array.isArray(data)) {
      return data[0] || null;
    }
    if (data && Array.isArray(data.rows)) {
      return data.rows[0] || null;
    }
    if (data && Array.isArray(data.data)) {
      return data.data[0] || null;
    }
    if (data && data.data && typeof data.data === "object") {
      return data.data;
    }
    if (data && data.result && typeof data.result === "object") {
      return data.result;
    }
    return data || null;
  }

  async function fetchWeeklyById(wkId) {
    const params = new URLSearchParams({
      queryType: "all",
      queryName: "queryByProjectInfo",
      wkId: String(wkId)
    });

    const data = await fetchJson(
      getBaseUrl() + "/rest/project/queryByProjectInfosService/query?" + params.toString(),
      "fetch weekly " + wkId
    );
    return normalizeWeeklyDetail(data);
  }

  async function fetchWeeklyRowsByProject(projectId) {
    const rows = [];
    let page = 1;

    while (page <= 4) {
      const params = new URLSearchParams({
        queryName: "queryByProjectId",
        filterQuery: "true",
        queryType: "page",
        projectId: String(projectId),
        draw: String(page),
        page: String(page),
        start: String((page - 1) * 25),
        length: "25",
        rows: "25"
      });
      const data = await fetchJson(
        getBaseUrl() + "/rest/project/WkReportService/query?" + params.toString(),
        "fetch weekly reports page " + page
      );
      const pageRows = Array.isArray(data && data.rows) ? data.rows : [];
      rows.push.apply(rows, pageRows);
      const pageCount = Number(data && data.pageCount) || 0;
      if (!pageCount || page >= pageCount || !pageRows.length) {
        break;
      }
      page += 1;
    }

    return rows;
  }

  async function getWeeklyContext() {
    const locationWkId = parseWkIdFromLocation();
    const wkId = readControlValue(["wkId"]) || locationWkId;
    let projectId = readControlValue(["projectId", "queryProjectId"]);
    let row = null;

    if (wkId) {
      row = await fetchWeeklyById(wkId).catch(function () {
        return null;
      });
    }

    if (!row && projectId) {
      const rows = await fetchWeeklyRowsByProject(projectId);
      row =
        rows.find(function (item) {
          return wkId && String(item && item.wkId) === String(wkId);
        }) ||
        rows.find(function (item) {
          return String(item && item.status) === "10";
        }) ||
        rows[0] ||
        null;
    }

    projectId = projectId || String((row && row.projectId) || "");
    if (!projectId) {
      throw new Error("未找到当前项目 projectId");
    }

    const weekDate = readControlValue(["weekDate", "wkDate"]) || String((row && row.weekDate) || "");
    const range = normalizeWeekRange(weekDate);

    return {
      wkId: wkId || String((row && row.wkId) || ""),
      projectId: projectId,
      projectName: readControlValue(["projectName"]) || String((row && row.projectName) || ""),
      prodPerson: readControlValue(["prodPerson"]) || String((row && row.prodPerson) || ""),
      prodPersonName: readControlValue(["prodPersonName"]) || String((row && row.prodPersonName) || ""),
      projectManager: readControlValue(["projectManager"]) || String((row && row.projectManager) || ""),
      projectManagerName: readControlValue(["projectManagerName"]) || String((row && row.projectManagerName) || ""),
      weekDate: weekDate,
      weekStart: formatDate(range.start),
      weekEnd: formatDate(range.end),
      startDate: range.start,
      endDate: range.end
    };
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

  async function fetchWeeklyTaskDetails(context) {
    const seen = new Set();
    const result = [];

    const firstData = await fetchTaskDetailPage(context.projectId, 1);
    const firstRows = Array.isArray(firstData && firstData.rows) ? firstData.rows : [];
    appendWeeklyTaskRows(firstRows, context, seen, result);

    const pageCount = getTaskDetailPageCount(firstData);
    if (!firstRows.length || pageCount <= 1 || pageHasRowsBeforeWeek(firstRows, context)) {
      result.sort(function (a, b) {
        return (a.date + a.userFullname).localeCompare(b.date + b.userFullname, "zh-CN");
      });
      return result;
    }

    let nextPage = 2;
    while (nextPage <= pageCount) {
      const batch = [];
      while (nextPage <= pageCount && batch.length < summaryConfig.pageConcurrency) {
        batch.push(nextPage);
        nextPage += 1;
      }

      post(
        "CW_WEEKLY_SUMMARY_PROGRESS",
        "并发拉取日报页 " + batch[0] + "-" + batch[batch.length - 1] + " / " + pageCount
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
        appendWeeklyTaskRows(rows, context, seen, result);
        if (pageHasRowsBeforeWeek(rows, context)) {
          shouldStop = true;
        }
      });

      if (shouldStop) {
        break;
      }
    }

    result.sort(function (a, b) {
      return (a.date + a.userFullname).localeCompare(b.date + b.userFullname, "zh-CN");
    });

    return result;
  }

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

  async function getSummaryCache(cacheKey) {
    const response = await requestContentBridge("CW_WEEKLY_SUMMARY_CACHE_GET", {
      key: cacheKey
    });
    return response.cache || null;
  }

  async function setSummaryCache(cacheKey, value) {
    await requestContentBridge("CW_WEEKLY_SUMMARY_CACHE_SET", {
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

  function requestAiSummary(userPrompt, targetField) {
    return new Promise(function (resolve, reject) {
      const requestId = String(Date.now()) + "-" + String(Math.random()).slice(2);
      pendingAiRequest = {
        requestId: requestId,
        text: "",
        targetField: targetField,
        resolve: resolve,
        reject: reject
      };

      post("CW_WEEKLY_SUMMARY_AI_REQUEST", "请求大模型", {
        requestId: requestId,
        userPrompt: userPrompt
      });
    });
  }

  function saveWeeklySummary(summaryText, targetField) {
    setFieldValue(targetField, summaryText);

    if (window.WkFormJS && typeof window.WkFormJS.saveAll === "function") {
      window.WkFormJS.saveAll();
      return;
    }

    throw new Error("未找到 WkFormJS.saveAll，无法自动保存周报");
  }

  async function runWeeklySummary(options) {
    if (summaryRunning) {
      post("CW_WEEKLY_SUMMARY_RUNNING", "已有周报总结任务运行中");
      return;
    }

    summaryRunning = true;
    const forceRefresh = Boolean(options && options.forceRefresh);

    try {
      post("CW_WEEKLY_SUMMARY_RUNNING", "定位本周执行情况文本框");
      const targetField = findCurrWkResultField();
      if (!targetField) {
        throw new Error("未找到“本周执行情况”文本框");
      }
      setFieldValue(targetField, "");

      post("CW_WEEKLY_SUMMARY_PROGRESS", "读取当前周报信息");
      const context = await getWeeklyContext();
      const cacheKey = createSummaryCacheKey(context);
      let dailyTasks = null;
      let userPrompt = "";
      let cache = null;

      if (!forceRefresh) {
        cache = await getSummaryCache(cacheKey).catch(function () {
          return null;
        });
      }

      if (
        cache &&
        cache.userPrompt &&
        cache.weekStart === context.weekStart &&
        cache.weekEnd === context.weekEnd
      ) {
        userPrompt = String(cache.userPrompt);
        post(
          "CW_WEEKLY_SUMMARY_PROGRESS",
          "使用缓存日报数据，共 " + Number(cache.dailyTaskCount || 0) + " 条；按住 Shift 点击可重新抓取"
        );
      } else {
        post(
          "CW_WEEKLY_SUMMARY_PROGRESS",
          "拉取 " + context.weekStart + " 至 " + context.weekEnd + " 的日报"
        );
        dailyTasks = await fetchWeeklyTaskDetails(context);
        if (!dailyTasks.length) {
          throw new Error("未找到本周 taskDetail 日报内容");
        }

        userPrompt = createUserPrompt(context, dailyTasks);
        await setSummaryCache(cacheKey, {
          cacheKey: cacheKey,
          wkId: context.wkId,
          projectId: context.projectId,
          projectName: context.projectName,
          weekStart: context.weekStart,
          weekEnd: context.weekEnd,
          dailyTaskCount: dailyTasks.length,
          userPrompt: userPrompt,
          cachedAt: new Date().toISOString()
        }).catch(function (error) {
          console.warn("[cw-weekly-summary] cache write failed", error);
        });
      }

      const taskCount = dailyTasks ? dailyTasks.length : Number(cache && cache.dailyTaskCount) || 0;
      post("CW_WEEKLY_SUMMARY_PROGRESS", "请求大模型，总计 " + taskCount + " 条日报");
      const summaryText = await requestAiSummary(userPrompt, targetField);
      if (!String(summaryText || "").trim()) {
        throw new Error("模型返回内容为空");
      }

      post("CW_WEEKLY_SUMMARY_PROGRESS", "保存周报总结");
      saveWeeklySummary(summaryText, targetField);

      post("CW_WEEKLY_SUMMARY_DONE", "周报总结已生成并触发保存");
    } catch (error) {
      post("CW_WEEKLY_SUMMARY_ERROR", "周报总结失败: " + (error && error.message ? error.message : String(error)));
      throw error;
    } finally {
      summaryRunning = false;
    }
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
    const start = addDays(context.startDate, 7);
    const end = addDays(start, 6);
    const workdays = [];
    let cursor = start;
    while (cursor <= end) {
      if (isChinaWorkday(cursor)) {
        workdays.push(new Date(cursor.getTime()));
      }
      cursor = addDays(cursor, 1);
    }
    return {
      start: start,
      end: end,
      startText: formatDate(start),
      endText: formatDate(end),
      workdays: workdays,
      hasHolidayTable: hasHolidayTable(start.getFullYear()) && hasHolidayTable(end.getFullYear())
    };
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

  async function fetchProjectPlanDetails(context) {
    const params = new URLSearchParams({
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
    });
    const url = getBaseUrl() + "/rest/project/ProjectPlanDetailService/query?" + params.toString();
    const startedAt = performance.now();
    logWbsStep("request ProjectPlanDetailService/query", {
      projectId: context.projectId,
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

  function createNextExecutionRow(wbs, hours, context) {
    const tentative = isTentativeOwner(wbs);
    const ownerId = tentative ? "" : String((wbs && wbs.majorPerson) || "").trim();
    const ownerName = tentative ? "" : String((wbs && (wbs.roleName || wbs.majorPersonName)) || "").trim();
    const detailName = String((wbs && wbs.detailName) || "").trim();
    const creator = context.prodPerson || context.projectManager || "";
    const creatorName = context.prodPersonName || context.projectManagerName || "";

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
      planDate: tentative ? "" : String(hours),
      realTime: "",
      finishRate: "",
      actualHour: "",
      isState: "",
      createTime: "",
      grade: "",
      actualDate: "",
      wbsId: String((wbs && wbs.detailId) || ""),
      wkId: "",
      planEndTime: String((wbs && wbs.planEndTime) || ""),
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
    const dedup = new Set();
    const usedHoursByPerson = {};
    const generated = [];
    const stats = {
      total: wbsRows.length,
      existingRows: existingRows.length,
      noNameOrId: 0,
      outsideNextWeek: 0,
      duplicate: 0,
      tentative: 0,
      noPerson: 0,
      zeroAssignable: 0,
      generatedTasks: 0,
      generatedRows: 0
    };
    const includedSamples = [];
    const skippedSamples = [];

    existingRows.forEach(function (row) {
      const key = createDedupKey(row);
      if (key !== "||") {
        dedup.add(key);
      }
      const person = String((row && row.majorPerson) || "");
      if (person) {
        usedHoursByPerson[person] = (usedHoursByPerson[person] || 0) + toNumber(row && row.planDate);
      }
    });

    wbsRows.forEach(function (wbs) {
      const planStart = parseDate(wbs && wbs.planStartTime);
      const planEnd = parseDate(wbs && wbs.planEndTime);
      const detailName = String((wbs && wbs.detailName) || "").trim();
      const detailId = String((wbs && wbs.detailId) || "").trim();
      if (!detailName || !detailId) {
        stats.noNameOrId += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "noNameOrId",
            detailId: detailId,
            detailName: detailName
          });
        }
        return;
      }
      if (!intervalsIntersect(planStart, planEnd, nextWeek.start, nextWeek.end)) {
        stats.outsideNextWeek += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "outsideNextWeek",
            detailId: detailId,
            detailName: detailName,
            planStartTime: wbs && wbs.planStartTime,
            planEndTime: wbs && wbs.planEndTime
          });
        }
        return;
      }

      const key = createDedupKey({
        majorPerson: isTentativeOwner(wbs) ? "" : wbs.majorPerson,
        wbsId: detailId,
        extName: detailName
      });
      if (dedup.has(key)) {
        stats.duplicate += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "duplicate",
            key: key,
            detailId: detailId,
            detailName: detailName
          });
        }
        return;
      }

      const tentative = isTentativeOwner(wbs);
      if (tentative) {
        generated.push(createNextExecutionRow(wbs, "", context));
        dedup.add(key);
        stats.tentative += 1;
        stats.generatedTasks += 1;
        stats.generatedRows += 1;
        if (includedSamples.length < 10) {
          includedSamples.push({
            detailId: detailId,
            detailName: detailName,
            owner: "待定",
            planDate: "",
            chunks: [""]
          });
        }
        return;
      }

      const person = String((wbs && wbs.majorPerson) || "").trim();
      if (!person) {
        stats.noPerson += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "noPerson",
            detailId: detailId,
            detailName: detailName,
            roleName: wbs && wbs.roleName,
            majorPerson: wbs && wbs.majorPerson
          });
        }
        return;
      }

      const intersectionStart = planStart > nextWeek.start ? planStart : nextWeek.start;
      const intersectionEnd = planEnd < nextWeek.end ? planEnd : nextWeek.end;
      const intersectionWorkdays = countWorkdaysInRange(intersectionStart, intersectionEnd);
      const capacity = nextWeek.workdays.length * 8;
      const remaining = Math.max(0, capacity - (usedHoursByPerson[person] || 0));
      const durationHours = Math.max(0, Math.floor(toNumber(wbs && wbs.duration) * 8));
      const assignableHours = Math.min(intersectionWorkdays * 8, durationHours || intersectionWorkdays * 8, remaining);
      const chunks = splitHours(assignableHours);

      if (!chunks.length) {
        stats.zeroAssignable += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "zeroAssignable",
            detailId: detailId,
            detailName: detailName,
            person: person,
            roleName: wbs && wbs.roleName,
            intersectionWorkdays: intersectionWorkdays,
            duration: wbs && wbs.duration,
            durationHours: durationHours,
            remaining: remaining
          });
        }
      }

      chunks.forEach(function (hours) {
        generated.push(createNextExecutionRow(wbs, hours, context));
      });
      if (assignableHours > 0) {
        usedHoursByPerson[person] = (usedHoursByPerson[person] || 0) + assignableHours;
        dedup.add(key);
        stats.generatedTasks += 1;
        stats.generatedRows += chunks.length;
        if (includedSamples.length < 10) {
          includedSamples.push({
            detailId: detailId,
            detailName: detailName,
            person: person,
            roleName: wbs && wbs.roleName,
            intersectionWorkdays: intersectionWorkdays,
            capacity: capacity,
            usedBefore: capacity - remaining,
            remainingBefore: remaining,
            duration: wbs && wbs.duration,
            durationHours: durationHours,
            assignableHours: assignableHours,
            chunks: chunks
          });
        }
      }
    });

    logWbsStep("build next execution rows result", {
      nextWeek: {
        start: nextWeek.startText,
        end: nextWeek.endText,
        workdays: nextWeek.workdays.map(formatDate)
      },
      stats: stats,
      usedHoursByPerson: usedHoursByPerson,
      includedSamples: includedSamples,
      skippedSamples: skippedSamples
    });

    return generated;
  }

  function insertRowsIntoDataTable($table, dt, rows) {
    const tableId = $table && $table.length ? $table.attr("id") || "" : "";
    logWbsStep("insert rows into DataTable start", {
      tableId: tableId,
      incomingRows: rows.length,
      hasDt: Boolean(dt),
      hasRowAdd: Boolean(dt && dt.row && typeof dt.row.add === "function")
    });
    if (!rows.length) {
      warnWbsStep("skip DataTable insert because generated rows is empty", {
        tableId: tableId
      });
      return;
    }
    const CHANGE_STORE = DataTablesUtil.const.DATA_STORE_CHG || "changeData";
    const changeData = $table.data(CHANGE_STORE) || [];
    const beforeChangeStoreCount = changeData.length;
    const beforeDtCount = dt && dt.rows && typeof dt.rows === "function"
      ? dt.rows().data().toArray().length
      : null;

    rows.forEach(function (row) {
      if (dt && dt.row && typeof dt.row.add === "function") {
        dt.row.add(row);
      }
      changeData.push(row);
    });

    if (dt && typeof dt.draw === "function") {
      dt.draw(false);
    }
    $table.data(CHANGE_STORE, changeData);
    const afterDtCount = dt && dt.rows && typeof dt.rows === "function"
      ? dt.rows().data().toArray().length
      : null;
    logWbsStep("insert rows into DataTable done", {
      tableId: tableId,
      beforeChangeStoreCount: beforeChangeStoreCount,
      afterChangeStoreCount: changeData.length,
      beforeDtCount: beforeDtCount,
      afterDtCount: afterDtCount,
      insertedSample: rows.slice(0, 5).map(function (row) {
        return {
          extName: row.extName,
          wbsId: row.wbsId,
          majorPerson: row.majorPerson,
          majorPersonName: row.majorPersonName,
          planDate: row.planDate,
          nextWkId: row.nextWkId,
          _add_: row._add_
        };
      })
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
    const $table = findNextExecutionTable($);
    const dt = getDataTableApi($table);
    if (!$table.length || !dt) {
      warnWbsStep("next execution DataTable not found", {
        hasTable: Boolean($table.length),
        hasDt: Boolean(dt)
      });
      throw new Error("未找到下周计划 DataTable，无法写入 executionNext");
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
      "CW_BATCH_WORK_RUNNING",
      "查询下周 WBS 计划 " + nextWeek.startText + " 至 " + nextWeek.endText
    );
    const wbsRows = await fetchProjectPlanDetails(context);
    const existingRows = await fetchExistingNextExecutions(context.wkId);
    logWbsStep("source rows loaded", {
      wbsRows: wbsRows.length,
      existingNextRows: existingRows.length
    });
    const generatedRows = buildNextExecutionRows(wbsRows, existingRows, context, nextWeek);
    logWbsStep("generated executionNext rows", {
      count: generatedRows.length,
      sample: generatedRows.slice(0, 10).map(function (row) {
        return {
          extName: row.extName,
          wbsId: row.wbsId,
          majorPerson: row.majorPerson,
          majorPersonName: row.majorPersonName,
          planDate: row.planDate
        };
      })
    });

    insertRowsIntoDataTable($table, dt, generatedRows);
    const tableId = $table.attr("id") || "";
    const modifyData = tableId && DataTablesUtil.data && DataTablesUtil.data.getModifyData
      ? DataTablesUtil.data.getModifyData(tableId)
      : null;
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
      tableId: tableId,
      modifyData: modifyData
    };
  }

  async function runBatchWork() {
    logWbsStep("batch work start", {
      href: window.location.href,
      webapp: getWebapp(),
      baseUrl: getBaseUrl()
    });
    const $ = window.jQuery;
    const tableId = "WkExecutiongrid";
    const $table = $("#" + tableId);
    const dt = $table.data("dataTablesDT");

    if (!$table.length || !dt) {
      throw new Error("未找到 WkExecutiongrid 或 dataTablesDT");
    }

    const CHANGED = DataTablesUtil.const.CHANGED_CLASS_NAME || "changed";
    const CHANGE_STORE = DataTablesUtil.const.DATA_STORE_CHG || "changeData";
    const pk = $table.attr("data-pk-column") || "extId";

    const rows = dt.rows();
    const dataArr = rows.data().toArray();
    const nodeArr = rows.nodes().toArray();
    const changeData = $table.data(CHANGE_STORE) || [];
    logWbsStep("current week execution table loaded", {
      tableId: tableId,
      rows: dataArr.length,
      nodeRows: nodeArr.length,
      changeStoreRows: changeData.length,
      pk: pk
    });
    const changedPkSet = new Set(changeData.map(function (x) {
      return x && x[pk];
    }).filter(Boolean));

    const result = [];

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
      $(select).val(value);
      return true;
    }

    dataArr.forEach(function (rowData, i) {
      if (!rowData) {
        return;
      }

      const tr = nodeArr[i];
      const planDate = rowData.planDate != null && rowData.planDate !== ""
        ? String(rowData.planDate)
        : "";

      const nextValues = {
        finishRate: "100",
        realTime: planDate,
        isNeedDo: "0",
        isState: "50",
        memo: ""
      };

      const hasChanged =
        String(rowData.finishRate ?? "") !== nextValues.finishRate ||
        String(rowData.realTime ?? "") !== nextValues.realTime ||
        String(rowData.isNeedDo ?? "") !== nextValues.isNeedDo ||
        String(rowData.isState ?? "") !== nextValues.isState ||
        String(rowData.memo ?? "") !== nextValues.memo;

      if (!hasChanged) {
        result.push({
          row: i + 1,
          extName: rowData.extName,
          skipped: true
        });
        return;
      }

      Object.assign(rowData, nextValues);

      rowData["6"] = nextValues.finishRate;
      rowData["10"] = nextValues.realTime;
      rowData["12"] = nextValues.isNeedDo;
      rowData["13"] = nextValues.memo;
      rowData["16"] = nextValues.isState;

      if (tr && tr.cells) {
        setInputValue(tr.cells[6] && tr.cells[6].querySelector("input"), nextValues.finishRate);
        setInputValue(tr.cells[10] && tr.cells[10].querySelector("input"), nextValues.realTime);
        setSelectValue(tr.cells[12] && tr.cells[12].querySelector("select"), nextValues.isNeedDo);
        setInputValue(tr.cells[13] && tr.cells[13].querySelector("input,textarea"), nextValues.memo);
        setSelectValue(tr.cells[16] && tr.cells[16].querySelector("select"), nextValues.isState);

        tr.classList.add(CHANGED);
      }

      const rowPk = rowData[pk];
      if (rowPk && !changedPkSet.has(rowPk)) {
        changeData.push(rowData);
        changedPkSet.add(rowPk);
      }

      result.push({
        row: i + 1,
        extId: rowData.extId,
        extName: rowData.extName,
        finishRate: rowData.finishRate,
        realTime: rowData.realTime,
        isNeedDo: rowData.isNeedDo,
        isState: rowData.isState
      });
    });

    $table.data(CHANGE_STORE, changeData);

    const updateModifyData = DataTablesUtil.data.getModifyData(tableId);
    const updateCount = updateModifyData && updateModifyData.update ? updateModifyData.update.length : 0;

    console.table(result);
    logWbsStep("current week execution modifyData before WBS", {
      updateCount: updateCount,
      insertCount: updateModifyData && updateModifyData.insert ? updateModifyData.insert.length : null,
      deleteCount: updateModifyData && updateModifyData.delete ? updateModifyData.delete.length : null,
      modifyData: updateModifyData
    });

    post("CW_BATCH_WORK_RUNNING", "生成下周 WBS 计划明细");
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
    const nextPlanResult = await fillNextWeekWbsPlan(context);
    const finalModifyData = {
      execution: DataTablesUtil.data.getModifyData(tableId),
      executionNext: nextPlanResult.modifyData
    };

    if (updateCount <= 0 && nextPlanResult.insertCount <= 0) {
      warnWbsStep("skip save because no update/insert data", {
        updateCount: updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        nextPlan: nextPlanResult
      });
      return {
        updateCount: 0,
        nextInsertCount: 0,
        result: result,
        skipped: true
      };
    }

    logWbsStep("saveAll start", {
      updateCount: updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      finalModifyData: finalModifyData
    });
    WkFormJS.saveAll();
    logWbsStep("saveAll called");

    return {
      updateCount: updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      nextPlan: nextPlanResult,
      result: result,
      skipped: false
    };
  }

  async function run() {
    if (running) {
      post("CW_BATCH_WORK_RUNNING", "已有批量报工任务运行中");
      return;
    }

    running = true;

    try {
      post("CW_BATCH_WORK_RUNNING", "批量填充中");
      const result = await runBatchWork();

      if (result.skipped) {
        post("CW_BATCH_WORK_DONE", "没有可提交的 update/insert 数据");
        return;
      }

      post("CW_BATCH_WORK_DONE", "已触发保存，update " + result.updateCount + " 条，下周计划 insert " + result.nextInsertCount + " 条");
    } catch (error) {
      post("CW_BATCH_WORK_ERROR", "批量报工失败: " + (error && error.message ? error.message : String(error)));
      throw error;
    } finally {
      running = false;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE_CONTENT) {
      return;
    }

    if (data.type === "CW_BATCH_WORK_START") {
      run().catch(function (error) {
        console.error("[cw-batch-work]", error);
      });
    }

    if (data.type === "CW_WEEKLY_SUMMARY_START") {
      runWeeklySummary({
        forceRefresh: Boolean(data.forceRefresh)
      }).catch(function (error) {
        console.error("[cw-weekly-summary]", error);
      });
      return;
    }

    if (!pendingAiRequest || data.requestId !== pendingAiRequest.requestId) {
      return;
    }

    if (data.type === "CW_WEEKLY_SUMMARY_AI_CHUNK") {
      pendingAiRequest.text += data.text || "";
      setFieldValue(pendingAiRequest.targetField, pendingAiRequest.text);
      return;
    }

    if (data.type === "CW_WEEKLY_SUMMARY_AI_DONE") {
      const request = pendingAiRequest;
      pendingAiRequest = null;
      request.resolve(request.text);
      return;
    }

    if (data.type === "CW_WEEKLY_SUMMARY_AI_ERROR") {
      const request = pendingAiRequest;
      pendingAiRequest = null;
      request.reject(new Error(data.message || "模型请求失败"));
    }
  });
})();
