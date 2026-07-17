import * as defaultTransport from "../shared/jxmis-transport.js";
import { MESSAGE_TYPES, SOURCES, parseWindowMessage } from "../../shared/protocol.js";

export function createDailyApprovalAutomation(adapters) {
  const windowRef = adapters.window;
  const fetchFn = adapters.fetch;
  const transport = adapters.transport || defaultTransport;
  const URLSearchParamsCtor = adapters.URLSearchParams || globalThis.URLSearchParams;

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
    transport.post(windowRef, SOURCES.DAILY_PAGE, type, message, extra);
  }

  function sleep(ms) {
    return transport.sleep(windowRef, ms);
  }

  function randomDelay() {
    return transport.randomDelay(config, adapters.random);
  }

  function getBaseUrl() {
    return transport.getBaseUrl(windowRef.location, windowRef.localStorage);
  }

  async function fetchJson(url, label) {
    return transport.fetchJson(fetchFn, url, label);
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
    const params = new URLSearchParamsCtor({
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
      MESSAGE_TYPES.DAILY_PROGRESS,
      "[" + (index + 1) + "/" + total + "] 审批中: " + (row.peopleName || "") + " / " + (row.taskName || payload.id)
    );

    const text = await transport.fetchText(
      fetchFn,
      getBaseUrl() + "/rest/project/ProjectRapportService/batchDailyApproval",
      "approve " + payload.id,
      {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify([payload])
      }
    );
    const normalizedText = text.trim();
    const normalized = normalizedText.replace(/^"+|"+$/g, "");
    if (normalized !== "success") {
      throw new Error("approve " + payload.id + " unexpected response: " + normalizedText);
    }
  }

  async function run() {
    if (running) {
      post(MESSAGE_TYPES.DAILY_RUNNING, "已有审批任务运行中");
      return;
    }

    running = true;

    try {
      post(MESSAGE_TYPES.DAILY_RUNNING, "读取当前用户中");
      const projectManager = await fetchCurrentUserId();

      post(MESSAGE_TYPES.DAILY_RUNNING, "拉取未审批日报中");
      const rows = await fetchAllPendingRows(projectManager);

      if (!rows.length) {
        post(MESSAGE_TYPES.DAILY_DONE, "无未审批日报", {
          shouldReload: false
        });
        return;
      }

      post(MESSAGE_TYPES.DAILY_RUNNING, "共 " + rows.length + " 条，开始逐条审批");

      for (let i = 0; i < rows.length; i += 1) {
        await approveOne(rows[i], i, rows.length);

        if (i < rows.length - 1) {
          const delayMs = randomDelay();
          post(
            MESSAGE_TYPES.DAILY_PROGRESS,
            "[" + (i + 1) + "/" + rows.length + "] 已完成，等待 " + delayMs + "ms 后继续"
          );
          await sleep(delayMs);
        }
      }

      post(MESSAGE_TYPES.DAILY_DONE, "审批完成，共处理 " + rows.length + " 条，准备刷新页面", {
        shouldReload: true
      });
    } catch (error) {
      post(MESSAGE_TYPES.DAILY_ERROR, "审批失败: " + (error && error.message ? error.message : String(error)));
      throw error;
    } finally {
      running = false;
    }
  }

  return { run };
}

export function installDailyApprovalPage(windowRef = window) {
  if (windowRef.__cwDailyApprovalPageLoaded) {
    return null;
  }
  windowRef.__cwDailyApprovalPageLoaded = true;
  const automation = createDailyApprovalAutomation({
    window: windowRef,
    fetch: windowRef.fetch.bind(windowRef),
    transport: defaultTransport
  });

  windowRef.addEventListener("message", function (event) {
    const parsed = parseWindowMessage(event, {
      windowRef: windowRef,
      source: SOURCES.DAILY_CONTENT,
      types: [MESSAGE_TYPES.DAILY_START]
    });
    if (!parsed.ok) {
      return;
    }
    automation.run().catch(function (error) {
      console.error("[cw-daily-approval]", error);
    });
  });
  return automation;
}
