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

  function normalizeWeekRange(weekDate, fallbackDate) {
    const matches = String(weekDate || "").match(/\d{4}-\d{1,2}-\d{1,2}/g) || [];
    const first = matches[0] ? parseDate(matches[0]) : null;
    const second = matches[1] ? parseDate(matches[1]) : null;

    if (first && second && first.getDay() === 0 && second.getDay() === 6) {
      return {
        start: addDays(first, 1),
        end: addDays(second, 1)
      };
    }

    const base = first || fallbackDate || new Date();
    const start = mondayOf(base);
    return {
      start: start,
      end: addDays(start, 6)
    };
  }

  function readControlValue(documentRef, names) {
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const selectors = [
        "[name='" + name + "']",
        "#" + name,
        "[data-name='" + name + "']"
      ];
      for (let j = 0; j < selectors.length; j += 1) {
        const el = documentRef && documentRef.querySelector(selectors[j]);
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

  function parseWkIdFromLocation(locationRef) {
    const location = locationRef || {};
    const text = String(location.href || "") + " " + String(location.hash || "");
    const match = text.match(/\/WkReportService\/id\/([^/?#\s]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function requireAdapter(adapter, name) {
    if (!adapter || typeof adapter[name] !== "function") {
      throw new Error("weekly context adapter missing " + name);
    }
    return adapter[name];
  }

  async function fetchWeeklyById(wkId, adapter) {
    const getBaseUrl = requireAdapter(adapter, "getBaseUrl");
    const fetchJson = requireAdapter(adapter, "fetchJson");
    const normalizeWeeklyDetail = requireAdapter(adapter, "normalizeWeeklyDetail");
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

  async function fetchWeeklyRowsByProject(projectId, adapter) {
    const getBaseUrl = requireAdapter(adapter, "getBaseUrl");
    const fetchJson = requireAdapter(adapter, "fetchJson");
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

  function selectWeeklyRow(rows, wkId) {
    return (
      rows.find(function (item) {
        return wkId && String(item && item.wkId) === String(wkId);
      }) ||
      rows.find(function (item) {
        return String(item && item.status) === "10";
      }) ||
      rows[0] ||
      null
    );
  }

  async function getWeeklyContext(adapter) {
    const documentRef = adapter && adapter.document;
    const locationRef = adapter && adapter.location;
    const readValue = function (names) {
      return readControlValue(documentRef, names);
    };
    const locationWkId = parseWkIdFromLocation(locationRef);
    const wkId = readValue(["wkId"]) || locationWkId;
    let projectId = readValue(["projectId", "queryProjectId"]);
    let row = null;

    if (wkId) {
      row = await fetchWeeklyById(wkId, adapter).catch(function () {
        return null;
      });
    }

    if (!row && projectId) {
      const rows = await fetchWeeklyRowsByProject(projectId, adapter);
      row = selectWeeklyRow(rows, wkId);
    }

    projectId = projectId || String((row && row.projectId) || "");
    if (!projectId) {
      throw new Error("未找到当前项目 projectId");
    }

    const weekDate = readValue(["weekDate", "wkDate"]) || String((row && row.weekDate) || "");
    const range = normalizeWeekRange(weekDate, adapter && adapter.now);

    return {
      wkId: wkId || String((row && row.wkId) || ""),
      projectId: projectId,
      projectName: readValue(["projectName"]) || String((row && row.projectName) || ""),
      prodPerson: readValue(["prodPerson"]) || String((row && row.prodPerson) || ""),
      prodPersonName: readValue(["prodPersonName"]) || String((row && row.prodPersonName) || ""),
      projectManager: readValue(["projectManager"]) || String((row && row.projectManager) || ""),
      projectManagerName: readValue(["projectManagerName"]) || String((row && row.projectManagerName) || ""),
      weekDate: weekDate,
      weekStart: formatDate(range.start),
      weekEnd: formatDate(range.end),
      startDate: range.start,
      endDate: range.end
    };
  }

  export {
    parseDate,
    formatDate,
    addDays,
    mondayOf,
    normalizeWeekRange,
    readControlValue,
    parseWkIdFromLocation,
    fetchWeeklyById,
    fetchWeeklyRowsByProject,
    selectWeeklyRow,
    getWeeklyContext
  };
