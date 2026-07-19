import {
  countChinaWorkdays,
  getEndMonthRange,
  getRangeLength,
  intersectDateRanges
} from "./date-range.js";
import { AnalyticsSchemaError, normalizeDateRange } from "./domain.js";

function isKnown(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sumRequired(values) {
  return values.every(isKnown) ? values.reduce(function (sum, value) { return sum + value; }, 0) : null;
}

function sumField(rows, field) {
  return sumRequired(rows.map(function (row) { return row[field]; }));
}

export function safeRatio(numerator, denominator) {
  if (!isKnown(numerator) || !isKnown(denominator)) return null;
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateProjectMetrics(project) {
  const revenue = project.subcontractAmount;
  const bac = project.estiExeuCost;
  const ac = project.realExeuCost;
  const personDays = project.realWorkload;
  const progress = isKnown(project.planCompleteSchedule)
    ? project.planCompleteSchedule / 100
    : null;
  const personYears = isKnown(personDays) ? personDays / 261 : null;
  const cr = isKnown(revenue) && isKnown(progress) ? revenue * progress : null;
  const ev = isKnown(bac) && isKnown(progress) ? bac * progress : null;
  const cpi = safeRatio(ev, ac);
  return Object.assign({}, project, {
    revenue,
    bac,
    ac,
    progress,
    personDays,
    personYears,
    cr,
    ev,
    cpi,
    ccpi: safeRatio(cr, ac),
    eac: safeRatio(bac, cpi),
    perCapita: safeRatio(cr, personYears),
    remainingBudget: isKnown(bac) && isKnown(ac) ? Math.max(bac - ac, 0) : null,
    budgetExecutionRate: safeRatio(ac, bac)
  });
}

export function calculateCumulativeMetrics(projects) {
  const rows = projects.map(calculateProjectMetrics);
  const revenue = sumField(rows, "revenue");
  const bac = sumField(rows, "bac");
  const ac = sumField(rows, "ac");
  const cr = sumField(rows, "cr");
  const ev = sumField(rows, "ev");
  const personYears = sumField(rows, "personYears");
  const cpi = safeRatio(ev, ac);
  return {
    projectCount: rows.length,
    revenue,
    bac,
    ac,
    cr,
    ev,
    personYears,
    progress: safeRatio(ev, bac),
    cpi,
    ccpi: safeRatio(cr, ac),
    eac: safeRatio(bac, cpi),
    perCapita: safeRatio(cr, personYears),
    remainingBudget: isKnown(bac) && isKnown(ac) ? Math.max(bac - ac, 0) : null,
    budgetExecutionRate: safeRatio(ac, bac),
    projects: rows
  };
}

function emptyWbsMetrics() {
  return {
    applicable: true,
    monthPV: 0,
    monthEV: 0,
    monthSPI: 0,
    periodPV: 0,
    periodEV: 0,
    periodSPI: 0,
    cumulativePV: 0,
    cumulativeEV: 0,
    totalSPI: 0
  };
}

function createWbsDiagnostics() {
  return {
    missingCompleteScheduleCount: 0,
    missingCompleteScheduleRows: [],
    missingHolidayTableYears: []
  };
}

function addMissingHolidayYears(diagnostics, years) {
  if (!Array.isArray(years) || years.length === 0) return;
  const known = new Set(diagnostics.missingHolidayTableYears);
  years.forEach(function (year) {
    known.add(String(year));
  });
  diagnostics.missingHolidayTableYears = [...known].sort();
}

function hasWbsDiagnostics(diagnostics) {
  return diagnostics.missingCompleteScheduleCount > 0 ||
    diagnostics.missingHolidayTableYears.length > 0;
}

function isCompletedWbs(row) {
  return row.finishStatus === "50" || row.finishStatusDesc === "已完成";
}

function isUnstartedWbs(row) {
  return row.finishStatus === "10" || row.finishStatusDesc === "未开始";
}

function resolveCompleteSchedule(row, diagnostics) {
  if (isKnown(row.completeSchedule)) {
    return row.completeSchedule;
  }
  if (isCompletedWbs(row)) {
    return 100;
  }
  if (isUnstartedWbs(row)) {
    return 0;
  }
  diagnostics.missingCompleteScheduleCount += 1;
  diagnostics.missingCompleteScheduleRows.push({
    detailId: row.detailId || null,
    detailName: row.detailName || null,
    finishStatus: row.finishStatus || null,
    finishStatusDesc: row.finishStatusDesc || null
  });
  return 0;
}

function wbsPlanRange(row) {
  if (
    typeof row.planStartTime !== "string" ||
    typeof row.planEndTime !== "string" ||
    row.planStartTime > row.planEndTime
  ) {
    return null;
  }
  return { startDate: row.planStartTime, endDate: row.planEndTime };
}

function allocateWbsPv(row, targetRange, diagnostics) {
  const planRange = wbsPlanRange(row);
  if (!planRange) return 0;
  const overlap = intersectDateRanges(planRange, targetRange);
  if (!overlap) return 0;
  const totalWorkdays = countChinaWorkdays(planRange);
  const overlapWorkdays = countChinaWorkdays(overlap);
  addMissingHolidayYears(diagnostics, totalWorkdays.missingHolidayTableYears);
  addMissingHolidayYears(diagnostics, overlapWorkdays.missingHolidayTableYears);
  if (totalWorkdays.count <= 0 || overlapWorkdays.count <= 0) {
    return 0;
  }
  return row.totalCost * overlapWorkdays.count / totalWorkdays.count;
}

function sumWbs(rows, targetRange, diagnostics, scheduleByRow) {
  return rows.reduce(function (sum, row) {
    return sum + allocateWbsPv(row, targetRange, diagnostics) * scheduleByRow.get(row) / 100;
  }, 0);
}

function sumWbsPv(rows, targetRange, diagnostics) {
  return rows.reduce(function (sum, row) {
    return sum + allocateWbsPv(row, targetRange, diagnostics);
  }, 0);
}

function getCumulativeWbsRange(rows, endDate) {
  const startDate = rows.reduce(function (earliest, row) {
    const planRange = wbsPlanRange(row);
    if (!planRange) return earliest;
    return earliest === null || planRange.startDate < earliest ? planRange.startDate : earliest;
  }, null);
  return startDate === null || startDate > endDate ? null : { startDate, endDate };
}

export function calculateWbsMetrics(wbsRows, range) {
  const normalized = normalizeDateRange(range);
  const month = getEndMonthRange(normalized);
  const applicable = wbsRows.filter(function (row) {
    return isKnown(row.totalCost) && wbsPlanRange(row);
  });
  if (applicable.length === 0) {
    return emptyWbsMetrics();
  }
  const diagnostics = createWbsDiagnostics();
  const scheduleByRow = new Map();
  applicable.forEach(function (row) {
    scheduleByRow.set(row, resolveCompleteSchedule(row, diagnostics));
  });
  const cumulativeRange = getCumulativeWbsRange(applicable, normalized.endDate);
  const monthPV = sumWbsPv(applicable, month, diagnostics);
  const monthEV = sumWbs(applicable, month, diagnostics, scheduleByRow);
  const periodPV = sumWbsPv(applicable, normalized, diagnostics);
  const periodEV = sumWbs(applicable, normalized, diagnostics, scheduleByRow);
  const cumulativePV = cumulativeRange ? sumWbsPv(applicable, cumulativeRange, diagnostics) : 0;
  const cumulativeEV = cumulativeRange ? sumWbs(applicable, cumulativeRange, diagnostics, scheduleByRow) : 0;
  const metrics = {
    applicable: true,
    monthPV,
    monthEV,
    monthSPI: safeRatio(monthEV, monthPV),
    periodPV,
    periodEV,
    periodSPI: safeRatio(periodEV, periodPV),
    cumulativePV,
    cumulativeEV,
    totalSPI: safeRatio(cumulativeEV, cumulativePV)
  };
  if (hasWbsDiagnostics(diagnostics)) {
    metrics.diagnostics = diagnostics;
  }
  return metrics;
}

export function calculateInputMetrics(input) {
  if (!input || typeof input !== "object") {
    throw new AnalyticsSchemaError("input", "must be an object", input);
  }
  const range = normalizeDateRange(input);
  const rows = input.dailyRows || [];
  const previousRows = input.previousDailyRows || [];
  const inputHours = sumField(rows, "realHour");
  const inputCost = sumField(rows, "cost");
  const previousHours = sumField(previousRows, "realHour");
  const previousInputCost = sumField(previousRows, "cost");
  const inputMd = isKnown(inputHours) ? inputHours / 8 : null;
  const previousInputMd = isKnown(previousHours) ? previousHours / 8 : null;
  const wbs = calculateWbsMetrics(input.wbsRows || [], range);
  const revenue = sumField(input.projects || [], "subcontractAmount");
  const bac = sumField(input.projects || [], "estiExeuCost");
  const serviceEV = isKnown(bac) && bac > 0 && isKnown(revenue) && isKnown(wbs.periodEV)
    ? wbs.periodEV / bac * revenue
    : wbs.applicable ? 0 : null;
  const periodDays = getRangeLength(range);
  return Object.assign({}, wbs, {
    inputHours,
    inputMd,
    inputCost,
    previousInputMd,
    previousInputCost,
    inputDelta: safeRatio(
      isKnown(inputMd) && isKnown(previousInputMd) ? inputMd - previousInputMd : null,
      previousInputMd
    ),
    costDelta: safeRatio(
      isKnown(inputCost) && isKnown(previousInputCost) ? inputCost - previousInputCost : null,
      previousInputCost
    ),
    serviceEV,
    periodCPI: safeRatio(wbs.periodEV, inputCost),
    periodCCPI: safeRatio(serviceEV, inputCost),
    periodPerCapita: safeRatio(serviceEV, isKnown(inputMd) ? inputMd / 261 : null),
    nextPeriodPlannedMd: isKnown(input.nextPeriodPlannedHours)
      ? input.nextPeriodPlannedHours / 8
      : null,
    burnRatePerDay: isKnown(inputCost) && periodDays > 0 ? inputCost / periodDays : null
  });
}

export function isActiveProject(currentInputMd, previousInputMd) {
  return (isKnown(currentInputMd) && currentInputMd > 0) ||
    (currentInputMd === 0 && isKnown(previousInputMd) && previousInputMd > 0);
}
