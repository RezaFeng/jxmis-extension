import * as defaultTransport from "../shared/jxmis-transport.js";
import { normalizeWeeklyDetail } from "../shared/weekly-detail.js";
import { MESSAGE_TYPES, SOURCES, parseWindowMessage } from "../../shared/protocol.js";

export function createWeeklyApprovalAutomation(adapters) {
  const windowRef = adapters.window;
  const document = adapters.document || windowRef.document;
  const fetchFn = adapters.fetch;
  const transport = adapters.transport || defaultTransport;
  const URLSearchParamsCtor = adapters.URLSearchParams || globalThis.URLSearchParams;
  const MODAL_ID = "cw-weekly-approval-preview-modal";

  let running = false;

  const config = {
    pageSize: 25,
    reply: "已核实",
    baseDelayMs: 500,
    randomDelayMaxMs: 1000
  };

  function post(type, message, extra) {
    transport.post(windowRef, SOURCES.WEEKLY_PAGE, type, message, extra);
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

  async function fetchCurrentUser() {
    const data = await fetchJson(getBaseUrl() + "/rest/org/user", "fetch current user");
    const userId = (data && data.userId) || (data && data.user && data.user.userId);
    const userFullName = (data && data.userFullName) || (data && data.user && data.user.userFullName);
    if (!userId) {
      throw new Error("current userId not found");
    }
    if (!userFullName) {
      throw new Error("current userFullName not found");
    }
    return {
      userId: String(userId),
      userFullName: String(userFullName)
    };
  }

  function readControlValue(names) {
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const el = document.querySelector(
        "[name='" + name + "'],#" + name + ",[data-name='" + name + "']"
      );
      if (el && el.value != null && String(el.value).trim() !== "") {
        return String(el.value).trim();
      }
    }
    return "";
  }

  function normalizeNumber(value, fallback) {
    const text = String(value || "").trim();
    const match = text.match(/\d+/);
    if (!match) {
      return String(fallback);
    }
    return String(Number(match[0]));
  }

  function getQueryRange() {
    const now = adapters.now ? adapters.now() : new Date();
    const year = normalizeNumber(
      readControlValue(["year", "wkYear", "queryYear", "searchYear"]),
      now.getFullYear()
    );
    const month = normalizeNumber(
      readControlValue(["month", "wkMonth", "queryMonth", "searchMonth"]),
      now.getMonth() + 1
    );
    const monthEnd = normalizeNumber(
      readControlValue(["monthEnd", "endMonth", "wkMonthEnd", "queryMonthEnd"]),
      month
    );

    return {
      year: year,
      month: month,
      monthEnd: monthEnd
    };
  }

  async function fetchWeeklyPage(currentUser, range, page) {
    const params = new URLSearchParamsCtor({
      queryName: "queryList",
      filterQuery: "true",
      queryType: "page",
      year: String(range.year),
      month: String(range.month),
      monthEnd: String(range.monthEnd),
      likeAll: currentUser.userFullName,
      draw: String(page),
      page: String(page),
      start: String((page - 1) * config.pageSize),
      length: String(config.pageSize),
      rows: String(config.pageSize)
    });

    return fetchJson(
      getBaseUrl() + "/rest/project/WkReportService/query?" + params.toString(),
      "fetch weekly page " + page
    );
  }

  async function fetchAllCandidateRows(currentUser, range) {
    const candidates = [];
    let page = 1;

    while (true) {
      const pageData = await fetchWeeklyPage(currentUser, range, page);
      const rows = Array.isArray(pageData && pageData.rows) ? pageData.rows : [];

      rows.forEach(function (row) {
        if (
          row &&
          String(row.prodPerson || "") === currentUser.userId &&
          String(row.status) === "20"
        ) {
          candidates.push(row);
        }
      });

      const total = Number(
        (pageData && (pageData.recordsFiltered || pageData.total || pageData.recordsTotal)) || 0
      );
      const pageCount = Number(pageData && pageData.pageCount) || (total > 0 ? Math.ceil(total / config.pageSize) : 0);

      if (pageCount > 0) {
        if (page >= pageCount) {
          break;
        }
      } else if (rows.length < config.pageSize) {
        break;
      }

      page += 1;
    }

    return candidates;
  }

  async function fetchWeeklyById(wkId) {
    const params = new URLSearchParamsCtor({
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

  async function addReply(wkId) {
    const params = new URLSearchParamsCtor({
      format: "json",
      wkId: String(wkId),
      reply: config.reply
    });
    const responseText = await transport.fetchText(
      fetchFn,
      getBaseUrl() + "/rest/project/WkReportService/addReply?" + params.toString(),
      "approve weekly " + wkId,
      { cache: "no-store" }
    );
    const text = responseText.trim();
    const normalized = text.replace(/^"+|"+$/g, "");
    if (normalized !== "批复完成") {
      throw new Error("approve weekly " + wkId + " unexpected response: " + text);
    }
    return normalized;
  }

  function getProjectName(row) {
    return String((row && (row.projectName || row.projName || row.prjName || row.wkName || row.wkNum)) || "-");
  }

  function getProjectManager(row) {
    return String(
      (row && (
        row.projectManagerName ||
        row.pmName ||
        row.managerName ||
        row.projectManager ||
        row.pm ||
        row.manager
      )) ||
        "-"
    );
  }

  function removeModal() {
    const old = document.getElementById(MODAL_ID);
    if (old) {
      old.remove();
    }
  }

  function showPreviewDialog(rows, range) {
    removeModal();

    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.id = MODAL_ID;
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:rgba(0,0,0,.35)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
        "box-sizing:border-box"
      ].join(";");

      const dialog = document.createElement("div");
      dialog.style.cssText = [
        "width:min(760px,calc(100vw - 48px))",
        "max-height:min(680px,calc(100vh - 48px))",
        "background:#fff",
        "border-radius:6px",
        "box-shadow:0 12px 32px rgba(0,0,0,.24)",
        "display:flex",
        "flex-direction:column",
        "overflow:hidden",
        "font-size:14px",
        "color:#222"
      ].join(";");

      const header = document.createElement("div");
      header.style.cssText = "padding:16px 20px;border-bottom:1px solid #e5e5e5;font-weight:600;font-size:16px;";
      header.textContent = "待审核项目列表";

      const body = document.createElement("div");
      body.style.cssText = "padding:14px 20px;overflow:auto;";

      const summary = document.createElement("div");
      summary.style.cssText = "margin-bottom:10px;color:#555;line-height:1.5;";
      summary.textContent =
        "当前范围：" +
        range.year +
        "年" +
        range.month +
        "月至" +
        range.monthEnd +
        "月，共 " +
        rows.length +
        " 条。只会审核生产负责人为当前用户的待审核周报。";

      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;table-layout:fixed;";

      const thead = document.createElement("thead");
      thead.innerHTML =
        "<tr>" +
        "<th style='width:58%;text-align:left;padding:8px;border:1px solid #e5e5e5;background:#f7f7f7;'>项目名称</th>" +
        "<th style='width:22%;text-align:left;padding:8px;border:1px solid #e5e5e5;background:#f7f7f7;'>项目经理</th>" +
        "<th style='width:20%;text-align:left;padding:8px;border:1px solid #e5e5e5;background:#f7f7f7;'>生产负责人</th>" +
        "</tr>";

      const tbody = document.createElement("tbody");
      rows.forEach(function (row) {
        const tr = document.createElement("tr");
        [getProjectName(row), getProjectManager(row), String(row.prodPersonName || "-")].forEach(function (text) {
          const td = document.createElement("td");
          td.textContent = text;
          td.title = text;
          td.style.cssText = "padding:8px;border:1px solid #e5e5e5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      body.appendChild(summary);
      body.appendChild(table);

      const footer = document.createElement("div");
      footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid #e5e5e5;background:#fafafa;";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.style.cssText = "padding:6px 14px;border:1px solid #bbb;background:#fff;border-radius:4px;cursor:pointer;";

      const ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = "确认批量审核";
      ok.style.cssText = "padding:6px 14px;border:1px solid #0b73f6;background:#0b73f6;color:#fff;border-radius:4px;cursor:pointer;";

      function finish(value) {
        removeModal();
        resolve(value);
      }

      cancel.addEventListener("click", function () {
        finish(false);
      });
      ok.addEventListener("click", function () {
        finish(true);
      });
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) {
          finish(false);
        }
      });

      footer.appendChild(cancel);
      footer.appendChild(ok);
      dialog.appendChild(header);
      dialog.appendChild(body);
      dialog.appendChild(footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  async function approveOne(row, index, total, currentUser) {
    const wkId = row && row.wkId;
    if (!wkId) {
      return {
        status: "failed",
        message: "wkId missing"
      };
    }

    post(
      MESSAGE_TYPES.WEEKLY_PROGRESS,
      "[" + (index + 1) + "/" + total + "] 复查中: " + getProjectName(row)
    );

    const latest = await fetchWeeklyById(wkId);
    if (
      !latest ||
      String(latest.prodPerson || "") !== currentUser.userId ||
      String(latest.status) !== "20"
    ) {
      return {
        status: "skipped",
        message: "生产负责人或状态已变化",
        latestStatus: latest && latest.status
      };
    }

    post(
      MESSAGE_TYPES.WEEKLY_PROGRESS,
      "[" + (index + 1) + "/" + total + "] 批复中: " + getProjectName(row)
    );
    await addReply(wkId);

    const verified = await fetchWeeklyById(wkId);
    if (verified && String(verified.status) === "30" && String(verified.prodPerson || "") === currentUser.userId) {
      return {
        status: "success",
        message: "批复完成",
        approvalTime: verified.approvalTime
      };
    }

    return {
      status: "unknown",
      message: "批复接口成功但复查状态未确认",
      latestStatus: verified && verified.status
    };
  }

  async function run() {
    if (running) {
      post(MESSAGE_TYPES.WEEKLY_RUNNING, "已有周报批量审核任务运行中");
      return;
    }

    running = true;

    try {
      post(MESSAGE_TYPES.WEEKLY_RUNNING, "读取当前用户中");
      const currentUser = await fetchCurrentUser();
      const range = getQueryRange();

      post(MESSAGE_TYPES.WEEKLY_RUNNING, "拉取待审核周报中");
      const rows = await fetchAllCandidateRows(currentUser, range);

      if (!rows.length) {
        post(MESSAGE_TYPES.WEEKLY_DONE, "无待审核周报", {
          shouldReload: false
        });
        return;
      }

      post(MESSAGE_TYPES.WEEKLY_PREVIEW, "待确认 " + rows.length + " 条");
      const confirmed = adapters.confirmPreview
        ? await adapters.confirmPreview(rows, range)
        : await showPreviewDialog(rows, range);
      if (!confirmed) {
        post(MESSAGE_TYPES.WEEKLY_DONE, "已取消批量审核", {
          shouldReload: false
        });
        return;
      }

      const summary = {
        success: 0,
        skipped: 0,
        failed: 0,
        unknown: 0
      };

      for (let i = 0; i < rows.length; i += 1) {
        try {
          const result = await approveOne(rows[i], i, rows.length, currentUser);
          summary[result.status] = (summary[result.status] || 0) + 1;
        } catch (error) {
          summary.failed += 1;
          post(
            MESSAGE_TYPES.WEEKLY_PROGRESS,
            "[" + (i + 1) + "/" + rows.length + "] 失败: " + (error && error.message ? error.message : String(error))
          );
        }

        if (i < rows.length - 1) {
          const delayMs = randomDelay();
          post(
            MESSAGE_TYPES.WEEKLY_PROGRESS,
            "[" + (i + 1) + "/" + rows.length + "] 已处理，等待 " + delayMs + "ms 后继续"
          );
          await sleep(delayMs);
        }
      }

      post(
        MESSAGE_TYPES.WEEKLY_DONE,
        "周报批量审核完成：成功 " +
          summary.success +
          "，跳过 " +
          summary.skipped +
          "，失败 " +
          summary.failed +
          "，待确认 " +
          summary.unknown,
        {
          shouldReload: summary.success > 0 || summary.unknown > 0
        }
      );
    } catch (error) {
      post(MESSAGE_TYPES.WEEKLY_ERROR, "周报批量审核失败: " + (error && error.message ? error.message : String(error)));
      throw error;
    } finally {
      running = false;
    }
  }

  return {
    preview: showPreviewDialog,
    run: run
  };
}

export function installWeeklyApprovalPage(windowRef = window) {
  if (windowRef.__cwWeeklyApprovalPageLoaded) {
    return null;
  }
  windowRef.__cwWeeklyApprovalPageLoaded = true;
  const automation = createWeeklyApprovalAutomation({
    window: windowRef,
    document: windowRef.document,
    fetch: windowRef.fetch.bind(windowRef),
    transport: defaultTransport
  });
  windowRef.addEventListener("message", function (event) {
    const parsed = parseWindowMessage(event, {
      windowRef: windowRef,
      source: SOURCES.WEEKLY_CONTENT,
      types: [MESSAGE_TYPES.WEEKLY_START]
    });
    if (!parsed.ok) {
      return;
    }
    automation.run().catch(function (error) {
      console.error("[cw-weekly-approval]", error);
    });
  });
  return automation;
}
