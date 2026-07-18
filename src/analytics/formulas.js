import { getEndMonthRange, getRangeLength } from "./date-range.js";
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
  return isKnown(numerator) && isKnown(denominator) && denominator > 0
    ? numerator / denominator
    : null;
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
    eac: cpi !== null && cpi > 0 ? bac / cpi : null,
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
    eac: cpi !== null && cpi > 0 ? bac / cpi : null,
    perCapita: safeRatio(cr, personYears),
    remainingBudget: isKnown(bac) && isKnown(ac) ? Math.max(bac - ac, 0) : null,
    budgetExecutionRate: safeRatio(ac, bac),
    projects: rows
  };
}

function dateInRange(value, range) {
  return typeof value === "string" && value >= range.startDate && value <= range.endDate;
}

export function calculateWbsMetrics(wbsRows, range) {
  const normalized = normalizeDateRange(range);
  const month = getEndMonthRange(normalized);
  const applicable = wbsRows.filter(function (row) { return isKnown(row.costLevel); });
  if (applicable.length === 0) {
    return {
      applicable: false,
      monthPV: null,
      monthEV: null,
      monthSPI: null,
      periodPV: null,
      periodEV: null,
      periodSPI: null,
      cumulativePV: null,
      cumulativeEV: null,
      totalSPI: null
    };
  }
  function total(predicate) {
    return applicable.filter(predicate).reduce(function (sum, row) { return sum + row.costLevel; }, 0);
  }
  const monthPV = total(function (row) { return dateInRange(row.planEndTime, month); });
  const monthEV = total(function (row) {
    return dateInRange(row.actualEndTime, month) && row.actualEndTime <= normalized.endDate;
  });
  const periodPV = total(function (row) { return dateInRange(row.planEndTime, normalized); });
  const periodEV = total(function (row) { return dateInRange(row.actualEndTime, normalized); });
  const cumulativePV = total(function (row) {
    return typeof row.planEndTime === "string" && row.planEndTime <= normalized.endDate;
  });
  const cumulativeEV = total(function (row) {
    return typeof row.actualEndTime === "string" && row.actualEndTime <= normalized.endDate;
  });
  return {
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
