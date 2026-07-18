import { rangesIntersect } from "../../analytics/date-range.js";
import { AnalyticsSchemaError, normalizeIdentifier } from "../../analytics/domain.js";
import { normalizeApiDate } from "./normalizers.js";

function firstObject(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload && payload.rows)) return payload.rows[0] || null;
  if (Array.isArray(payload && payload.data)) return payload.data[0] || null;
  if (payload && payload.data && typeof payload.data === "object") return payload.data;
  if (payload && payload.result && typeof payload.result === "object") return payload.result;
  return payload && typeof payload === "object" ? payload : null;
}

export function parseWeeklyRange(value, field = "weekly.weekDate") {
  if (value && typeof value === "object" && value.startDate && value.endDate) {
    return {
      startDate: normalizeApiDate(value.startDate, field + ".startDate", { required: true }),
      endDate: normalizeApiDate(value.endDate, field + ".endDate", { required: true })
    };
  }
  const dates = String(value || "").match(/\d{4}[-/]\d{2}[-/]\d{2}/g) || [];
  if (dates.length < 2) {
    throw new AnalyticsSchemaError(field, "must contain a start and end date", value);
  }
  const range = {
    startDate: normalizeApiDate(dates[0].replaceAll("/", "-"), field + ".startDate", { required: true }),
    endDate: normalizeApiDate(dates[1].replaceAll("/", "-"), field + ".endDate", { required: true })
  };
  if (range.startDate > range.endDate) {
    throw new AnalyticsSchemaError(field, "start must not be after end", value);
  }
  return range;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeWeeklyReportDetail(payload, listRow = {}) {
  const detail = firstObject(payload);
  if (!detail) {
    throw new AnalyticsSchemaError("weekly.detail", "must be an object", payload);
  }
  const merged = Object.assign({}, listRow, detail);
  const range = parseWeeklyRange(
    merged.weekDate || merged.weekRange || {
      startDate: merged.startDate || merged.weekStartDate,
      endDate: merged.endDate || merged.weekEndDate
    }
  );
  return {
    wkId: normalizeIdentifier(merged.wkId || listRow.wkId, "weekly.wkId", { required: true }),
    projectId: normalizeIdentifier(merged.projectId || listRow.projectId, "weekly.projectId"),
    startDate: range.startDate,
    endDate: range.endDate,
    updatedAt: String(
      merged.modifyTime || merged.updateTime || merged.submissionTime || merged.createTime || ""
    ),
    status: normalizeIdentifier(merged.status, "weekly.status"),
    valid: ![false, 0, "0"].includes(merged.valid ?? merged.curValid ?? true),
    summary: String(merged.currWkResult || merged.summary || merged.weekSummary || ""),
    nextPlan: String(merged.nextWkPlan || merged.nextPlan || ""),
    currentExecutions: rows(
      merged.currentExecutions || merged.currWkExecutions || merged.currentExecutionRows
    ),
    nextExecutions: rows(
      merged.nextExecutions || merged.nextWkExecutions || merged.nextExecutionRows
    )
  };
}

function updateTime(report) {
  const value = Date.parse(String(report.updatedAt || "").replace(" ", "T"));
  return Number.isFinite(value) ? value : 0;
}

export function selectWeeklyReports(details, reportRange) {
  const byPeriod = new Map();
  const replacedIds = [];
  details.filter(function (detail) {
    return detail.valid !== false && rangesIntersect(detail, reportRange);
  }).forEach(function (detail) {
    const key = detail.startDate + "::" + detail.endDate;
    const existing = byPeriod.get(key);
    if (!existing || updateTime(detail) > updateTime(existing)) {
      if (existing) replacedIds.push(existing.wkId);
      byPeriod.set(key, detail);
    } else {
      replacedIds.push(detail.wkId);
    }
  });
  return {
    reports: [...byPeriod.values()].sort(function (a, b) {
      return a.startDate.localeCompare(b.startDate);
    }),
    replacedIds
  };
}

function executionKey(row, report) {
  return [
    row.projectId || report.projectId || "",
    row.wbsId || row.detailId || row.taskId || "",
    row.majorPerson || row.personId || row.userId || "",
    row.planDate || row.taskDate || row.date || "",
    row.extName || row.taskName || row.detailName || ""
  ].map(String).join("::");
}

function deduplicateExecutions(reports, field) {
  const values = new Map();
  reports.forEach(function (report) {
    report[field].forEach(function (row) {
      const key = executionKey(row, report);
      if (!values.has(key)) values.set(key, row);
    });
  });
  return [...values.values()];
}

export function aggregateWeeklyReports(reports) {
  return {
    summaries: reports.map(function (report) {
      return {
        wkId: report.wkId,
        startDate: report.startDate,
        endDate: report.endDate,
        summary: report.summary,
        nextPlan: report.nextPlan
      };
    }),
    currentExecutions: deduplicateExecutions(reports, "currentExecutions"),
    nextExecutions: deduplicateExecutions(reports, "nextExecutions")
  };
}

export function weeklyReportApplies(project) {
  const value = project && project.isCreateWkReport;
  return ![false, 0, "0", "false", "N", "n", "否"].includes(value);
}
