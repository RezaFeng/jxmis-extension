import { normalizeProject } from "../../analytics/domain.js";
import { fetchJson, getBaseUrl } from "../shared/jxmis-transport.js";

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

  async function fetchDepartments(signal) {
    const params = new URLSearchParamsCtor({
      unitQueryType: "selfAndChild",
      selection: "single",
      id: "10000"
    });
    return fetchJson(
      function (url, options) { return fetchFn(url, Object.assign({}, options, { signal })); },
      baseUrl() + "/rest/org/tree/unitTree?" + params.toString(),
      "fetch analytics departments"
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
      return fetchJson(
        function (url, options) { return fetchFn(url, Object.assign({}, options, { signal })); },
        baseUrl() + "/rest/project/ProjectInfoService/query?" + params.toString(),
        "fetch analytics projects page " + page.page
      );
    }, { pageSize });
    const byId = new Map();
    rows.forEach(function (row) {
      const project = normalizeProject(row);
      byId.set(project.projectId, project);
    });
    return [...byId.values()];
  }

  return { fetchDepartments, fetchProjects };
}
