import { createAiBridge } from "./ai-bridge.js";
import { createAutomationRegistry } from "./automation-registry.js";
import { createPageScriptLoader } from "./page-script-loader.js";
import { createStatusControl } from "./status-control.js";
import { getCacheResultType, MESSAGE_TYPES, SOURCES } from "../shared/protocol.js";
import { createBusinessAnalyticsController } from "./business-analytics/controller.js";

export function startContentRuntime(adapters) {
  const window = adapters.window;
  const document = adapters.document || window.document;
  const chrome = adapters.chrome;
  const MutationObserver = adapters.MutationObserver || window.MutationObserver;
  if (window.top !== window.self) {
    return null;
  }

  if (window.__cwDailyApprovalContentLoaded) {
    return null;
  }
  window.__cwDailyApprovalContentLoaded = true;

  const DAILY_SCRIPT_ID = "cw-daily-approval-page-script";
  const DAILY_PANEL_ID = "cw-daily-approval-panel";
  const DAILY_BTN_ID = "cw-daily-approval-btn";
  const DAILY_STATUS_ID = "cw-daily-approval-status";
  const DAILY_SOURCE_PAGE = SOURCES.DAILY_PAGE;
  const DAILY_SOURCE_CONTENT = SOURCES.DAILY_CONTENT;

  const WORK_SCRIPT_ID = "cw-batch-work-page-script";
  const WORK_WRAPPER_ID = "cw-batch-work-wrapper";
  const WORK_BTN_ID = "cw-batch-work-btn";
  const WORK_DROPDOWN_BTN_ID = "cw-batch-work-dropdown-btn";
  const WORK_MENU_ID = "cw-batch-work-menu";
  const WORK_STATUS_ID = "cw-batch-work-status";
  const WORK_TOOLBAR_SAVE_BTN_ID = "cw-toolbar-fallback-save-btn";
  const WORK_SOURCE_PAGE = SOURCES.WORK_PAGE;
  const WORK_SOURCE_CONTENT = SOURCES.WORK_CONTENT;

  const WEEKLY_SCRIPT_ID = "cw-weekly-approval-page-script";
  const WEEKLY_BTN_ID = "cw-weekly-approval-btn";
  const WEEKLY_STATUS_ID = "cw-weekly-approval-status";
  const WEEKLY_SOURCE_PAGE = SOURCES.WEEKLY_PAGE;
  const WEEKLY_SOURCE_CONTENT = SOURCES.WEEKLY_CONTENT;

  let dailyRunning = false;
  let workRunning = false;
  let toolbarActionRunning = false;
  let weeklyRunning = false;

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
  const statusControl = createStatusControl(document, STATUS_CONTROLS);
  const pageScriptLoader = adapters.pageScriptLoader || createPageScriptLoader(document, chrome);
  const businessAnalyticsController = adapters.businessAnalyticsController ||
    createBusinessAnalyticsController({ window, document, chrome });

  const AUTOMATIONS = [
    {
      name: "daily",
      matcher: isDailyApprovalPage,
      scripts: [
        {
          id: DAILY_SCRIPT_ID,
          fileName: "page-daily-approval.js"
        }
      ],
      ensurePanel: ensureDailyPanel
    },
    {
      name: "work",
      matcher: isWorkReportPage,
      scripts: [
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
          id: WEEKLY_SCRIPT_ID,
          fileName: "page-weekly-approval.js"
        }
      ],
      ensurePanel: ensureWeeklyApprovalPanel
    },
    {
      name: "businessAnalytics",
      matcher: isBusinessAnalyticsPage,
      scripts: [{ id: "cw-business-analytics-page-script", fileName: "page-business-analytics.js" }],
      ensurePanel: businessAnalyticsController.ensureNavigation
    }
  ];

  function setAutomationStatus(controlName, text, running) {
    statusControl.set(controlName, text, running);
  }

  function injectPageScript(id, fileName) {
    return pageScriptLoader(id, fileName);
  }

  function postProjectManagerConfig(projectManager) {
    window.postMessage(
      {
        source: SOURCES.PROJECT_MANAGER,
        type: MESSAGE_TYPES.PROJECT_MANAGER_CONFIG,
        projectManager: String(projectManager || "").trim()
      },
      "*"
    );
  }

  function loadProjectManagerConfig() {
    chrome.storage.local.get(
      {
        projectManager: ""
      },
      function (data) {
        postProjectManagerConfig(data && data.projectManager);
      }
    );
  }

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local" || !changes.projectManager) {
      return;
    }
    postProjectManagerConfig(changes.projectManager.newValue);
  });

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

  const automationRegistry = createAutomationRegistry(
    AUTOMATIONS,
    loadAutomationScripts,
    handleAutomationLoadError
  );

  function ensureAutomation() {
    businessAnalyticsController.syncLocation();
    automationRegistry.ensure();
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

  function isBusinessAnalyticsPage() {
    const value = String(window.location.href || "") + " " + String(window.location.hash || "");
    return value.includes("/project/ProjectInfoService/projectinDedaultHomePage");
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
          type: MESSAGE_TYPES.DAILY_START
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
        type: MESSAGE_TYPES.TOOLBAR_ACTION,
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
          type: MESSAGE_TYPES.WORK_START,
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

  const aiBridge = createAiBridge({
    chrome: chrome,
    postToPage: postToPage,
    logger: console
  });

  function startAiSummary(data) {
    aiBridge.start(data);
  }

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function handleWeeklySummaryCacheRequest(data) {
    const type =
      data.type === MESSAGE_TYPES.CACHE_GET
        ? MESSAGE_TYPES.CACHE_GET
        : MESSAGE_TYPES.CACHE_SET;

    sendRuntimeMessage({
      type: type,
      key: data.key,
      value: data.value
    }).then(function (response) {
      postToPage({
        type: getCacheResultType(type),
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
          type: MESSAGE_TYPES.WEEKLY_START
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
    [MESSAGE_TYPES.DAILY_RUNNING]: function (data) {
      setDailyStatus(data.message || "处理中", true);
    },
    [MESSAGE_TYPES.DAILY_PROGRESS]: function (data) {
      setDailyStatus(data.message || "处理中", true);
    },
    [MESSAGE_TYPES.DAILY_DONE]: function (data) {
      setDailyStatus(data.message || "完成", false);
      tryRefreshApprovalGrid();
      if (data.shouldReload) {
        reloadCurrentPageSoon();
      }
    },
    [MESSAGE_TYPES.DAILY_ERROR]: function (data) {
      setDailyStatus(data.message || "失败", false);
    }
  };

  PAGE_MESSAGE_HANDLERS[WORK_SOURCE_PAGE] = {
    [MESSAGE_TYPES.AI_REQUEST]: function (data) {
      startAiSummary(data);
    },
    [MESSAGE_TYPES.CACHE_GET]: function (data) {
      handleWeeklySummaryCacheRequest(data);
    },
    [MESSAGE_TYPES.CACHE_SET]: function (data) {
      handleWeeklySummaryCacheRequest(data);
    },
    [MESSAGE_TYPES.WORK_RUNNING]: function (data) {
      setWorkStatus(data.message || "处理中", true);
    },
    [MESSAGE_TYPES.WORK_DONE]: function (data) {
      setWorkStatus(data.message || "完成", false);
    },
    [MESSAGE_TYPES.WORK_ERROR]: function (data) {
      setWorkStatus(data.message || "失败", false);
    },
    [MESSAGE_TYPES.TOOLBAR_RUNNING]: function (data) {
      setToolbarActionStatus(data.message || "处理中", true);
    },
    [MESSAGE_TYPES.TOOLBAR_DONE]: function (data) {
      setToolbarActionStatus(data.message || "完成", false);
    },
    [MESSAGE_TYPES.TOOLBAR_ERROR]: function (data) {
      setToolbarActionStatus(data.message || "失败", false);
    }
  };

  PAGE_MESSAGE_HANDLERS[WEEKLY_SOURCE_PAGE] = {
    [MESSAGE_TYPES.WEEKLY_RUNNING]: function (data) {
      setWeeklyStatus(data.message || "处理中", true);
    },
    [MESSAGE_TYPES.WEEKLY_PREVIEW]: function (data) {
      setWeeklyStatus(data.message || "待确认", true);
    },
    [MESSAGE_TYPES.WEEKLY_PROGRESS]: function (data) {
      setWeeklyStatus(data.message || "处理中", true);
    },
    [MESSAGE_TYPES.WEEKLY_DONE]: function (data) {
      setWeeklyStatus(data.message || "完成", false);
      if (data.shouldReload && !tryRefreshWeeklyGrid()) {
        reloadCurrentPageSoon();
      }
    },
    [MESSAGE_TYPES.WEEKLY_ERROR]: function (data) {
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

  loadProjectManagerConfig();
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

  return {
    aiBridge: aiBridge,
    ensureAutomation: ensureAutomation,
    businessAnalyticsController: businessAnalyticsController
  };
}
