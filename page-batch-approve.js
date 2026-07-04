(function () {
  if (window.__cwDailyApprovalPageLoaded) {
    return;
  }
  window.__cwDailyApprovalPageLoaded = true;

  const SOURCE_PAGE = "cw-daily-approval-page";
  const SOURCE_CONTENT = "cw-daily-approval-content";

  let running = false;

  const config = {
    pageSize: 50,
    approveState: "1",
    approvalTimely: "1",
    achievementComplete: "1",
    achievementQuality: "1",
    approvalComment: "",
    baseDelayMs: 500,
    randomDelayMaxMs: 1000
  };

  function post(type, message, extra) {
    window.CwJxmisTransport.post(window, SOURCE_PAGE, type, message, extra);
  }

  function sleep(ms) {
    return window.CwJxmisTransport.sleep(window, ms);
  }

  function randomDelay() {
    return window.CwJxmisTransport.randomDelay(config);
  }

  function getWebapp() {
    return window.CwJxmisTransport.getWebapp(window.localStorage);
  }

  function getBaseUrl() {
    return window.CwJxmisTransport.getBaseUrl(window.location, window.localStorage);
  }

  async function assertOk(response, label) {
    return window.CwJxmisTransport.assertOk(response, label);
  }

  async function fetchJson(url, label) {
    return window.CwJxmisTransport.fetchJson(fetch, url, label);
  }

  async function fetchCurrentUserId() {
    const data = await fetchJson(getBaseUrl() + "/rest/org/user", "fetch current user");
    const userId = (data && data.userId) || (data && data.user && data.user.userId);
    if (!userId) {
      throw new Error("current userId not found");
    }
    return userId;
  }

  async function fetchPendingPage(projectManager, page) {
    const params = new URLSearchParams({
      queryName: "queryList",
      queryType: "page",
      approval_state: "0",
      projectManager: String(projectManager),
      draw: String(page),
      page: String(page),
      start: String((page - 1) * config.pageSize),
      length: String(config.pageSize),
      rows: String(config.pageSize)
    });

    return fetchJson(
      getBaseUrl() + "/rest/project/queryDailyApprovalService/query?" + params.toString(),
      "fetch pending page " + page
    );
  }

  async function fetchAllPendingRows(projectManager) {
    const firstPage = await fetchPendingPage(projectManager, 1);
    const rows = Array.isArray(firstPage && firstPage.rows) ? firstPage.rows.slice() : [];
    const total = Number(
      (firstPage && (firstPage.total || firstPage.recordsTotal)) || rows.length || 0
    );
    const pageCount = Number(firstPage && firstPage.pageCount) || Math.max(1, Math.ceil(total / config.pageSize));

    for (let page = 2; page <= pageCount; page += 1) {
      const pageData = await fetchPendingPage(projectManager, page);
      if (Array.isArray(pageData && pageData.rows) && pageData.rows.length > 0) {
        rows.push.apply(rows, pageData.rows);
      }
    }

    return rows;
  }

  function buildPayload(row) {
    if (row && (row.realFinishRate == null || row.realFinishRate === "")) {
      throw new Error("realFinishRate missing");
    }

    const payload = {
      id: String((row && row.id) || ""),
      type: String((row && row.type) || "task"),
      state: config.approveState,
      createTime: String((row && (row.createTime || row.time)) || ""),
      realFinishRate: String(row.realFinishRate),
      planTime: String(row && row.planTime != null ? row.planTime : 0),
      extId: String((row && row.extId) || ""),
      approvalTimely: config.approvalTimely,
      achievementComplete: config.achievementComplete,
      achievementQuality: config.achievementQuality,
      approvalComment: config.approvalComment
    };

    const missing = ["id", "type", "createTime", "extId"].filter(function (key) {
      return !payload[key];
    });
    if (missing.length > 0) {
      throw new Error("missing required fields: " + missing.join(", "));
    }

    return payload;
  }

  async function approveOne(row, index, total) {
    const payload = buildPayload(row);
    post(
      "CW_DAILY_APPROVAL_PROGRESS",
      "[" + (index + 1) + "/" + total + "] 审批中: " + (row.peopleName || "") + " / " + (row.taskName || payload.id)
    );

    const response = await fetch(getBaseUrl() + "/rest/project/ProjectRapportService/batchDailyApproval", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify([payload])
    });

    await assertOk(response, "approve " + payload.id);
    const text = (await response.text()).trim();
    const normalized = text.replace(/^"+|"+$/g, "");
    if (normalized !== "success") {
      throw new Error("approve " + payload.id + " unexpected response: " + text);
    }
  }

  async function run() {
    if (running) {
      post("CW_DAILY_APPROVAL_RUNNING", "已有审批任务运行中");
      return;
    }

    running = true;

    try {
      post("CW_DAILY_APPROVAL_RUNNING", "读取当前用户中");
      const projectManager = await fetchCurrentUserId();

      post("CW_DAILY_APPROVAL_RUNNING", "拉取未审批日报中");
      const rows = await fetchAllPendingRows(projectManager);

      if (!rows.length) {
        post("CW_DAILY_APPROVAL_DONE", "无未审批日报", {
          shouldReload: false
        });
        return;
      }

      post("CW_DAILY_APPROVAL_RUNNING", "共 " + rows.length + " 条，开始逐条审批");

      for (let i = 0; i < rows.length; i += 1) {
        await approveOne(rows[i], i, rows.length);

        if (i < rows.length - 1) {
          const delayMs = randomDelay();
          post(
            "CW_DAILY_APPROVAL_PROGRESS",
            "[" + (i + 1) + "/" + rows.length + "] 已完成，等待 " + delayMs + "ms 后继续"
          );
          await sleep(delayMs);
        }
      }

      post("CW_DAILY_APPROVAL_DONE", "审批完成，共处理 " + rows.length + " 条，准备刷新页面", {
        shouldReload: true
      });
    } catch (error) {
      post("CW_DAILY_APPROVAL_ERROR", "审批失败: " + (error && error.message ? error.message : String(error)));
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
    if (data.type === "CW_DAILY_APPROVAL_START") {
      run().catch(function (error) {
        console.error("[cw-daily-approval]", error);
      });
    }
  });
})();
