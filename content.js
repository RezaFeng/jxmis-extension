(function () {
  if (window.top !== window.self) {
    return;
  }

  if (window.__cwDailyApprovalContentLoaded) {
    return;
  }
  window.__cwDailyApprovalContentLoaded = true;

  const DAILY_SCRIPT_ID = "cw-daily-approval-page-script";
  const TRANSPORT_SCRIPT_ID = "cw-jxmis-transport-script";
  const DAILY_PANEL_ID = "cw-daily-approval-panel";
  const DAILY_BTN_ID = "cw-daily-approval-btn";
  const DAILY_STATUS_ID = "cw-daily-approval-status";
  const DAILY_SOURCE_PAGE = "cw-daily-approval-page";
  const DAILY_SOURCE_CONTENT = "cw-daily-approval-content";

  const WORK_SCRIPT_ID = "cw-batch-work-page-script";
  const WORK_PLAN_SCRIPT_ID = "cw-wbs-plan-script";
  const WORK_DAILY_ACTUAL_SCRIPT_ID = "cw-daily-actual-script";
  const WORK_CURRENT_WEEK_PLAN_SCRIPT_ID = "cw-current-week-execution-plan-script";
  const WORK_WEEKLY_SUMMARY_SCRIPT_ID = "cw-weekly-summary-script";
  const WEEKLY_DETAIL_SCRIPT_ID = "cw-weekly-detail-script";
  const WORK_WRAPPER_ID = "cw-batch-work-wrapper";
  const WORK_BTN_ID = "cw-batch-work-btn";
  const WORK_STATUS_ID = "cw-batch-work-status";
  const WORK_SOURCE_PAGE = "cw-batch-work-page";
  const WORK_SOURCE_CONTENT = "cw-batch-work-content";

  const WEEKLY_SCRIPT_ID = "cw-weekly-approval-page-script";
  const WEEKLY_BTN_ID = "cw-weekly-approval-btn";
  const WEEKLY_STATUS_ID = "cw-weekly-approval-status";
  const WEEKLY_SOURCE_PAGE = "cw-weekly-approval-page";
  const WEEKLY_SOURCE_CONTENT = "cw-weekly-approval-content";

  let dailyRunning = false;
  let workRunning = false;
  let weeklyRunning = false;
  let aiPort = null;

  const STATUS_CONTROLS = {
    daily: {
      statusId: DAILY_STATUS_ID,
      buttonId: DAILY_BTN_ID,
      isRunning: function () {
        return dailyRunning;
      },
      setRunning: function (runningValue) {
        dailyRunning = runningValue;
      },
      runningText: "审批中...",
      idleText: "批量审批未审批日报"
    },
    work: {
      statusId: WORK_STATUS_ID,
      buttonId: WORK_BTN_ID,
      isRunning: function () {
        return workRunning;
      },
      setRunning: function (runningValue) {
        workRunning = runningValue;
      },
      runningText: "报工中...",
      idleText: "批量报工"
    },
    weekly: {
      statusId: WEEKLY_STATUS_ID,
      buttonId: WEEKLY_BTN_ID,
      isRunning: function () {
        return weeklyRunning;
      },
      setRunning: function (runningValue) {
        weeklyRunning = runningValue;
      },
      runningText: "审核中...",
      idleText: "批量审核"
    }
  };

  const AUTOMATIONS = [
    {
      name: "daily",
      matcher: isDailyApprovalPage,
      scripts: [
        {
          id: TRANSPORT_SCRIPT_ID,
          fileName: "jxmis-transport.js"
        },
        {
          id: DAILY_SCRIPT_ID,
          fileName: "page-batch-approve.js"
        }
      ],
      ensurePanel: ensureDailyPanel
    },
    {
      name: "work",
      matcher: isWorkReportPage,
      scripts: [
        {
          id: TRANSPORT_SCRIPT_ID,
          fileName: "jxmis-transport.js"
        },
        {
          id: WORK_PLAN_SCRIPT_ID,
          fileName: "wbs-plan.js"
        },
        {
          id: WORK_DAILY_ACTUAL_SCRIPT_ID,
          fileName: "daily-actual.js"
        },
        {
          id: WORK_CURRENT_WEEK_PLAN_SCRIPT_ID,
          fileName: "current-week-execution-plan.js"
        },
        {
          id: WORK_WEEKLY_SUMMARY_SCRIPT_ID,
          fileName: "weekly-summary.js"
        },
        {
          id: WEEKLY_DETAIL_SCRIPT_ID,
          fileName: "weekly-detail.js"
        },
        {
          id: WORK_SCRIPT_ID,
          fileName: "page-batch-work.js"
        }
      ],
      ensurePanel: ensureWorkButton
    },
    {
      name: "weekly",
      matcher: isWeeklyApprovalListPage,
      scripts: [
        {
          id: TRANSPORT_SCRIPT_ID,
          fileName: "jxmis-transport.js"
        },
        {
          id: WEEKLY_DETAIL_SCRIPT_ID,
          fileName: "weekly-detail.js"
        },
        {
          id: WEEKLY_SCRIPT_ID,
          fileName: "page-batch-weekly-approve.js"
        }
      ],
      ensurePanel: ensureWeeklyApprovalPanel
    }
  ];

  function setAutomationStatus(controlName, text, running) {
    updateAutomationStatus(STATUS_CONTROLS[controlName], text, running);
  }

  function updateAutomationStatus(config, text, running) {
    const status = document.getElementById(config.statusId);
    const button = document.getElementById(config.buttonId);
    if (typeof running === "boolean") {
      config.setRunning(running);
    }
    const isRunning = config.isRunning();
    if (status) {
      status.textContent = text;
      status.style.color = isRunning ? "#0b73f6" : "#666";
    }
    if (button) {
      button.disabled = isRunning;
      button.style.opacity = isRunning ? "0.7" : "1";
      button.style.cursor = isRunning ? "not-allowed" : "pointer";
      button.textContent = isRunning ? config.runningText : config.idleText;
    }
  }

  function injectPageScript(id, fileName) {
    if (document.getElementById(id)) {
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = chrome.runtime.getURL(fileName);
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  function ensureAutomation() {
    AUTOMATIONS.forEach(function (automation) {
      if (!automation.matcher()) {
        return;
      }
      automation.scripts.forEach(function (scriptConfig) {
        injectPageScript(scriptConfig.id, scriptConfig.fileName);
      });
      automation.ensurePanel();
    });
  }

  function isDailyApprovalPage() {
    return Boolean(
      document.querySelector("#dailyApprovalForm") ||
        document.querySelector("#DailyApprovalgrid") ||
        document.querySelector("#DailyApprovaledgrid")
    );
  }

  function isWorkReportPage() {
    return Boolean(
      document.querySelector("#WkExecutiongrid") ||
        window.location.href.indexOf("/project/WkReportService/id/") >= 0 ||
        window.location.hash.indexOf("/project/WkReportService/id/") >= 0
    );
  }

  function isWeeklyApprovalListPage() {
    return window.location.hash.indexOf("/project/WkReportService/wkreportListPage") >= 0;
  }

  function ensureDailyPanel() {
    if (!isDailyApprovalPage()) {
      return;
    }

    if (document.getElementById(DAILY_PANEL_ID)) {
      return;
    }

    const panel = document.createElement("div");
    panel.id = DAILY_PANEL_ID;
    panel.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:8px",
      "margin-left:8px"
    ].join(";");

    const button = document.createElement("button");
    button.id = DAILY_BTN_ID;
    button.type = "button";
    button.textContent = "批量审批未审批日报";
    button.style.cssText = [
      "padding:6px 12px",
      "border:1px solid #0b73f6",
      "background:#0b73f6",
      "color:#fff",
      "border-radius:4px",
      "cursor:pointer",
      "font-size:12px",
      "line-height:1.4"
    ].join(";");

    const status = document.createElement("span");
    status.id = DAILY_STATUS_ID;
    status.textContent = "";
    status.style.cssText = [
      "font-size:12px",
      "color:#666",
      "max-width:520px",
      "word-break:break-all"
    ].join(";");

    button.addEventListener("click", function () {
      if (dailyRunning) {
        return;
      }

      window.postMessage(
        {
          source: DAILY_SOURCE_CONTENT,
          type: "CW_DAILY_APPROVAL_START"
        },
        "*"
      );
    });

    panel.appendChild(button);
    panel.appendChild(status);

    const toolbar =
      document.querySelector("#dailyApprovalForm #nonApprovled .panel-toolbar .form-inline") ||
      document.querySelector("#dailyApprovalForm .panel-toolbar .form-inline");

    if (toolbar) {
      toolbar.appendChild(panel);
    } else {
      panel.style.cssText += ";position:fixed;right:24px;top:88px;z-index:99999;background:#fff;padding:10px 12px;border:1px solid #d9d9d9;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.12)";
      document.body.appendChild(panel);
    }
  }

  function setDailyStatus(text, running) {
    setAutomationStatus("daily", text, running);
  }

  function tryRefreshApprovalGrid() {
    const jq = window.jQuery || window.$;
    if (!jq) {
      return;
    }
    const table = jq("#DailyApprovalgrid");
    if (!table.length) {
      return;
    }
    const dt = table.data("dataTablesDT");
    if (dt && dt.ajax && typeof dt.ajax.reload === "function") {
      dt.ajax.reload(null, false);
    }
  }

  function reloadCurrentPageSoon() {
    window.setTimeout(function () {
      window.location.reload();
    }, 1200);
  }

  function findRecalculateButton() {
    const candidates = Array.from(
      document.querySelectorAll("button, a, input[type='button'], input[type='submit']")
    );

    return (
      candidates.find(function (el) {
        const text = (el.textContent || el.value || "").trim();
        return text === "重新计算";
      }) || null
    );
  }

  function ensureWorkButton() {
    if (!isWorkReportPage()) {
      return;
    }

    const existingWorkButton = document.getElementById(WORK_BTN_ID);
    const existingWorkWrapper = document.getElementById(WORK_WRAPPER_ID);
    if (existingWorkButton || existingWorkWrapper) {
      return;
    }

    const recalcButton = findRecalculateButton();
    if (!recalcButton) {
      return;
    }

    const wrapper = document.createElement("span");
    wrapper.id = WORK_WRAPPER_ID;
    wrapper.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:8px",
      "margin-left:8px"
    ].join(";");

    const button = document.createElement("button");
    button.id = WORK_BTN_ID;
    button.type = "button";
    button.textContent = "批量报工";
    button.className = recalcButton.className || "btn btn-info";
    button.style.marginTop = recalcButton.style.marginTop || "-3%";
    button.style.marginLeft = "1%";
    if (!button.className) {
      button.style.cssText = [
        "padding:6px 12px",
        "border:1px solid #0b73f6",
        "background:#0b73f6",
        "color:#fff",
        "border-radius:4px",
        "cursor:pointer",
        "font-size:12px",
        "line-height:1.4"
      ].join(";");
    }

    const status = document.createElement("span");
    status.id = WORK_STATUS_ID;
    status.textContent = "";
    status.style.cssText = "font-size:12px;color:#666;max-width:420px;word-break:break-all;display:inline-flex;align-items:center;vertical-align:middle;";

    button.addEventListener("click", function () {
      if (workRunning) {
        return;
      }

      const confirmed = window.confirm("将批量填充报工并立即触发保存。是否继续？");
      if (!confirmed) {
        return;
      }

      window.postMessage(
        {
          source: WORK_SOURCE_CONTENT,
          type: "CW_BATCH_WORK_START"
        },
        "*"
      );
    });

    wrapper.appendChild(status);
    recalcButton.insertAdjacentElement("afterend", button);
    button.insertAdjacentElement("afterend", wrapper);
  }

  function setWorkStatus(text, running) {
    setAutomationStatus("work", text, running);
  }

  function postToPage(message) {
    window.postMessage(
      Object.assign(
        {
          source: WORK_SOURCE_CONTENT
        },
        message || {}
      ),
      "*"
    );
  }

  function startAiSummary(data) {
    const requestId = data.requestId;
    console.info("[cw-weekly-summary-ai] content received request", {
      requestId: requestId,
      promptLength: String(data.userPrompt || "").length
    });
    postToPage({
      type: "CW_WEEKLY_SUMMARY_AI_STATUS",
      requestId: requestId,
      message: "已收到大模型请求，准备连接扩展后台"
    });

    if (aiPort) {
      try {
        aiPort.disconnect();
      } catch (error) {
        // Ignore stale port disconnect errors.
      }
      aiPort = null;
    }

    aiPort = chrome.runtime.connect({
      name: "cw-ai-summary"
    });
    postToPage({
      type: "CW_WEEKLY_SUMMARY_AI_STATUS",
      requestId: requestId,
      message: "已连接扩展后台，准备请求模型"
    });

    aiPort.onMessage.addListener(function (message) {
      if (!message) {
        return;
      }

      if (message.type === "status") {
        console.info("[cw-weekly-summary-ai] background status", {
          requestId: requestId,
          message: message.message || ""
        });
        postToPage({
          type: "CW_WEEKLY_SUMMARY_AI_STATUS",
          requestId: requestId,
          message: message.message || "模型请求处理中"
        });
        return;
      }

      if (message.type === "chunk") {
        console.info("[cw-weekly-summary-ai] chunk received", {
          requestId: requestId,
          length: String(message.text || "").length
        });
        postToPage({
          type: "CW_WEEKLY_SUMMARY_AI_CHUNK",
          requestId: requestId,
          text: message.text || ""
        });
        return;
      }

      if (message.type === "done") {
        console.info("[cw-weekly-summary-ai] done", {
          requestId: requestId
        });
        postToPage({
          type: "CW_WEEKLY_SUMMARY_AI_DONE",
          requestId: requestId
        });
        aiPort.disconnect();
        aiPort = null;
        return;
      }

      if (message.type === "error") {
        console.error("[cw-weekly-summary-ai] error", {
          requestId: requestId,
          message: message.message || "模型请求失败"
        });
        postToPage({
          type: "CW_WEEKLY_SUMMARY_AI_ERROR",
          requestId: requestId,
          message: message.message || "模型请求失败"
        });
        aiPort.disconnect();
        aiPort = null;
      }
    });

    aiPort.onDisconnect.addListener(function () {
      aiPort = null;
    });

    aiPort.postMessage({
      type: "start",
      requestId: requestId,
      userPrompt: data.userPrompt || ""
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function handleWeeklySummaryCacheRequest(data) {
    const type =
      data.type === "CW_WEEKLY_SUMMARY_CACHE_GET"
        ? "CW_WEEKLY_SUMMARY_CACHE_GET"
        : "CW_WEEKLY_SUMMARY_CACHE_SET";

    sendRuntimeMessage({
      type: type,
      key: data.key,
      value: data.value
    }).then(function (response) {
      postToPage({
        type: type + "_RESULT",
        requestId: data.requestId,
        ok: Boolean(response && response.ok),
        cache: response && response.cache,
        error: response && response.error
      });
    });
  }

  function findWeeklyExportButton() {
    const candidates = Array.from(
      document.querySelectorAll("button, a, input[type=button], input[type=submit]")
    );

    return (
      candidates.find(function (el) {
        const text = (el.textContent || el.value || "").trim();
        const onclick = String(el.getAttribute("onclick") || "");
        return text === "导出" && onclick.indexOf("exportAll") >= 0;
      }) ||
      candidates.find(function (el) {
        const text = (el.textContent || el.value || "").trim();
        return text === "导出";
      }) ||
      null
    );
  }

  function ensureWeeklyApprovalPanel() {
    if (!isWeeklyApprovalListPage()) {
      return;
    }

    if (document.getElementById(WEEKLY_BTN_ID)) {
      return;
    }

    const exportButton = findWeeklyExportButton();
    if (!exportButton) {
      return;
    }

    const button = document.createElement("button");
    button.id = WEEKLY_BTN_ID;
    button.type = "button";
    button.textContent = "批量审核";
    button.className = "btn btn-info";
    button.style.marginTop = exportButton.style.marginTop || "0px";
    button.style.marginLeft = "8px";

    const status = document.createElement("span");
    status.id = WEEKLY_STATUS_ID;
    status.textContent = "";
    status.style.cssText = [
      "font-size:12px",
      "color:#666",
      "max-width:520px",
      "word-break:break-all",
      "display:inline-flex",
      "align-items:center",
      "vertical-align:middle",
      "margin-left:8px"
    ].join(";");

    button.addEventListener("click", function () {
      if (weeklyRunning) {
        return;
      }

      window.postMessage(
        {
          source: WEEKLY_SOURCE_CONTENT,
          type: "CW_WEEKLY_APPROVAL_START"
        },
        "*"
      );
    });

    exportButton.insertAdjacentElement("afterend", button);
    button.insertAdjacentElement("afterend", status);
  }

  function setWeeklyStatus(text, running) {
    setAutomationStatus("weekly", text, running);
  }

  function tryRefreshWeeklyGrid() {
    const jq = window.jQuery || window.$;
    if (!jq) {
      return false;
    }

    const selectors = [
      "#WkReportgrid",
      "#WkReportGrid",
      "#wkReportgrid",
      "#wkReportListGrid",
      "#WkReportListgrid",
      "#WkReportServicegrid"
    ];

    for (let i = 0; i < selectors.length; i += 1) {
      const table = jq(selectors[i]);
      if (!table.length) {
        continue;
      }
      const dt = table.data("dataTablesDT");
      if (dt && dt.ajax && typeof dt.ajax.reload === "function") {
        dt.ajax.reload(null, false);
        return true;
      }
    }

    const tables = jq("table").toArray();
    for (let j = 0; j < tables.length; j += 1) {
      const table = jq(tables[j]);
      const dt = table.data("dataTablesDT");
      if (dt && dt.ajax && typeof dt.ajax.reload === "function") {
        dt.ajax.reload(null, false);
        return true;
      }
    }

    return false;
  }

  const PAGE_MESSAGE_HANDLERS = {};

  PAGE_MESSAGE_HANDLERS[DAILY_SOURCE_PAGE] = {
    CW_DAILY_APPROVAL_RUNNING: function (data) {
      setDailyStatus(data.message || "处理中", true);
    },
    CW_DAILY_APPROVAL_PROGRESS: function (data) {
      setDailyStatus(data.message || "处理中", true);
    },
    CW_DAILY_APPROVAL_DONE: function (data) {
      setDailyStatus(data.message || "完成", false);
      tryRefreshApprovalGrid();
      if (data.shouldReload) {
        reloadCurrentPageSoon();
      }
    },
    CW_DAILY_APPROVAL_ERROR: function (data) {
      setDailyStatus(data.message || "失败", false);
    }
  };

  PAGE_MESSAGE_HANDLERS[WORK_SOURCE_PAGE] = {
    CW_WEEKLY_SUMMARY_AI_REQUEST: function (data) {
      startAiSummary(data);
    },
    CW_WEEKLY_SUMMARY_CACHE_GET: function (data) {
      handleWeeklySummaryCacheRequest(data);
    },
    CW_WEEKLY_SUMMARY_CACHE_SET: function (data) {
      handleWeeklySummaryCacheRequest(data);
    },
    CW_BATCH_WORK_RUNNING: function (data) {
      setWorkStatus(data.message || "处理中", true);
    },
    CW_BATCH_WORK_DONE: function (data) {
      setWorkStatus(data.message || "完成", false);
    },
    CW_BATCH_WORK_ERROR: function (data) {
      setWorkStatus(data.message || "失败", false);
    }
  };

  PAGE_MESSAGE_HANDLERS[WEEKLY_SOURCE_PAGE] = {
    CW_WEEKLY_APPROVAL_RUNNING: function (data) {
      setWeeklyStatus(data.message || "处理中", true);
    },
    CW_WEEKLY_APPROVAL_PREVIEW: function (data) {
      setWeeklyStatus(data.message || "待确认", true);
    },
    CW_WEEKLY_APPROVAL_PROGRESS: function (data) {
      setWeeklyStatus(data.message || "处理中", true);
    },
    CW_WEEKLY_APPROVAL_DONE: function (data) {
      setWeeklyStatus(data.message || "完成", false);
      if (data.shouldReload && !tryRefreshWeeklyGrid()) {
        reloadCurrentPageSoon();
      }
    },
    CW_WEEKLY_APPROVAL_ERROR: function (data) {
      setWeeklyStatus(data.message || "失败", false);
    }
  };

  window.addEventListener("message", function (event) {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data) {
      return;
    }

    const sourceHandlers = PAGE_MESSAGE_HANDLERS[data.source];
    const handler = sourceHandlers && sourceHandlers[data.type];
    if (handler) {
      handler(data);
    }
  });

  ensureAutomation();

  window.addEventListener("hashchange", function () {
    ensureAutomation();
  });

  const observer = new MutationObserver(function () {
    ensureAutomation();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
