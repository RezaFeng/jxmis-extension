import { normalizeProject } from "../../analytics/domain.js";
import { fetchJson, getBaseUrl } from "../shared/jxmis-transport.js";
import {
  normalizeDailyRow,
  normalizeMilestoneRows,
  normalizeWbsRows
} from "./normalizers.js";
import {
  aggregateWeeklyReports,
  normalizeWeeklyReportDetail,
  selectWeeklyReports,
  weeklyReportApplies
} from "./weekly-reports.js";
import { associateReceivableRows } from "./invoice.js";

const DEFAULT_PAGE_SIZE = 200;

function responseRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload && payload.rows)) {
    return payload.rows;
  }
  if (Array.isArray(payload && payload.data)) {
    return payload.data;
  }
  return [];
}

function responseTotal(payload) {
  const value = payload && (payload.recordsTotal ?? payload.recordsFiltered ?? payload.total);
  const total = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(total) && total >= 0
    ? total
    : null;
}

export async function fetchAllAnalyticsPages(fetchPage, options = {}) {
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const rows = [];
  let offset = 0;
  let expectedTotal = null;
  while (expectedTotal === null || rows.length < expectedTotal) {
    const payload = await fetchPage({ offset, pageSize, page: Math.floor(offset / pageSize) + 1 });
    const pageRows = responseRows(payload);
    const reportedTotal = responseTotal(payload);
    if (reportedTotal !== null) {
      expectedTotal = reportedTotal;
    }
    rows.push.apply(rows, pageRows);
    if (pageRows.length === 0 || expectedTotal === 0 || expectedTotal === rows.length) {
      break;
    }
    if (expectedTotal !== null && pageRows.length < pageSize && rows.length < expectedTotal) {
      throw new Error("pagination ended before recordsTotal: " + rows.length + "/" + expectedTotal);
    }
    if (expectedTotal === null && pageRows.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  if (expectedTotal !== null && rows.length < expectedTotal) {
    throw new Error("pagination incomplete: " + rows.length + "/" + expectedTotal);
  }
  return rows;
}

export function createJxpmoAnalyticsData(adapters) {
  const fetchFn = adapters.fetch;
  const location = adapters.location;
  const storage = adapters.storage;
  const URLSearchParamsCtor = adapters.URLSearchParams || URLSearchParams;
  const pageSize = adapters.pageSize || DEFAULT_PAGE_SIZE;
  const baseUrl = function () { return getBaseUrl(location, storage); };

  function sessionExpired() {
    const error = new Error("SESSION_EXPIRED");
    error.code = "SESSION_EXPIRED";
    return error;
  }

  async function fetchAnalyticsJson(url, label, signal) {
    const payload = await fetchJson(
      async function (requestUrl, options) {
        const response = await fetchFn(requestUrl, Object.assign({}, options, { signal }));
        const responseUrl = String(response && response.url || "");
        const contentType = response && response.headers && response.headers.get
          ? String(response.headers.get("content-type") || "")
          : "";
        let loginHtml = false;
        if (/text\/html/i.test(contentType) && response && typeof response.clone === "function") {
          const text = await response.clone().text().catch(function () { return ""; });
          loginHtml = /登录|login|JSESSIONID|signin/i.test(text);
        }
        if (
          (response && [302, 401, 403].includes(response.status)) ||
          (response && response.redirected && /login|signin/i.test(responseUrl)) ||
          loginHtml
        ) {
          throw sessionExpired();
        }
        return response;
      },
      url,
      label
    );
    if (
      (payload && [401, 403, "401", "403", "SESSION_EXPIRED"].includes(payload.code)) ||
      (payload && payload.success === false && /登录|login|session/i.test(String(payload.message || payload.msg || "")))
    ) {
      throw sessionExpired();
    }
    return payload;
  }

  async function fetchDepartments(signal) {
    const params = new URLSearchParamsCtor({
      unitQueryType: "selfAndChild",
      selection: "single",
      id: "10000"
    });
    return fetchAnalyticsJson(
      baseUrl() + "/rest/org/tree/unitTree?" + params.toString(),
      "fetch analytics departments",
      signal
    );
  }

  async function fetchProjects(signal) {
    const permissionParams = Object.assign({}, adapters.projectQueryParams || {});
    ["likeAll", "projectDept", "projectDeptName", "start", "length", "rows", "page", "draw"]
      .forEach(function (key) { delete permissionParams[key]; });
    const rows = await fetchAllAnalyticsPages(async function (page) {
      const params = new URLSearchParamsCtor(Object.assign({}, permissionParams, {
        queryName: "queryList",
        filterQuery: "true",
        queryType: "page",
        draw: String(page.page),
        page: String(page.page),
        start: String(page.offset),
        length: String(page.pageSize),
        rows: String(page.pageSize)
      }));
      return fetchAnalyticsJson(
        baseUrl() + "/rest/project/ProjectInfoService/query?" + params.toString(),
        "fetch analytics projects page " + page.page,
        signal
      );
    }, { pageSize });
    const byId = new Map();
    rows.forEach(function (row) {
      if (
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        (row.projectDept === null ||
          row.projectDept === undefined ||
          String(row.projectDept).trim() === "")
      ) {
        return;
      }
      const project = normalizeProject(row);
      byId.set(project.projectId, project);
    });
    return [...byId.values()];
  }

  async function fetchPagedEndpoint(path, params, label, signal) {
    const rows = await fetchAllAnalyticsPages(async function (page) {
      const query = new URLSearchParamsCtor(Object.assign({}, params, {
        filterQuery: "true",
        queryType: "page",
        draw: String(page.page),
        page: String(page.page),
        start: String(page.offset),
        length: String(page.pageSize),
        rows: String(page.pageSize)
      }));
      return fetchAnalyticsJson(
        baseUrl() + path + "?" + query.toString(),
        label + " page " + page.page,
        signal
      );
    }, { pageSize });
    return rows;
  }

  function result(rows) {
    return { status: rows.length > 0 ? "success" : "empty", rows };
  }

  async function fetchDailyRows(startDate, endDate, signal) {
    const rows = await fetchPagedEndpoint(
      "/rest/project/taskDetailService/query",
      { queryName: "queryTaskDetail", firstTaskDate: startDate, lastTaskDate: endDate },
      "fetch analytics daily rows",
      signal
    );
    return result(rows.map(normalizeDailyRow));
  }

  async function fetchWbs(projectId, signal) {
    const id = String(projectId);
    const rows = await fetchPagedEndpoint(
      "/rest/project/ProjectPlanDetailService/query",
      { queryName: "queryVer", max1: id, planId1: id },
      "fetch analytics WBS " + id,
      signal
    );
    return result(normalizeWbsRows(rows));
  }

  async function fetchMilestones(projectId, signal) {
    const id = String(projectId);
    const rows = await fetchPagedEndpoint(
      "/rest/project/ProjectPlanDetailService/query",
      { queryName: "queryLandmark", projectId: id },
      "fetch analytics milestones " + id,
      signal
    );
    return result(normalizeMilestoneRows(rows));
  }

  async function fetchWeeklyDetail(wkId, signal) {
    const query = new URLSearchParamsCtor({
      queryType: "all",
      queryName: "queryByProjectInfo",
      wkId: String(wkId)
    });
    return fetchAnalyticsJson(
      baseUrl() + "/rest/project/queryByProjectInfosService/query?" + query.toString(),
      "fetch analytics weekly detail " + wkId,
      signal
    );
  }

  async function fetchWeeklyReports(project, range, signal) {
    if (!weeklyReportApplies(project)) {
      return { status: "notApplicable", rows: [], replacedIds: [] };
    }
    const projectId = String(project.projectId);
    const list = await fetchPagedEndpoint(
      "/rest/project/WkReportService/query",
      { queryName: "queryByProjectId", projectId },
      "fetch analytics weekly reports " + projectId,
      signal
    );
    if (list.length === 0) {
      return { status: "empty", rows: [], replacedIds: [] };
    }
    const details = [];
    for (const listRow of list) {
      const wkId = String(listRow && listRow.wkId || "").trim();
      if (!wkId) {
        throw new Error("weekly.wkId is required");
      }
      const payload = await fetchWeeklyDetail(wkId, signal);
      details.push(normalizeWeeklyReportDetail(payload, listRow));
    }
    const selected = selectWeeklyReports(details, range);
    return {
      status: selected.reports.length > 0 ? "success" : "empty",
      rows: selected.reports,
      replacedIds: selected.replacedIds,
      aggregate: aggregateWeeklyReports(selected.reports)
    };
  }

  async function fetchReceivables(departmentId, projects, signal) {
    const params = {
      meetDateYear: "undefined",
      likeAll_: "1"
    };
    if (departmentId && String(departmentId) !== "all") {
      params.saleDept = String(departmentId);
    }
    const rows = await fetchPagedEndpoint(
      "/rest/contract/queryInvoicePlanDetailService/query",
      params,
      "fetch analytics receivables",
      signal
    );
    const associated = associateReceivableRows(rows, projects);
    return {
      status: rows.length > 0 ? "success" : "empty",
      rows: associated.rows,
      diagnostics: associated.diagnostics
    };
  }

  return {
    fetchDepartments,
    fetchProjects,
    fetchDailyRows,
    fetchWbs,
    fetchMilestones,
    fetchWeeklyReports,
    fetchReceivables
  };
}
