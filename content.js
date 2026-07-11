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
  const WORK_WEEKLY_CONTEXT_SCRIPT_ID = "cw-weekly-context-script";
  const WEEKLY_DETAIL_SCRIPT_ID = "cw-weekly-detail-script";
  const WORK_WRAPPER_ID = "cw-batch-work-wrapper";
  const WORK_BTN_ID = "cw-batch-work-btn";
  const WORK_DROPDOWN_BTN_ID = "cw-batch-work-dropdown-btn";
  const WORK_MENU_ID = "cw-batch-work-menu";
  const WORK_STATUS_ID = "cw-batch-work-status";
  const WORK_TOOLBAR_SAVE_BTN_ID = "cw-toolbar-fallback-save-btn";
  const WORK_SOURCE_PAGE = "cw-batch-work-page";
  const WORK_SOURCE_CONTENT = "cw-batch-work-content";

  const WEEKLY_SCRIPT_ID = "cw-weekly-approval-page-script";
  const WEEKLY_BTN_ID = "cw-weekly-approval-btn";
  const WEEKLY_STATUS_ID = "cw-weekly-approval-status";
  const WEEKLY_SOURCE_PAGE = "cw-weekly-approval-page";
  const WEEKLY_SOURCE_CONTENT = "cw-weekly-approval-content";

  let dailyRunning = false;
  let workRunning = false;
  let toolbarActionRunning = false;
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
      idleText: "一键报工"
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
          id: WORK_WEEKLY_CONTEXT_SCRIPT_ID,
          fileName: "weekly-context.js"
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
    return new Promise(function (resolve, reject) {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.cwLoading === "true") {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.id = id;
      script.src = chrome.runtime.getURL(fileName);
      script.async = false;
      script.dataset.cwLoading = "true";
      script.addEventListener("load", function () {
        script.dataset.cwLoading = "false";
        script.dataset.cwLoaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", function () {
        script.dataset.cwLoading = "false";
        reject(new Error("load page script failed: " + fileName));
      }, { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
  }

  const automationScriptLoads = {};

  function loadAutomationScripts(automation) {
    if (!automationScriptLoads[automation.name]) {
      automationScriptLoads[automation.name] = automation.scripts.reduce(function (chain, scriptConfig) {
        return chain.then(function () {
          return injectPageScript(scriptConfig.id, scriptConfig.fileName);
        });
      }, Promise.resolve()).catch(function (error) {
        delete automationScriptLoads[automation.name];
        throw error;
      });
    }
    return automationScriptLoads[automation.name];
  }

  function handleAutomationLoadError(automation, error) {
    console.error("[cw-content] load automation scripts failed", {
      automation: automation.name,
      error: error && error.message ? error.message : String(error)
    });
  }

  function ensureAutomation() {
    AUTOMATIONS.forEach(function (automation) {
      if (!automation.matcher()) {
        return;
      }
      loadAutomationScripts(automation)
        .then(function () {
          automation.ensurePanel();
        })
        .catch(function (error) {
          handleAutomationLoadError(automation, error);
        });
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

  function normalizeButtonText(el) {
    return String((el && (el.textContent || el.value)) || "").replace(/\s+/g, "").trim();
  }

  function isVisibleControl(el) {
    if (!el) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return Boolean(el.offsetParent || el.getClientRects().length);
  }

  function getToolbarControls(toolbar) {
    return Array.from(
      toolbar.querySelectorAll("button, a, input[type='button'], input[type='submit']")
    ).filter(isVisibleControl);
  }

  function findWorkToolbar() {
    return document.querySelector(".panel-toolbar.pull-right");
  }

  function findToolbarReturnButton(toolbar) {
    return getToolbarControls(toolbar).find(function (el) {
      return normalizeButtonText(el) === "返回";
    }) || null;
  }

  function hasToolbarAction(toolbar, action) {
    return getToolbarControls(toolbar).some(function (el) {
      const text = normalizeButtonText(el);
      if (action === "save") {
        return text === "保存" || text === "提交";
      }
      return false;
    });
  }

  function setToolbarFallbackButtonsDisabled(disabled) {
    const button = document.getElementById(WORK_TOOLBAR_SAVE_BTN_ID);
    if (!button) {
      return;
    }
    button.disabled = disabled;
    button.style.opacity = disabled ? "0.7" : "1";
    button.style.cursor = disabled ? "not-allowed" : "pointer";
  }

  function setToolbarActionStatus(text, running) {
    toolbarActionRunning = running;
    setWorkStatus(text, running);
    setToolbarFallbackButtonsDisabled(running);
  }

  function sendToolbarAction(action) {
    if (workRunning || toolbarActionRunning) {
      return;
    }

    setToolbarActionStatus("保存中...", true);
    window.postMessage(
      {
        source: WORK_SOURCE_CONTENT,
        type: "CW_TOOLBAR_ACTION",
        action: action
      },
      "*"
    );
  }

  function createToolbarFallbackButton(id, text, action) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.textContent = text;
    button.className = "btn btn-info";
    button.addEventListener("click", function () {
      sendToolbarAction(action);
    });
    return button;
  }

  function ensureToolbarFallbackActions() {
    const toolbar = findWorkToolbar();
    if (!toolbar) {
      return;
    }

    const returnButton = findToolbarReturnButton(toolbar);
    if (!returnButton) {
      return;
    }

    const existingSaveButton = document.getElementById(WORK_TOOLBAR_SAVE_BTN_ID);
    if (!hasToolbarAction(toolbar, "save") && !existingSaveButton) {
      returnButton.insertAdjacentElement(
        "beforebegin",
        createToolbarFallbackButton(WORK_TOOLBAR_SAVE_BTN_ID, "保存", "save")
      );
    }
  }

  function ensureWorkButton() {
    if (!isWorkReportPage()) {
      return;
    }

    ensureToolbarFallbackActions();

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
    wrapper.style.cssText = "margin-left: 8px; position: relative;margin-top: -3%;";

    const button = document.createElement("button");
    button.id = WORK_BTN_ID;
    button.type = "button";
    button.textContent = "一键报工";
    button.className = "btn btn-info ";
    button.style.cssText = "margin-top: -3%;";

    const dropdownButton = document.createElement("button");
    dropdownButton.id = WORK_DROPDOWN_BTN_ID;
    dropdownButton.type = "button";
    dropdownButton.textContent = "▾";
    dropdownButton.title = "选择报工动作";
    dropdownButton.className = "btn btn-info ";
    dropdownButton.style.cssText = "margin-top: -3%; padding-left: 8px; padding-right: 8px;";

    const menu = document.createElement("div");
    menu.id = WORK_MENU_ID;
    menu.style.cssText = [
      "display:none",
      "position:absolute",
      "top:100%",
      "left:0",
      "z-index:99999",
      "min-width:112px",
      "background:#fff",
      "border:1px solid #c8d0d9",
      "box-shadow:0 2px 8px rgba(0,0,0,.16)",
      "padding:4px 0"
    ].join(";");

    const status = document.createElement("span");
    status.id = WORK_STATUS_ID;
    status.textContent = "";
    status.style.cssText = "font-size:12px;color:#666;max-width:420px;word-break:break-all;display:inline-flex;align-items:center;vertical-align:middle;";

    function closeMenu() {
      menu.style.display = "none";
    }

    function sendBatchWorkStart(mode, confirmText) {
      if (workRunning) {
        return;
      }

      const confirmed = window.confirm(confirmText);
      if (!confirmed) {
        return;
      }
      closeMenu();

      window.postMessage(
        {
          source: WORK_SOURCE_CONTENT,
          type: "CW_BATCH_WORK_START",
          mode: mode
        },
        "*"
      );
    }

    function createMenuItem(text, mode, confirmText) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = text;
      item.dataset.mode = mode;
      item.style.cssText = [
        "display:block",
        "width:100%",
        "border:0",
        "background:#fff",
        "padding:6px 12px",
        "text-align:left",
        "cursor:pointer",
        "font:inherit",
        "color:#1f2933"
      ].join(";");
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        sendBatchWorkStart(mode, confirmText);
      });
      return item;
    }

    menu.appendChild(createMenuItem("仅填周报", "summary", "将生成周报总结并保存当前周报。是否继续？"));
    menu.appendChild(createMenuItem("仅填工时", "hours", "将填写本周工时并保存当前周报。是否继续？"));
    menu.appendChild(createMenuItem("仅填计划", "plan", "将填写下周 WBS 计划但不自动保存。是否继续？"));

    button.addEventListener("click", function () {
      sendBatchWorkStart("all", "将批量填充报工并立即触发保存。是否继续？");
    });

    dropdownButton.addEventListener("click", function (event) {
      event.stopPropagation();
      if (workRunning) {
        return;
      }
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });

    document.addEventListener("click", function (event) {
      if (!wrapper.contains(event.target)) {
        closeMenu();
      }
    });

    wrapper.appendChild(button);
    wrapper.appendChild(dropdownButton);
    wrapper.appendChild(menu);
    wrapper.appendChild(status);
    recalcButton.insertAdjacentElement("afterend", wrapper);
  }

  function setWorkStatus(text, running) {
    setAutomationStatus("work", text, running);
    const disabled = workRunning;
    const dropdownButton = document.getElementById(WORK_DROPDOWN_BTN_ID);
    const menu = document.getElementById(WORK_MENU_ID);
    if (dropdownButton) {
      dropdownButton.disabled = disabled;
      dropdownButton.style.opacity = disabled ? "0.7" : "1";
      dropdownButton.style.cursor = disabled ? "not-allowed" : "pointer";
    }
    if (menu) {
      if (disabled) {
        menu.style.display = "none";
      }
      Array.from(menu.querySelectorAll("button")).forEach(function (item) {
        item.disabled = disabled;
        item.style.opacity = disabled ? "0.7" : "1";
        item.style.cursor = disabled ? "not-allowed" : "pointer";
      });
    }
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

      if (message.type === "warning") {
        console.warn("[cw-weekly-summary-ai] background warning", {
          requestId: requestId,
          message: message.message || ""
        });
        postToPage({
          type: "CW_WEEKLY_SUMMARY_AI_STATUS",
          requestId: requestId,
          message: message.message || "模型流片段解析警告"
        });
        return;
      }

      if (message.type === "reasoning") {
        console.info("[cw-weekly-summary-ai] reasoning received", {
          requestId: requestId,
          index: message.index,
          length: String(message.text || "").length,
          text: message.text || ""
        });
        postToPage({
          type: "CW_WEEKLY_SUMMARY_AI_REASONING",
          requestId: requestId,
          index: message.index,
          text: message.text || ""
        });
        return;
      }

      if (message.type === "chunk") {
        console.info("[cw-weekly-summary-ai] chunk received", {
          requestId: requestId,
          length: String(message.text || "").length,
          text: message.text || ""
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
    },
    CW_TOOLBAR_ACTION_RUNNING: function (data) {
      setToolbarActionStatus(data.message || "处理中", true);
    },
    CW_TOOLBAR_ACTION_DONE: function (data) {
      setToolbarActionStatus(data.message || "完成", false);
    },
    CW_TOOLBAR_ACTION_ERROR: function (data) {
      setToolbarActionStatus(data.message || "失败", false);
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
