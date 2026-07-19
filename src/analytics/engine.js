import { DEFAULT_RISK_THRESHOLDS } from "./config.js";
import {
  addCalendarDays,
  getEndMonthRange,
  getPreviousDateRange,
  isNaturalWeek
} from "./date-range.js";
import { AnalyticsSchemaError, normalizeDateRange } from "./domain.js";
import {
  calculateCumulativeMetrics,
  calculateInputMetrics,
  safeRatio
} from "./formulas.js";
import { evaluateProjectRisks, summarizeRisks } from "./risks.js";

function known(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sumKnown(rows, field) {
  const values = rows.map(function (row) { return row[field]; });
  return values.every(known)
    ? values.reduce(function (sum, value) { return sum + value; }, 0)
    : null;
}

function rowsFor(map, projectId) {
  if (map instanceof Map) {
    return map.get(projectId) || [];
  }
  return map && map[projectId] ? map[projectId] : [];
}

function sourceRowsFor(input, field, project) {
  return rowsFor(input[field], project.projectId).map(function (row) {
    return Object.assign({}, row, {
      projectId: project.projectId,
      projectNo: project.projectNo,
      projectName: project.projectName,
      projectManagerName: project.projectManagerName || null
    });
  });
}

function sourceFailed(input, source, projectIds) {
  const selected = projectIds ? new Set(projectIds.map(String)) : null;
  return (input.sourceStatus || []).some(function (item) {
    if (item.source !== source || item.status !== "failed") return false;
    return item.projectId === null || item.projectId === undefined ||
      !selected || selected.has(String(item.projectId));
  });
}

function summarizeMilestones(rows, range, available = true) {
  const month = getEndMonthRange(range);
  const nearEnd = addCalendarDays(range.endDate, 7);
  const planned = rows.filter(function (row) {
    return row.planEndTime >= month.startDate && row.planEndTime <= month.endDate;
  });
  const completed = planned.filter(function (row) { return row.completed === true; });
  const overdue = rows.filter(function (row) {
    return row.completed !== true && row.planEndTime < range.endDate;
  });
  const upcoming = rows.filter(function (row) {
    return row.completed !== true &&
      row.planEndTime > range.endDate &&
      row.planEndTime <= nearEnd;
  });
  return {
    available,
    plannedCount: available ? planned.length : null,
    completedCount: available ? completed.length : null,
    completionRate: available ? safeRatio(completed.length, planned.length) : null,
    overdueCount: available ? overdue.length : null,
    upcomingCount: available ? upcoming.length : null,
    planned,
    overdue,
    upcoming
  };
}

function summarizeInvoices(rows, range, available = true) {
  const month = getEndMonthRange(range);
  const monthRows = rows.filter(function (row) {
    return row.planDate >= month.startDate && row.planDate <= month.endDate;
  }).sort(function (a, b) {
    return String(a.planDate || "").localeCompare(String(b.planDate || "")) ||
      String(a.contractNo || "").localeCompare(String(b.contractNo || "")) ||
      String(a.invoiceBatch || "").localeCompare(String(b.invoiceBatch || ""), undefined, { numeric: true });
  });
  const validMonthRows = monthRows.filter(function (row) { return row.valid !== false; });
  const monthPlan = sumKnown(validMonthRows, "planAmount");
  const received = sumKnown(validMonthRows, "receivedAmount");
  const pending = sumKnown(validMonthRows, "pendingAmount");
  const groupByPlan = function (sourceRows) {
    const groups = new Map();
    sourceRows.forEach(function (row, index) {
      const key = String(row.planId ?? row.invoiceId ?? row.detailId ?? "row-" + index);
      const group = groups.get(key) || { planId: key, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    });
    return [...groups.values()].map(function (group) {
      return Object.assign(group, {
        planAmount: sumKnown(group.rows, "planAmount"),
        receivedAmount: sumKnown(group.rows, "receivedAmount"),
        pendingAmount: sumKnown(group.rows, "pendingAmount")
      });
    });
  };
  const monthGroups = groupByPlan(validMonthRows);
  const overdueGroups = groupByPlan(rows.filter(function (row) {
    const unpaid = row.receivedFlag === "0" ||
      (row.receivedFlag === undefined && known(row.pendingAmount));
    return row.valid !== false && unpaid && row.planDate < range.endDate;
  })).filter(function (group) {
    return known(group.pendingAmount) && group.pendingAmount > 0;
  });
  const overdue = overdueGroups.map(function (group) {
    const details = group.rows.slice().sort(function (a, b) {
      return String(a.planDate || "").localeCompare(String(b.planDate || "")) ||
        String(a.invoiceBatch || "").localeCompare(String(b.invoiceBatch || ""), undefined, { numeric: true });
    });
    return Object.assign({}, details[0], {
      planId: group.planId,
      planDate: details.map(function (row) { return row.planDate; }).filter(Boolean).sort()[0] || null,
      planAmount: group.planAmount,
      receivedAmount: group.receivedAmount,
      pendingAmount: group.pendingAmount,
      details
    });
  }).sort(function (a, b) {
    return String(a.planDate || "").localeCompare(String(b.planDate || "")) ||
      String(a.contractNo || "").localeCompare(String(b.contractNo || ""));
  });
  return {
    available,
    monthPlan: available ? monthPlan : null,
    received: available ? received : null,
    pending: available ? pending : null,
    plannedCount: available ? monthGroups.filter(function (group) {
      return known(group.planAmount) && group.planAmount !== 0;
    }).length : null,
    receivedCount: available ? monthGroups.filter(function (group) {
      return known(group.receivedAmount) && group.receivedAmount !== 0;
    }).length : null,
    receivedRate: available && known(monthPlan) && monthPlan > 0 && known(received)
      ? received / monthPlan
      : null,
    overdueCount: available ? overdue.length : null,
    monthRows,
    overdue
  };
}

function buildProjectRows(input, sourceProjects, range) {
  const cumulative = calculateCumulativeMetrics(sourceProjects).projects;
  return cumulative.map(function (project) {
    const projectId = project.projectId;
    const projectIds = [projectId];
    const milestone = summarizeMilestones(
      rowsFor(input.milestonesByProject, projectId),
      range,
      !sourceFailed(input, "milestones", projectIds)
    );
    const invoice = summarizeInvoices(
      rowsFor(input.invoicesByProject, projectId),
      range,
      !sourceFailed(input, "invoices", projectIds)
    );
    const interval = calculateInputMetrics({
      startDate: range.startDate,
      endDate: range.endDate,
      dailyRows: rowsFor(input.dailyByProject, projectId),
      previousDailyRows: rowsFor(input.previousDailyByProject, projectId),
      wbsRows: rowsFor(input.wbsByProject, projectId),
      projects: [project],
      nextPeriodPlannedHours: input.nextPlannedHoursByProject &&
        input.nextPlannedHoursByProject[projectId]
    });
    const enriched = Object.assign({}, project, interval, {
      totalSPI: interval.totalSPI,
      overdueMilestoneCount: milestone.overdueCount,
      overdueInvoiceCount: invoice.overdueCount,
      milestones: milestone,
      invoices: invoice
    });
    enriched.risks = evaluateProjectRisks(enriched, input.riskThresholds);
    return enriched;
  });
}

function combineRows(projectRows, field) {
  return projectRows.flatMap(function (row) { return row[field] || []; });
}

function card(id, label, value, format = "number", status) {
  return {
    id,
    label,
    values: [{ id, label, value, format, status: status || (value === null ? "unavailable" : "ready") }]
  };
}

function dualCard(id, label, values) {
  return {
    id,
    label,
    values: values.map(function (value) {
      return Object.assign({ format: "ratio", status: value.value === null ? "unavailable" : "ready" }, value);
    })
  };
}

function createCards(metrics, periodLabel) {
  const overview = metrics.overview;
  const active = metrics.active;
  const milestone = metrics.milestone;
  const invoice = metrics.invoice;
  const invoicePlanCard = card("invoiceMonthPlan", "当月计划", invoice.monthPlan, "money");
  invoicePlanCard.note = { count: invoice.plannedCount };
  const invoiceReceivedCard = card("invoiceReceived", "已回款", invoice.received, "money");
  invoiceReceivedCard.note = { count: invoice.receivedCount, rate: invoice.receivedRate };
  return {
    overview: [
      card("projectCount", "项目数", overview.projectCount),
      card("revenue", "软件与服务合同", overview.revenue, "money"),
      card("bac", "BAC", overview.bac, "money"),
      card("ac", "AC", overview.ac, "money"),
      card("cr", "CR", overview.cr, "money"),
      card("ev", "EV", overview.ev, "money"),
      card("perCapita", "整体人均产值", overview.perCapita, "money"),
      dualCard("costEfficiency", "成本效率", [
        { id: "cpi", label: "CPI", value: overview.cpi },
        { id: "ccpi", label: "CCPI", value: overview.ccpi }
      ]),
      card("eac", "EAC", overview.eac, "money"),
      card("attentionProjectCount", "需关注项目数", metrics.risks.attentionProjectCount),
      card("monthSPI", "当月SPI", active.monthSPI, "ratio"),
      card("totalSPI", "总SPI", active.totalSPI, "ratio")
    ],
    active: [
      card("activeProjectCount", "有投入项目数", active.projectCount),
      card("inputMd", periodLabel.current + "投入人天", active.inputMd, "number"),
      card("inputCost", periodLabel.current + "投入成本", active.inputCost, "money"),
      card("inputDelta", "投入环比", active.inputDelta, "percent"),
      card("costDelta", "成本环比", active.costDelta, "percent"),
      card("activeMonthSPI", "月SPI", active.monthSPI, "ratio"),
      card("periodSPI", "区间SPI", active.periodSPI, "ratio"),
      card("periodPV", "区间PV", active.periodPV, "money"),
      card("periodEV", "区间EV", active.periodEV, "money"),
      card("serviceEV", "区间产服EV", active.serviceEV, "money"),
      card("periodCPI", "区间CPI", active.periodCPI, "ratio"),
      card("periodCCPI", "区间CCPI", active.periodCCPI, "ratio"),
      card("periodPerCapita", "区间人均产值", active.periodPerCapita, "money"),
      card("activeRiskItems", "需关注项", active.riskItemCount),
      card("nextPeriodPlannedMd", periodLabel.next + "计划人天", active.nextPeriodPlannedMd)
    ],
    milestone: [
      card("milestonePlanned", "本月应完成", milestone.plannedCount),
      card("milestoneCompletion", "本月完成率", milestone.completionRate, "percent"),
      card("milestoneOverdue", "已逾期", milestone.overdueCount)
    ],
    invoice: [
      invoicePlanCard,
      invoiceReceivedCard,
      card("invoicePending", "待回款", invoice.pending, "money"),
      card("invoiceOverdue", "逾期未回笔数", invoice.overdueCount)
    ]
  };
}

function projectInputMd(input, field, projectId) {
  return rowsFor(input[field], projectId).reduce(function (sum, row) {
    return sum + row.realHour;
  }, 0) / 8;
}

function plannedHoursForPeriod(input, projectRows, field) {
  if (field === "nextPlannedHoursByProject") {
    return projectRows.reduce(function (sum, project) {
      const value = input[field] && input[field][project.projectId];
      return sum + (known(value) ? value : 0);
    }, 0);
  }
  return projectRows.reduce(function (sum, project) {
    const source = input[field] && input[field][project.projectId];
    const rows = source && source.aggregate && source.aggregate.nextExecutions || [];
    return sum + rows.reduce(function (rowSum, row) {
      const value = Number(row.planHour ?? row.plannedHours ?? row.duration ?? 0);
      return rowSum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, 0);
}

function aggregatePeriod(input, projectRows, range, options) {
  const activeRows = projectRows.filter(function (row) {
    return projectInputMd(input, options.dailyField, row.projectId) > 0;
  });
  const interval = calculateInputMetrics({
    startDate: range.startDate,
    endDate: range.endDate,
    dailyRows: projectRows.flatMap(function (row) {
      return rowsFor(input[options.dailyField], row.projectId);
    }),
    previousDailyRows: [],
    wbsRows: combineRows(projectRows, "wbsRows"),
    projects: projectRows,
    nextPeriodPlannedHours: plannedHoursForPeriod(input, projectRows, options.weeklyField)
  });
  const projectIds = projectRows.map(function (row) { return row.projectId; });
  const inputAvailable = !sourceFailed(input, options.dailySource, projectIds);
  const wbsAvailable = !sourceFailed(input, "wbs", projectIds);
  const weeklyAvailable = !sourceFailed(input, "weeklyReports", projectIds);
  const result = Object.assign({ projectCount: activeRows.length, projects: activeRows }, interval, {
    riskItemCount: options.includeRisks ? summarizeRisks(activeRows).itemCount : 0
  });
  if (!inputAvailable) {
    ["projectCount", "inputHours", "inputMd", "inputCost", "inputDelta", "costDelta",
      "periodCPI", "periodCCPI", "periodPerCapita", "burnRatePerDay", "riskItemCount"]
      .forEach(function (field) { result[field] = null; });
  }
  if (!wbsAvailable) {
    ["monthPV", "monthEV", "monthSPI", "periodPV", "periodEV", "periodSPI", "cumulativePV",
      "cumulativeEV", "totalSPI", "serviceEV", "periodCPI", "periodCCPI", "periodPerCapita"]
      .forEach(function (field) { result[field] = null; });
  }
  if (!weeklyAvailable) result.nextPeriodPlannedMd = null;
  return result;
}

function attachSourceRows(input, rows) {
  return rows.map(function (row) {
    return Object.assign({}, row, {
      dailyRows: rowsFor(input.dailyByProject, row.projectId),
      previousDailyRows: rowsFor(input.previousDailyByProject, row.projectId),
      wbsRows: rowsFor(input.wbsByProject, row.projectId)
    });
  });
}

function countCardValues(cards) {
  return Object.values(cards).flat().reduce(function (sum, item) {
    return sum + item.values.length;
  }, 0);
}

function compareValue(current, previous) {
  if (!known(current) || !known(previous)) {
    return { current, previous, delta: null, changeRate: null };
  }
  const delta = current - previous;
  return { current, previous, delta, changeRate: safeRatio(delta, previous) };
}

function compareSections(current, previous, fields) {
  return Object.fromEntries(fields.map(function (field) {
    return [field, compareValue(current[field], previous[field])];
  }));
}

const ACTIVE_COMPARISON_FIELDS = Object.freeze([
  "projectCount",
  "inputMd",
  "inputCost",
  "monthPV",
  "monthEV",
  "monthSPI",
  "periodPV",
  "periodEV",
  "periodSPI",
  "serviceEV",
  "periodCPI",
  "periodCCPI",
  "periodPerCapita",
  "nextPeriodPlannedMd"
]);

const MILESTONE_COMPARISON_FIELDS = Object.freeze([
  "plannedCount",
  "completedCount",
  "completionRate",
  "overdueCount",
  "upcomingCount"
]);

const INVOICE_COMPARISON_FIELDS = Object.freeze([
  "monthPlan",
  "received",
  "pending",
  "receivedRate",
  "overdueCount"
]);

function invoiceRowsForScope(input, sourceProjects, selectedIds) {
  if (!Array.isArray(input.invoiceRows)) {
    return sourceProjects.flatMap(function (project) {
      return sourceRowsFor(input, "invoicesByProject", project);
    });
  }
  if (!selectedIds || input.invoiceRowsAreScoped === true) return input.invoiceRows;
  const projectIds = new Set(sourceProjects.map(function (project) { return String(project.projectId); }));
  return input.invoiceRows.filter(function (row) {
    return row.projectId !== null && row.projectId !== undefined && projectIds.has(String(row.projectId));
  });
}

function buildPmRows(projectRows) {
  const groups = new Map();
  projectRows.forEach(function (project) {
    const key = project.projectManager || project.projectManagerName || "unassigned";
    const group = groups.get(key) || {
      projectManager: project.projectManager || null,
      projectManagerName: project.projectManagerName || "未指定",
      projects: []
    };
    group.projects.push(project);
    groups.set(key, group);
  });
  return [...groups.values()].map(function (group) {
    const metrics = calculateCumulativeMetrics(group.projects);
    return Object.assign({}, group, {
      projectCount: group.projects.length,
      contractAmount: sumKnown(group.projects, "contractAmount"),
      revenue: metrics.revenue,
      progress: metrics.progress,
      ac: metrics.ac,
      perCapita: metrics.perCapita,
      cpi: metrics.cpi,
      ccpi: metrics.ccpi
    });
  }).sort(function (a, b) { return b.projectCount - a.projectCount; });
}

function buildBudgetRows(projectRows) {
  return projectRows.map(function (project) {
    const estimatedExhaustionDays = known(project.remainingBudget) &&
      known(project.burnRatePerDay) &&
      project.burnRatePerDay > 0
      ? project.remainingBudget / project.burnRatePerDay
      : null;
    return {
      projectId: project.projectId,
      projectNo: project.projectNo,
      projectName: project.projectName,
      projectManagerName: project.projectManagerName,
      wbsBudget: project.cumulativePV,
      bac: project.bac,
      budgetVariance: known(project.cumulativePV) && known(project.bac)
        ? project.bac - project.cumulativePV
        : null,
      ac: project.ac,
      remainingBudget: project.remainingBudget,
      periodCost: project.inputCost,
      burnRatePerDay: project.burnRatePerDay,
      estimatedExhaustionDays
    };
  });
}

function buildWeeklyExecution(input, projectRows) {
  if (Array.isArray(input.weeklyExecution)) return input.weeklyExecution;
  return projectRows.flatMap(function (project) {
    const source = input.weeklyByProject && input.weeklyByProject[project.projectId];
    const aggregate = source && source.aggregate || {};
    return (aggregate.summaries || []).map(function (summary) {
      return Object.assign({}, summary, {
        projectId: project.projectId,
        projectNo: project.projectNo,
        projectName: project.projectName,
        projectManagerName: project.projectManagerName,
        inputMd: project.inputMd,
        inputCost: project.inputCost,
        periodSPI: project.periodSPI,
        details: aggregate.currentExecutions || []
      });
    });
  });
}

export function createAnalyticsEngine() {
  function buildReport(input) {
    if (!input || typeof input !== "object") {
      throw new AnalyticsSchemaError("input", "must be an object", input);
    }
    const range = normalizeDateRange(input);
    const allProjects = input.projects || [];
    const selectedIds = input.selectedProjectIds ? new Set(input.selectedProjectIds.map(String)) : null;
    const sourceProjects = selectedIds
      ? allProjects.filter(function (project) { return selectedIds.has(String(project.projectId)); })
      : allProjects;
    let projectRows = buildProjectRows(Object.assign({
      riskThresholds: DEFAULT_RISK_THRESHOLDS
    }, input), sourceProjects, range);
    projectRows = attachSourceRows(input, projectRows);
    const overview = calculateCumulativeMetrics(sourceProjects);
    const riskSummary = summarizeRisks(projectRows);
    const selectedProjectIds = sourceProjects.map(function (project) { return project.projectId; });
    const previousRange = getPreviousDateRange(range);
    const active = aggregatePeriod(input, projectRows, range, {
      dailyField: "dailyByProject",
      dailySource: "daily",
      weeklyField: "nextPlannedHoursByProject",
      includeRisks: true
    });
    const previousActive = aggregatePeriod(input, projectRows, previousRange, {
      dailyField: "previousDailyByProject",
      dailySource: "previousDaily",
      weeklyField: "previousWeeklyByProject",
      includeRisks: false
    });
    const allMilestones = sourceProjects.flatMap(function (project) {
      return sourceRowsFor(input, "milestonesByProject", project);
    });
    const allInvoices = invoiceRowsForScope(input, sourceProjects, selectedIds);
    const milestoneSummary = summarizeMilestones(
      allMilestones,
      range,
      !sourceFailed(input, "milestones", selectedProjectIds)
    );
    const previousMilestoneSummary = summarizeMilestones(
      allMilestones,
      previousRange,
      !sourceFailed(input, "milestones", selectedProjectIds)
    );
    const invoiceSummary = summarizeInvoices(
      allInvoices,
      range,
      !sourceFailed(input, "invoices", selectedProjectIds)
    );
    const previousInvoiceSummary = summarizeInvoices(
      allInvoices,
      previousRange,
      !sourceFailed(input, "invoices", selectedProjectIds)
    );
    const labels = isNaturalWeek(range)
      ? { current: "本周", previous: "上周", next: "下周" }
      : { current: "本期", previous: "上期", next: "下期" };
    const comparison = {
      active: compareSections(active, previousActive, ACTIVE_COMPARISON_FIELDS),
      milestone: compareSections(
        milestoneSummary,
        previousMilestoneSummary,
        MILESTONE_COMPARISON_FIELDS
      ),
      invoice: compareSections(invoiceSummary, previousInvoiceSummary, INVOICE_COMPARISON_FIELDS)
    };
    active.inputDelta = comparison.active.inputMd.changeRate;
    active.costDelta = comparison.active.inputCost.changeRate;
    const metrics = {
      overview,
      active,
      milestone: milestoneSummary,
      invoice: invoiceSummary,
      risks: riskSummary,
      previous: {
        active: previousActive,
        milestone: previousMilestoneSummary,
        invoice: previousInvoiceSummary
      },
      comparison
    };
    const cards = createCards(metrics, labels);
    if (countCardValues(cards) !== 35) {
      throw new Error("analytics report must contain 35 core values");
    }
    return {
      identity: {
        departmentId: input.departmentId,
        departmentName: input.departmentName,
        configVersion: input.configVersion,
        policyVersion: input.policyVersion,
        startDate: range.startDate,
        endDate: range.endDate,
        capturedAt: input.capturedAt || null
      },
      scope: {
        mode: selectedIds ? "selection" : "formal",
        selectedCount: sourceProjects.length,
        totalCount: allProjects.length,
        formalCount: input.formalScope && input.formalScope.formalProjectCount !== undefined
          ? input.formalScope.formalProjectCount
          : allProjects.length,
        candidateCount: input.formalScope && input.formalScope.candidateProjectCount !== undefined
          ? input.formalScope.candidateProjectCount
          : allProjects.length,
        onlyCurrentPeriodInput: input.formalScope
          ? input.formalScope.onlyCurrentPeriodInput === true
          : false,
        formalScopeStatus: input.formalScope && input.formalScope.status || "notApplicable",
        periodLabels: labels
      },
      complete: input.complete === true,
      cards,
      metrics,
      tables: {
        projects: projectRows,
        activeProjects: active.projects,
        milestones: milestoneSummary,
        invoices: invoiceSummary,
        projectManagers: buildPmRows(projectRows),
        budgetHealth: buildBudgetRows(projectRows),
        weeklyExecution: buildWeeklyExecution(input, projectRows),
        diagnostics: Object.assign({}, input.diagnostics || {}, {
          coverage: known(input.coverage) ? input.coverage : input.complete === true ? 1 : null,
          sourceStatus: input.sourceStatus || [],
          failedRequests: input.failedRequests || []
        })
      }
    };
  }

  function buildCompanyReport(input) {
    if (!input || typeof input !== "object") {
      throw new AnalyticsSchemaError("company", "must be an object", input);
    }
    const live = input.liveInput || input;
    const seen = new Set();
    const projects = (live.projects || []).filter(function (project) {
      const projectId = String(project.projectId);
      if (seen.has(projectId)) return false;
      seen.add(projectId);
      return true;
    });
    const liveInput = Object.assign({}, live, {
      departmentId: "all",
      departmentName: "全部部门",
      projects
    });
    const departments = input.departments || live.scope && live.scope.departments || [];
    const report = buildReport(liveInput);
    const departmentRows = departments.map(function (department) {
      const departmentId = String(department.id);
      const projectIds = projects.filter(function (project) {
        return String(project.projectDept) === departmentId;
      }).map(function (project) { return String(project.projectId); });
      const failed = (live.failedRequests || []).some(function (descriptor) {
        return descriptor.projectId === undefined || descriptor.projectId === null ||
          projectIds.includes(String(descriptor.projectId));
      });
      const departmentReport = buildReport(Object.assign({}, liveInput, {
        departmentId,
        departmentName: department.name,
        selectedProjectIds: projectIds,
        invoiceRows: (liveInput.invoiceRows || []).filter(function (row) {
          return String(row.salesDepartmentName || "") === String(department.name || "");
        }),
        invoiceRowsAreScoped: true,
        complete: !failed
      }));
      return {
        departmentId,
        departmentName: department.name,
        projectCount: departmentReport.metrics.overview.projectCount,
        status: failed ? "failed" : "ready",
        complete: !failed,
        capturedAt: live.capturedAt || null,
        metrics: departmentReport.metrics
      };
    });
    const completedDepartments = departmentRows.filter(function (item) { return item.complete; }).length;
    report.company = {
      complete: live.complete === true && completedDepartments === departments.length,
      coverage: departments.length > 0 ? completedDepartments / departments.length : 1,
      departments: departmentRows,
      missingDepartmentIds: departmentRows.filter(function (item) { return !item.complete; })
        .map(function (item) { return item.departmentId; })
    };
    return report;
  }
  return { buildReport, buildCompanyReport };
}
