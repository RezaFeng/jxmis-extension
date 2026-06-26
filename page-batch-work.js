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
    maxPages: 250
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

  function getWebapp() {
    const webapp = window.localStorage.getItem("webapp") || "/jxpmo";
    return webapp === "/" ? "" : webapp;
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
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest"
      },
      cache: "no-store"
    });
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

  function parseProjectIdFromLocation() {
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
    const wkId = readControlValue(["wkId"]);
    const locationProjectId = parseProjectIdFromLocation();
    let projectId = readControlValue(["projectId", "queryProjectId"]) || locationProjectId;
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

  async function fetchWeeklyTaskDetails(context) {
    const seen = new Set();
    const result = [];
    let page = 1;

    while (page <= summaryConfig.maxPages) {
      const data = await fetchTaskDetailPage(context.projectId, page);
      const rows = Array.isArray(data && data.rows) ? data.rows : [];

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

      const total = Number((data && (data.recordsFiltered || data.total || data.recordsTotal)) || 0);
      const pageCount = Number(data && data.pageCount) || (total > 0 ? Math.ceil(total / summaryConfig.pageSize) : 0);
      if (!rows.length || (pageCount > 0 && page >= pageCount) || (pageCount === 0 && rows.length < summaryConfig.pageSize)) {
        break;
      }

      page += 1;
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

  async function runWeeklySummary() {
    if (summaryRunning) {
      post("CW_WEEKLY_SUMMARY_RUNNING", "已有周报总结任务运行中");
      return;
    }

    summaryRunning = true;

    try {
      post("CW_WEEKLY_SUMMARY_RUNNING", "定位本周执行情况文本框");
      const targetField = findCurrWkResultField();
      if (!targetField) {
        throw new Error("未找到“本周执行情况”文本框");
      }
      setFieldValue(targetField, "");

      post("CW_WEEKLY_SUMMARY_PROGRESS", "读取当前周报信息");
      const context = await getWeeklyContext();

      post(
        "CW_WEEKLY_SUMMARY_PROGRESS",
        "拉取 " + context.weekStart + " 至 " + context.weekEnd + " 的日报"
      );
      const dailyTasks = await fetchWeeklyTaskDetails(context);
      if (!dailyTasks.length) {
        throw new Error("未找到本周 taskDetail 日报内容");
      }

      const userPrompt = createUserPrompt(context, dailyTasks);
      post("CW_WEEKLY_SUMMARY_PROGRESS", "请求大模型，总计 " + dailyTasks.length + " 条日报");
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

  function runBatchWork() {
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

    const modifyData = DataTablesUtil.data.getModifyData(tableId);
    const updateCount = modifyData && modifyData.update ? modifyData.update.length : 0;

    console.table(result);
    console.log("即将提交的数据:", modifyData);

    if (updateCount <= 0) {
      console.warn("没有可提交的 update 数据，取消自动保存");
      return {
        updateCount: 0,
        result: result,
        skipped: true
      };
    }

    console.log("检测到 " + updateCount + " 条 update，开始自动保存...");
    WkFormJS.saveAll();

    return {
      updateCount: updateCount,
      result: result,
      skipped: false
    };
  }

  function run() {
    if (running) {
      post("CW_BATCH_WORK_RUNNING", "已有批量报工任务运行中");
      return;
    }

    running = true;

    try {
      post("CW_BATCH_WORK_RUNNING", "批量填充中");
      const result = runBatchWork();

      if (result.skipped) {
        post("CW_BATCH_WORK_DONE", "没有可提交的 update 数据");
        return;
      }

      post("CW_BATCH_WORK_DONE", "已触发保存，update " + result.updateCount + " 条");
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
      try {
        run();
      } catch (error) {
        console.error("[cw-batch-work]", error);
      }
    }

    if (data.type === "CW_WEEKLY_SUMMARY_START") {
      runWeeklySummary().catch(function (error) {
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
