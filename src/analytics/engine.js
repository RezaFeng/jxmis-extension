import { DEFAULT_RISK_THRESHOLDS } from "./config.js";
import { addCalendarDays, getEndMonthRange, isNaturalWeek } from "./date-range.js";
import { AnalyticsSchemaError, normalizeDateRange } from "./domain.js";
import {
  calculateCumulativeMetrics,
  calculateInputMetrics,
  isActiveProject,
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
  const completed = planned.filter(function (row) { return String(row.confirmStatus) === "2"; });
  const overdue = rows.filter(function (row) {
    return String(row.confirmStatus) !== "2" && row.planEndTime < range.endDate;
  });
  const upcoming = rows.filter(function (row) {
    return String(row.confirmStatus) !== "2" &&
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
  });
  const monthPlan = sumKnown(monthRows, "planAmount");
  const received = sumKnown(monthRows, "receivedAmount");
  const pending = monthPlan !== null && received !== null ? Math.max(monthPlan - received, 0) : null;
  const overdue = rows.filter(function (row) {
    return known(row.pendingAmount) && row.pendingAmount > 0 && row.planDate < range.endDate;
  });
  return {
    available,
    monthPlan: available ? monthPlan : null,
    received: available ? received : null,
    pending: available ? pending : null,
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
      !sourceFailed(input, "invoices", projectIds) && !sourceFailed(input, "monthlyInvoices", projectIds)
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
      card("invoiceMonthPlan", "当月计划", invoice.monthPlan, "money"),
      card("invoiceReceived", "已回款", invoice.received, "money"),
      card("invoicePending", "待回款", invoice.pending, "money"),
      card("invoiceOverdue", "逾期未回笔数", invoice.overdueCount)
    ]
  };
}

