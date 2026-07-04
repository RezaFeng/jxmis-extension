(function () {
  if (window.__cwBatchWorkPageLoaded) {
    return;
  }
  window.__cwBatchWorkPageLoaded = true;

  const SOURCE_PAGE = "cw-batch-work-page";
  const SOURCE_CONTENT = "cw-batch-work-content";

  let running = false;
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
    rows.forEach(function (row) {
      stats.scanned += 1;
      const dateSource = getDailyDateSource(row);
      if (!dateInRange(dateSource, context.startDate, context.endDate)) {
        stats.outsideWeek += 1;
        return;
      }

      const status = getDailyStatus(row);
      if (status && status !== "审核通过") {
        stats.skippedNotApproved += 1;
        return;
      }

      const rawRealHour = row && row.realHour;
      const realHour = toNumber(rawRealHour);
      if (realHour <= 0) {
        stats.skippedNoRealHour += 1;
      }

      const date = formatDate(parseDate(dateSource));
      const key = [
        date,
        normalizeMatchText(row && row.taskOwner),
        normalizeMatchText(row && row.userFullname),
        getDailyWbsId(row),
        getDailyTaskNames(row).join("|"),
        normalizeMatchText(row && row.taskId),
        String(realHour)
      ].join("\n");
      if (seen.has(key)) {
        stats.duplicate += 1;
        return;
      }
      seen.add(key);

      const item = {
        key: key,
        raw: row,
        date: date,
        wbsId: getDailyWbsId(row),
        taskOwner: normalizeMatchText(row && row.taskOwner),
        userFullname: normalizeMatchText(row && row.userFullname),
        taskNames: getDailyTaskNames(row),
        realHour: realHour,
        hasRealHour: realHour > 0,
        realFinishRate: formatRateValue(row && row.realFinishRate),
        dailyEndTime: normalizeMatchText(row && (row.submissionTime || row.realEndTime || row.createTime)),
        sortTime: getDailySortTime(row),
        status: status || "未返回状态"
      };
      if (!item.wbsId) {
        stats.noWbsId += 1;
      }
      stats.usable += 1;
      result.push(item);
    });
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
        "CW_BATCH_WORK_RUNNING",
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
    const counts = {};
    weeklyRows.forEach(function (rowData) {
      const personKey = getWeeklyPersonKey(rowData);
      if (!personKey) {
        return;
      }
      getWeeklyTaskNames(rowData).forEach(function (name) {
        const key = personKey + "|name:" + name;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function formatHourValue(value) {
    const rounded = Math.round(toNumber(value) * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }

  function createDailyActualResolver(dailyRows, weeklyRows) {
    return {
      available: true,
      dailyRows: dailyRows,
      nameCounts: buildWeeklyNameMatchCounts(weeklyRows),
      usedHourWeeklyKeys: new Set(),
      usedFinishRateWeeklyKeys: new Set(),
      usedEndTimeWeeklyKeys: new Set(),
      usedDailyKeys: new Set()
    };
  }

  function findDailyMatchesByWbs(rowData, resolver) {
    const wbsId = getWeeklyWbsId(rowData);
    if (!wbsId) {
      return [];
    }
    return resolver.dailyRows.filter(function (row) {
      return row.wbsId === wbsId && dailyPersonMatches(row.raw, rowData);
    });
  }

  function findDailyMatchesByName(rowData, resolver) {
    const personKey = getWeeklyPersonKey(rowData);
    const names = getWeeklyTaskNames(rowData);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const weeklyNameKey = personKey + "|name:" + name;
      if ((resolver.nameCounts[weeklyNameKey] || 0) > 1) {
        return {
          key: weeklyNameKey,
          matches: [],
          reason: "ambiguousNameMatch"
        };
      }

      const matches = resolver.dailyRows.filter(function (row) {
        return !row.wbsId &&
          row.taskNames.indexOf(name) >= 0 &&
          dailyPersonMatches(row.raw, rowData);
      });
      if (matches.length) {
        return {
          key: weeklyNameKey,
          matches: matches,
          reason: ""
        };
      }
    }
    return {
      key: "",
      matches: [],
      reason: "noDailyMatch"
    };
  }

  function resolveDailyActualHours(rowData, planDate, resolver) {
    if (!resolver || !resolver.available) {
      return {
        value: planDate,
        source: "planFallback",
        reason: resolver && resolver.error ? "dailyFetchFailed" : "dailyResolverUnavailable"
      };
    }

    const personKey = getWeeklyPersonKey(rowData);
    if (!personKey) {
      return {
        value: planDate,
        source: "planFallback",
        reason: "weeklyPersonMissing"
      };
    }

    const wbsId = getWeeklyWbsId(rowData);
    if (wbsId) {
      const weeklyKey = personKey + "|wbs:" + wbsId;
      if (resolver.usedHourWeeklyKeys.has(weeklyKey)) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "duplicateWeeklyWbsPerson"
        };
      }

      const matches = findDailyMatchesByWbs(rowData, resolver);
      const total = matches.reduce(function (sum, row) {
        return sum + row.realHour;
      }, 0);
      if (total > 0) {
        resolver.usedHourWeeklyKeys.add(weeklyKey);
        matches.forEach(function (row) {
          resolver.usedDailyKeys.add(row.key);
        });
        return {
          value: formatHourValue(total),
          source: "dailyExact",
          dailyRealHour: total,
          matchedDailyRows: matches.length
        };
      }
      if (matches.length) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "matchedButNoRealHour",
          matchedDailyRows: matches.length
        };
      }
    }

    const nameMatch = findDailyMatchesByName(rowData, resolver);
    if (nameMatch.key) {
      if (resolver.usedHourWeeklyKeys.has(nameMatch.key)) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "duplicateWeeklyNamePerson"
        };
      }
      const total = nameMatch.matches.reduce(function (sum, row) {
        return sum + row.realHour;
      }, 0);
      if (total > 0) {
        resolver.usedHourWeeklyKeys.add(nameMatch.key);
        nameMatch.matches.forEach(function (row) {
          resolver.usedDailyKeys.add(row.key);
        });
        return {
          value: formatHourValue(total),
          source: "dailyNameFallback",
          dailyRealHour: total,
          matchedDailyRows: nameMatch.matches.length
        };
      }
      if (nameMatch.matches.length) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "matchedButNoRealHour",
          matchedDailyRows: nameMatch.matches.length
        };
      }
    }

    return {
      value: planDate,
      source: "planFallback",
      reason: nameMatch.reason || "noDailyMatch"
    };
  }

  function resolveDailyFinishRate(rowData, resolver) {
    if (!resolver || !resolver.available) {
      return {
        value: "100",
        source: "defaultFallback",
        reason: resolver && resolver.error ? "dailyFetchFailed" : "dailyResolverUnavailable"
      };
    }

    const personKey = getWeeklyPersonKey(rowData);
    if (!personKey) {
      return {
        value: "100",
        source: "defaultFallback",
        reason: "weeklyPersonMissing"
      };
    }

    const wbsId = getWeeklyWbsId(rowData);
    let weeklyKey = "";
    let matches = [];
    let fallbackReason = "noApprovedDailyMatch";
    let source = "dailyExact";
    if (wbsId) {
      weeklyKey = personKey + "|wbs:" + wbsId;
      if (resolver.usedFinishRateWeeklyKeys.has(weeklyKey)) {
        return {
          value: "100",
          source: "defaultFallback",
          reason: "duplicateWeeklyWbsPerson"
        };
      }
      matches = findDailyMatchesByWbs(rowData, resolver);
    }

    if (!matches.length) {
      const nameMatch = findDailyMatchesByName(rowData, resolver);
      weeklyKey = nameMatch.key;
      matches = nameMatch.matches;
      fallbackReason = nameMatch.reason || "noApprovedDailyMatch";
      source = "dailyNameFallback";
      if (weeklyKey && resolver.usedFinishRateWeeklyKeys.has(weeklyKey)) {
        return {
          value: "100",
          source: "defaultFallback",
          reason: "duplicateWeeklyNamePerson"
        };
      }
    }

    const validMatches = matches.filter(function (row) {
      return row.realFinishRate !== "";
    });
    if (!validMatches.length) {
      return {
        value: "100",
        source: "defaultFallback",
        reason: matches.length ? "invalidDailyFinishRate" : fallbackReason
      };
    }

    validMatches.sort(function (a, b) {
      return b.sortTime - a.sortTime;
    });
    const latest = validMatches[0];
    if (weeklyKey) {
      resolver.usedFinishRateWeeklyKeys.add(weeklyKey);
    }
    resolver.usedDailyKeys.add(latest.key);
    return {
      value: latest.realFinishRate,
      source: source,
      dailyFinishRate: latest.realFinishRate,
      matchedDailyRows: matches.length,
      latestDailyDate: latest.date
    };
  }

  function resolveDailyRealEndTime(rowData, fallbackValue, resolver) {
    const fallback = normalizeMatchText(fallbackValue);
    if (!resolver || !resolver.available) {
      return {
        value: fallback,
        source: "planEndTimeFallback",
        reason: resolver && resolver.error ? "dailyFetchFailed" : "dailyResolverUnavailable"
      };
    }

    const personKey = getWeeklyPersonKey(rowData);
    if (!personKey) {
      return {
        value: fallback,
        source: "planEndTimeFallback",
        reason: "weeklyPersonMissing"
      };
    }

    const wbsId = getWeeklyWbsId(rowData);
    let weeklyKey = "";
    let matches = [];
    let fallbackReason = "noDailyMatch";
    let source = "dailyExact";
    if (wbsId) {
      weeklyKey = personKey + "|wbs:" + wbsId;
      if (resolver.usedEndTimeWeeklyKeys.has(weeklyKey)) {
        return {
          value: fallback,
          source: "planEndTimeFallback",
          reason: "duplicateWeeklyWbsPerson"
        };
      }
      matches = findDailyMatchesByWbs(rowData, resolver);
    }

    if (!matches.length) {
      const nameMatch = findDailyMatchesByName(rowData, resolver);
      weeklyKey = nameMatch.key;
      matches = nameMatch.matches;
      fallbackReason = nameMatch.reason || "noDailyMatch";
      source = "dailyNameFallback";
      if (weeklyKey && resolver.usedEndTimeWeeklyKeys.has(weeklyKey)) {
        return {
          value: fallback,
          source: "planEndTimeFallback",
          reason: "duplicateWeeklyNamePerson"
        };
      }
    }

    const validMatches = matches.filter(function (row) {
      return Boolean(row.dailyEndTime);
    });
    if (!validMatches.length) {
      return {
        value: fallback,
        source: "planEndTimeFallback",
        reason: matches.length ? "invalidDailyEndTime" : fallbackReason
      };
    }

    validMatches.sort(function (a, b) {
      return b.sortTime - a.sortTime;
    });
    const latest = validMatches[0];
    if (weeklyKey) {
      resolver.usedEndTimeWeeklyKeys.add(weeklyKey);
    }
    resolver.usedDailyKeys.add(latest.key);
    return {
      value: latest.dailyEndTime,
      source: source,
      dailyEndTime: latest.dailyEndTime,
      matchedDailyRows: matches.length,
      latestDailyDate: latest.date
    };
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
    if (!dailyTasks.length) {
      throw new Error("未找到本周 taskDetail 日报内容");
    }

    const taskCount = dailyTasks.length;
    const progressType = options && options.progressType ? options.progressType : "CW_WEEKLY_SUMMARY_PROGRESS";
    const saveSummary = !(options && options.skipSave);
    const cacheKey = createSummaryCacheKey(context);
    const userPrompt = createUserPrompt(context, dailyTasks);

    await setSummaryCache(cacheKey, {
      cacheKey: cacheKey,
      wkId: context.wkId,
      projectId: context.projectId,
      projectName: context.projectName,
      weekStart: context.weekStart,
      weekEnd: context.weekEnd,
      dailyTaskCount: taskCount,
      userPrompt: userPrompt,
      cachedAt: new Date().toISOString()
    }).catch(function (error) {
      console.warn("[cw-weekly-summary] cache write failed", error);
    });

    post(progressType, "请求大模型，总计 " + taskCount + " 条日报");
    const summaryText = await requestAiSummary(userPrompt, targetField);
    if (!String(summaryText || "").trim()) {
      throw new Error("模型返回内容为空");
    }

    post(progressType, saveSummary ? "保存周报总结" : "回填周报总结，等待批量报工统一保存");
    saveWeeklySummary(summaryText, targetField, {
      skipSave: !saveSummary
    });

    return {
      summaryText: summaryText,
      taskCount: taskCount,
      userPrompt: userPrompt
    };
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
    if (!window.CwWbsPlan || typeof window.CwWbsPlan.getNextWeekInfo !== "function") {
      throw new Error("WBS 计划模块未加载");
    }
    return window.CwWbsPlan.getNextWeekInfo(context);
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
    if (!window.CwWbsPlan || typeof window.CwWbsPlan.buildNextExecutionRows !== "function") {
      throw new Error("WBS 计划模块未加载");
    }
    return window.CwWbsPlan.buildNextExecutionRows(wbsRows, existingRows, context, nextWeek, {
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

  async function runBatchWork() {
    const wkForm = await waitForWkFormJS(["saveAll"]);
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

    let dailyActualResolver = {
      available: false,
      error: "notLoaded"
    };
    let dailyActualResult = {
      rows: [],
      rawRows: [],
      stats: null
    };
    post("CW_BATCH_WORK_RUNNING", "查询本周日报实际工时");
    try {
      dailyActualResult = await fetchWeeklyDailyActualRows(context);
      dailyActualResolver = createDailyActualResolver(dailyActualResult.rows, dataArr);
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

    function getColumnInputValue(tr, colIndex) {
      const input = tr && tr.cells && tr.cells[colIndex]
        ? tr.cells[colIndex].querySelector("input,textarea,select")
        : null;
      return input && input.value != null ? String(input.value).trim() : "";
    }

    dataArr.forEach(function (rowData, i) {
      if (!rowData) {
        return;
      }

      const tr = nodeArr[i];
      const planDate = rowData.planDate != null && rowData.planDate !== ""
        ? String(rowData.planDate)
        : "";
      const planEndTime = normalizeMatchText(rowData.planEndTime) ||
        getColumnInputValue(tr, 7) ||
        normalizeMatchText(rowData.realEndTime);
      const actualTime = resolveDailyActualHours(rowData, planDate, dailyActualResolver);
      const finishRate = resolveDailyFinishRate(rowData, dailyActualResolver);
      const realEndTime = resolveDailyRealEndTime(rowData, planEndTime, dailyActualResolver);

      const nextValues = {
        finishRate: finishRate.value,
        realEndTime: realEndTime.value,
        realTime: actualTime.value,
        isNeedDo: "0",
        isState: "50",
        memo: ""
      };

      const hasChanged =
        String(rowData.finishRate ?? "") !== nextValues.finishRate ||
        String(rowData.realEndTime ?? "") !== nextValues.realEndTime ||
        String(rowData.realTime ?? "") !== nextValues.realTime ||
        String(rowData.isNeedDo ?? "") !== nextValues.isNeedDo ||
        String(rowData.isState ?? "") !== nextValues.isState ||
        String(rowData.memo ?? "") !== nextValues.memo;

      if (!hasChanged) {
        result.push({
          row: i + 1,
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
        });
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
        realEndTime: rowData.realEndTime,
        realTime: rowData.realTime,
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
        isNeedDo: rowData.isNeedDo,
        isState: rowData.isState
      });
    });

    if (dailyActualResolver && dailyActualResolver.available) {
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

    let summaryResult = null;
    post("CW_BATCH_WORK_RUNNING", "基于本次日报数据生成周报总结");
    try {
      const targetField = findCurrWkResultField();
      if (!targetField) {
        throw new Error("未找到“本周执行情况”文本框");
      }
      setFieldValue(targetField, "");
      const summaryRows = Array.isArray(dailyActualResult.rawRows) ? dailyActualResult.rawRows : [];
      const dailyTasks = createWeeklyTaskDetailsFromRows(summaryRows, context);
      logWbsStep("weekly summary task details extracted from shared daily rows", {
        rawRows: summaryRows.length,
        taskCount: dailyTasks.length,
        sample: dailyTasks.slice(0, 10)
      });
      summaryResult = await generateWeeklySummaryWithTasks(context, dailyTasks, targetField, {
        progressType: "CW_BATCH_WORK_RUNNING",
        skipSave: true
      });
      logWbsStep("weekly summary generated before current week save", {
        taskCount: summaryResult.taskCount,
        summaryLength: String(summaryResult.summaryText || "").length
      });
    } catch (error) {
      warnWbsStep("weekly summary generation failed before current week save", {
        error: error && error.message ? error.message : String(error)
      });
      throw error;
    }

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
    } else {
      logWbsStep("skip current week save because no update data and no weekly summary");
    }

    post("CW_BATCH_WORK_RUNNING", "生成下周 WBS 计划明细");
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
        currentSaveTriggered: shouldSaveCurrentWeek,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        result: result,
        skipped: true
      };
    }

    if (nextPlanResult.missingMajorPersonCount > 0) {
      warnWbsStep("skip executionNext save because missing majorPerson", {
        updateCount: updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
        missingMajorPersonRows: nextPlanResult.missingMajorPersonRows.slice(0, 20)
      });
      return {
        updateCount: updateCount,
        nextInsertCount: nextPlanResult.insertCount,
        missingMajorPersonCount: nextPlanResult.missingMajorPersonCount,
        currentSaveTriggered: shouldSaveCurrentWeek,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        nextPlan: nextPlanResult,
        result: result,
        skipped: false,
        nextSaveSkipped: true
      };
    }

    if (nextPlanResult.insertCount <= 0) {
      logWbsStep("skip executionNext save because no generated insert rows", {
        updateCount: updateCount,
        nextInsertCount: nextPlanResult.insertCount
      });
      return {
        updateCount: updateCount,
        nextInsertCount: 0,
        currentSaveTriggered: shouldSaveCurrentWeek,
        weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
        nextPlan: nextPlanResult,
        result: result,
        skipped: false,
        nextSaveSkipped: false
      };
    }

    logWbsStep("executionNext saveAll start", {
      updateCount: updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      finalModifyData: finalModifyData
    });
    wkForm.saveAll();
    logWbsStep("executionNext saveAll called");

    return {
      updateCount: updateCount,
      nextInsertCount: nextPlanResult.insertCount,
      currentSaveTriggered: shouldSaveCurrentWeek,
      weeklySummaryGenerated: Boolean(summaryResult && summaryResult.summaryText),
      nextPlan: nextPlanResult,
      result: result,
      skipped: false,
      nextSaveSkipped: false
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
        if (result.currentSaveTriggered) {
          post("CW_BATCH_WORK_DONE", "本周报工/周报总结已保存；没有可插入的下周计划");
        } else {
          post("CW_BATCH_WORK_DONE", "没有可提交的 update/insert 数据");
        }
        return;
      }

      if (result.nextSaveSkipped) {
        const currentMessage = result.currentSaveTriggered ? "本周报工已保存；" : "";
        post(
          "CW_BATCH_WORK_DONE",
          currentMessage + "下周计划已填入 " + result.nextInsertCount + " 条，其中 " + result.missingMajorPersonCount + " 条缺少人员，需手工保存"
        );
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
