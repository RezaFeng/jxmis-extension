import {
  AnalyticsSchemaError,
  normalizeCalendarDate,
  normalizeFiniteNumber,
  normalizeIdentifier
} from "../../analytics/domain.js";

export function normalizeApiDate(value, field, options = {}) {
  if (value === null || value === undefined || value === "") {
    if (options.required) {
      throw new AnalyticsSchemaError(field, "is required", value);
    }
    return null;
  }
  const text = String(value).trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const candidate = compact
    ? compact[1] + "-" + compact[2] + "-" + compact[3]
    : text.slice(0, 10);
  return normalizeCalendarDate(candidate, field);
}

export function normalizeDailyRow(raw) {
  if (!raw || typeof raw !== "object") {
    throw new AnalyticsSchemaError("daily", "must be an object", raw);
  }
  const taskDate = [
    raw.realEndTime,
    raw.submissionTime,
    raw.createTime
  ].find(function (value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
  return {
    projectId: normalizeIdentifier(raw.projectId ?? raw.proId, "daily.projectId", { required: true }),
    taskDate: normalizeApiDate(taskDate, "daily.taskDate", { required: true }),
    realHour: normalizeFiniteNumber(raw.realHour, "daily.realHour", { blankAsZero: true }),
    cost: normalizeFiniteNumber(raw.cost, "daily.cost", { blankAsZero: true })
  };
}

export function normalizeWbsRows(rows) {
  return (rows || []).filter(Boolean).map(function (raw) {
    return {
      detailId: normalizeIdentifier(raw.detailId ?? raw.id, "wbs.detailId"),
      detailName: normalizeIdentifier(raw.detailName ?? raw.taskName, "wbs.detailName"),
      costLevel: normalizeFiniteNumber(raw.costLevel, "wbs.costLevel", { blankAsZero: true }),
      planEndTime: normalizeApiDate(raw.planEndTime, "wbs.planEndTime", { required: true }),
      actualEndTime: normalizeApiDate(raw.actualEndTime ?? raw.realEndTime, "wbs.actualEndTime")
    };
  });
}

export function normalizeMilestoneRows(rows) {
  return (rows || []).map(function (raw) {
    return {
      milestoneId: normalizeIdentifier(raw.milestoneId ?? raw.detailId ?? raw.id, "milestone.id"),
      nodeName: normalizeIdentifier(
        raw.nodeName ?? raw.detailName ?? raw.milestoneName,
        "milestone.nodeName",
        { required: true }
      ),
      planEndTime: normalizeApiDate(raw.planEndTime, "milestone.planEndTime", { required: true }),
      actualEndTime: normalizeApiDate(raw.actualEndTime ?? raw.realEndTime, "milestone.actualEndTime"),
      confirmStatus: normalizeIdentifier(raw.confirmStatus, "milestone.confirmStatus")
    };
  });
}