function aggregateActive(input, projectRows, range) {
  const activeRows = projectRows.filter(function (row) {
    return isActiveProject(row.inputMd, row.previousInputMd);
  });
  const interval = calculateInputMetrics({
    startDate: range.startDate,
    endDate: range.endDate,
    dailyRows: combineRows(activeRows, "dailyRows"),
    previousDailyRows: combineRows(activeRows, "previousDailyRows"),
    wbsRows: combineRows(activeRows, "wbsRows"),
    projects: activeRows,
    nextPeriodPlannedHours: sumKnown(activeRows, "nextPeriodPlannedMd") === null
      ? null
      : sumKnown(activeRows, "nextPeriodPlannedMd") * 8
  });
  const risks = summarizeRisks(activeRows);
  const projectIds = projectRows.map(function (row) { return row.projectId; });
  const activeSetAvailable = !sourceFailed(input, "daily", projectIds) &&
    !sourceFailed(input, "previousDaily", projectIds);
  const wbsAvailable = activeSetAvailable && !sourceFailed(
    input,
    "wbs",
    activeRows.map(function (row) { return row.projectId; })
  );
  const weeklyAvailable = activeSetAvailable && !sourceFailed(
    input,
    "weeklyReports",
    activeRows.map(function (row) { return row.projectId; })
  );
  const result = Object.assign({ projectCount: activeRows.length, projects: activeRows }, interval, {
    riskItemCount: risks.itemCount
  });
  if (!activeSetAvailable) {
    ["projectCount", "inputHours", "inputMd", "inputCost", "previousInputMd", "previousInputCost",
      "inputDelta", "costDelta", "monthPV", "monthEV", "monthSPI", "periodPV", "periodEV",
      "periodSPI", "cumulativePV", "cumulativeEV", "totalSPI", "serviceEV", "periodCPI",
      "periodCCPI", "periodPerCapita", "nextPeriodPlannedMd", "burnRatePerDay", "riskItemCount"]
      .forEach(function (field) { result[field] = null; });
    return result;
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

function createHistory(input, metrics) {
  const previous = input.previousReport;
  if (!previous || !previous.metrics) {
    return { previousAvailable: false, previous: null, changes: {} };
  }
  const changes = {};
  ["overview", "active", "milestone", "invoice", "risks"].forEach(function (section) {
    const currentValues = metrics[section] || {};
    const previousValues = previous.metrics[section] || {};
    const sectionChanges = {};
    new Set([...Object.keys(currentValues), ...Object.keys(previousValues)]).forEach(function (field) {
      const current = currentValues[field];
      const prior = previousValues[field];
      if ((known(current) || current === null) && (known(prior) || prior === null)) {
        sectionChanges[field] = safeRatio(known(current) && known(prior) ? current - prior : null, prior);
      }
    });
    changes[section] = sectionChanges;
  });
  return {
    previousAvailable: true,
    previous: {
      identity: previous.identity || null,
      metrics: previous.metrics
    },
    changes
  };
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

function latestCapturedAt(inputs) {
  return inputs.map(function (input) { return input.capturedAt; }).filter(Boolean).sort().at(-1) || null;
}

function mergeCompanyInputs(inputs, base) {
  const projects = [];
  const seen = new Set();
  const merged = Object.assign({}, base, {
    departmentId: "all",
    departmentName: "全部部门",
    capturedAt: latestCapturedAt(inputs),
    projects,
    dailyByProject: {},
    previousDailyByProject: {},
    wbsByProject: {},
    milestonesByProject: {},
    invoicesByProject: {},
    weeklyByProject: {},
    nextPlannedHoursByProject: {},
    sourceStatus: [],
    failedRequests: [],
    diagnostics: { company: true }
  });
  inputs.forEach(function (input) {
    (input.projects || []).forEach(function (project) {
      const id = String(project.projectId);
      if (seen.has(id)) return;
      seen.add(id);
      projects.push(project);
      ["dailyByProject", "previousDailyByProject", "wbsByProject", "milestonesByProject", "invoicesByProject"]
        .forEach(function (field) { merged[field][id] = rowsFor(input[field], project.projectId); });
      if (input.weeklyByProject && input.weeklyByProject[project.projectId]) {
        merged.weeklyByProject[id] = input.weeklyByProject[project.projectId];
      }
      if (input.nextPlannedHoursByProject && known(input.nextPlannedHoursByProject[project.projectId])) {
        merged.nextPlannedHoursByProject[id] = input.nextPlannedHoursByProject[project.projectId];
      }
    });
    merged.sourceStatus.push(...(input.sourceStatus || []).filter(function (item) {
      return item.projectId === undefined || seen.has(String(item.projectId));
    }));
    merged.failedRequests.push(...(input.failedRequests || []));
  });
  return merged;
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
    const cumulativeAvailable = input.cumulativeAvailable !== false;
    const overview = cumulativeAvailable
      ? calculateCumulativeMetrics(sourceProjects)
      : {
          projectCount: sourceProjects.length,
          revenue: null,
          bac: null,
          ac: null,
          cr: null,
          ev: null,
          personYears: null,
          progress: null,
          cpi: null,
          ccpi: null,
          eac: null,
          perCapita: null,
          remainingBudget: null,
          budgetExecutionRate: null,
          projects: projectRows
        };
    const riskSummary = summarizeRisks(projectRows);
    const selectedProjectIds = sourceProjects.map(function (project) { return project.projectId; });
    const active = aggregateActive(input, projectRows, range);
    const allMilestones = sourceProjects.flatMap(function (project) {
      return sourceRowsFor(input, "milestonesByProject", project);
    });
    const allInvoices = sourceProjects.flatMap(function (project) {
      return sourceRowsFor(input, "invoicesByProject", project);
    });
    const milestoneSummary = summarizeMilestones(
      allMilestones,
      range,
      !sourceFailed(input, "milestones", selectedProjectIds)
    );
    const invoiceSummary = summarizeInvoices(
      allInvoices,
      range,
      !sourceFailed(input, "invoices", selectedProjectIds) &&
        !sourceFailed(input, "monthlyInvoices", selectedProjectIds)
    );
    const labels = isNaturalWeek(range)
      ? { current: "本周", previous: "上周", next: "下周" }
      : { current: "本期", previous: "上期", next: "下期" };
    const metrics = {
      overview,
      active,
      milestone: milestoneSummary,
      invoice: invoiceSummary,
      risks: riskSummary
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
        persistable: !selectedIds && input.complete === true && input.historyMode !== "interval",
        cumulativeAvailable,
        historyMode: input.historyMode || "current",
        periodLabels: labels
      },
      complete: input.complete === true,
      cards,
      metrics,
      history: createHistory(input, metrics),
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
    const range = normalizeDateRange(input);
    const departments = input.departments || [];
    const expectedIds = new Set(departments.map(function (item) { return String(item.id); }));
    const snapshotsByDepartment = new Map();
    (input.snapshots || []).forEach(function (snapshot) {
      const value = snapshot && snapshot.input;
      if (!snapshot || snapshot.complete !== true || !value || value.complete !== true) return;
      if (value.configVersion !== input.configVersion || value.policyVersion !== input.policyVersion) return;
      if (value.startDate !== range.startDate || value.endDate !== range.endDate) return;
      const departmentId = String(value.departmentId);
      if (expectedIds.size > 0 && !expectedIds.has(departmentId)) return;
      const existing = snapshotsByDepartment.get(departmentId);
      if (!existing || String(snapshot.capturedAt || value.capturedAt || "") > String(existing.capturedAt || existing.input.capturedAt || "")) {
        snapshotsByDepartment.set(departmentId, snapshot);
      }
    });
    const availableInputs = [...snapshotsByDepartment.values()].map(function (snapshot) { return snapshot.input; });
    const complete = departments.length > 0 && snapshotsByDepartment.size === departments.length;
    const mergedInput = mergeCompanyInputs(availableInputs, {
      configVersion: input.configVersion,
      policyVersion: input.policyVersion,
      startDate: range.startDate,
      endDate: range.endDate,
      complete,
      historyMode: "company"
    });
    const report = buildReport(mergedInput);
    const departmentRows = departments.map(function (department) {
      const snapshot = snapshotsByDepartment.get(String(department.id));
      if (!snapshot) {
        return {
          departmentId: String(department.id),
          departmentName: department.name,
          projectCount: null,
          status: "missing",
          complete: false,
          capturedAt: null,
          metrics: null
        };
      }
      const departmentReport = snapshot.report || buildReport(snapshot.input);
      return {
        departmentId: String(department.id),
        departmentName: department.name,
        projectCount: departmentReport.metrics.overview.projectCount,
        status: "ready",
        complete: true,
        capturedAt: snapshot.capturedAt || snapshot.input.capturedAt,
        metrics: departmentReport.metrics
      };
    });
    report.scope.persistable = complete;
    report.company = {
      complete,
      coverage: departments.length > 0 ? snapshotsByDepartment.size / departments.length : 1,
      departments: departmentRows,
      missingDepartmentIds: departmentRows.filter(function (item) { return !item.complete; })
        .map(function (item) { return item.departmentId; })
    };
    return report;
  }
  return { buildReport, buildCompanyReport };
}
