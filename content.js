(function () {
  if (window.__cwDailyApprovalContentLoaded) {
    return;
  }
  window.__cwDailyApprovalContentLoaded = true;

  const DAILY_SCRIPT_ID = "cw-daily-approval-page-script";
  const DAILY_PANEL_ID = "cw-daily-approval-panel";
  const DAILY_BTN_ID = "cw-daily-approval-btn";
  const DAILY_STATUS_ID = "cw-daily-approval-status";
  const DAILY_SOURCE_PAGE = "cw-daily-approval-page";
  const DAILY_SOURCE_CONTENT = "cw-daily-approval-content";

  const WORK_SCRIPT_ID = "cw-batch-work-page-script";
  const WORK_WRAPPER_ID = "cw-batch-work-wrapper";
  const WORK_BTN_ID = "cw-batch-work-btn";
  const WORK_STATUS_ID = "cw-batch-work-status";
  const WORK_SOURCE_PAGE = "cw-batch-work-page";
  const WORK_SOURCE_CONTENT = "cw-batch-work-content";

  let dailyRunning = false;
  let workRunning = false;

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

      const confirmed = window.confirm(
        "将逐个审批全部未审批日报，间隔 5 秒 + 随机 0-3 秒。是否继续？"
      );
      if (!confirmed) {
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
    const status = document.getElementById(DAILY_STATUS_ID);
    const button = document.getElementById(DAILY_BTN_ID);
    if (typeof running === "boolean") {
      dailyRunning = running;
    }
    if (status) {
      status.textContent = text;
      status.style.color = dailyRunning ? "#0b73f6" : "#666";
    }
    if (button) {
      button.disabled = dailyRunning;
      button.style.opacity = dailyRunning ? "0.7" : "1";
      button.style.cursor = dailyRunning ? "not-allowed" : "pointer";
      button.textContent = dailyRunning ? "审批中..." : "批量审批未审批日报";
    }
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

    if (document.getElementById(WORK_BTN_ID) || document.getElementById(WORK_WRAPPER_ID)) {
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
    const status = document.getElementById(WORK_STATUS_ID);
    const button = document.getElementById(WORK_BTN_ID);
    if (typeof running === "boolean") {
      workRunning = running;
    }
    if (status) {
      status.textContent = text;
      status.style.color = workRunning ? "#0b73f6" : "#666";
    }
    if (button) {
      button.disabled = workRunning;
      button.style.opacity = workRunning ? "0.7" : "1";
      button.style.cursor = workRunning ? "not-allowed" : "pointer";
      button.textContent = workRunning ? "报工中..." : "批量报工";
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data) {
      return;
    }

    if (data.source === DAILY_SOURCE_PAGE) {
      if (data.type === "CW_DAILY_APPROVAL_RUNNING") {
        setDailyStatus(data.message || "处理中", true);
        return;
      }

      if (data.type === "CW_DAILY_APPROVAL_PROGRESS") {
        setDailyStatus(data.message || "处理中", true);
        return;
      }

      if (data.type === "CW_DAILY_APPROVAL_DONE") {
        setDailyStatus(data.message || "完成", false);
        tryRefreshApprovalGrid();
        if (data.shouldReload) {
          reloadCurrentPageSoon();
        }
        return;
      }

      if (data.type === "CW_DAILY_APPROVAL_ERROR") {
        setDailyStatus(data.message || "失败", false);
        return;
      }
    }

    if (data.source === WORK_SOURCE_PAGE) {
      if (data.type === "CW_BATCH_WORK_RUNNING") {
        setWorkStatus(data.message || "处理中", true);
        return;
      }

      if (data.type === "CW_BATCH_WORK_DONE") {
        setWorkStatus(data.message || "完成", false);
        return;
      }

      if (data.type === "CW_BATCH_WORK_ERROR") {
        setWorkStatus(data.message || "失败", false);
        return;
      }

      return;
    }
  });

  injectPageScript(DAILY_SCRIPT_ID, "page-batch-approve.js");
  injectPageScript(WORK_SCRIPT_ID, "page-batch-work.js");
  ensureDailyPanel();
  ensureWorkButton();

  const observer = new MutationObserver(function () {
    ensureDailyPanel();
    ensureWorkButton();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
