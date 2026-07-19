import { getPreviousDateRange } from "../../analytics/date-range.js";
import { isValidRequestId } from "../../shared/protocol.js";
import {
  applyCurrentPeriodInputScope,
  buildProjectScope,
  selectDepartmentProjects
} from "./scope.js";
import { splitWeeklyReportsByRange } from "./weekly-reports.js";

const PROJECT_SOURCES = Object.freeze(["wbs", "milestones", "weeklyReports"]);

function errorMessage(error) {
  return (error && error.message ? error.message : String(error)).split(" url=")[0];
}

function isSessionExpired(error) {
  return error && error.code === "SESSION_EXPIRED" ||
    /SESSION_EXPIRED|HTTP\s+(401|403)|login|登录/i.test(errorMessage(error));
}

function abortError() {
  const error = new Error("analytics collection cancelled");
  error.name = "AbortError";
  error.code = "CANCELLED";
  return error;
}

function sessionError(error) {
  const result = new Error("JXPMO session expired");
  result.code = "SESSION_EXPIRED";
  result.cause = error;
  return result;
}

function groupByProject(rows) {
  const result = {};
  (rows || []).forEach(function (row) {
    const id = String(row.projectId);
    (result[id] ||= []).push(row);
  });
  return result;
}

function groupedRows(value) {
  return Object.values(value || {}).flat();
}

function plannedHours(weekly) {
  if (!weekly || weekly.status === "failed") return null;
  const rows = weekly.aggregate && weekly.aggregate.nextExecutions || [];
  return rows.reduce(function (sum, row) {
    const value = Number(row.planHour ?? row.plannedHours ?? row.duration ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function sourceAvailable(value) {
  return value && ["success", "empty", "notApplicable"].includes(value.status);
}

export function createAnalyticsCollector(adapters) {
  const data = adapters.data;
  const AbortControllerCtor = adapters.AbortController || globalThis.AbortController;
  const sleep = adapters.sleep || function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };
  const concurrency = Math.min(4, Math.max(1, adapters.concurrency || 4));
  let active = null;
  let projectCatalog = [];

  async function retry(operation, signal) {
    let attempt = 0;
    while (true) {
      if (signal.aborted) throw abortError();
      try {
        return await operation();
      } catch (error) {
        if (isSessionExpired(error)) throw sessionError(error);
        const retryable = /HTTP\s+(429|5\d\d)/.test(errorMessage(error));
        if (!retryable || attempt >= 2) throw error;
        await sleep(100 * (2 ** attempt), signal);
        attempt += 1;
      }
    }
  }

  function cancel(requestId) {
    if (active && (!requestId || active.requestId === requestId)) {
      active.controller.abort();
      return true;
    }
    return false;
  }

  function setFormalScope(base, currentDaily, previousDaily) {
    const formal = applyCurrentPeriodInputScope({
      projects: base.candidateProjects || base.projects,
      currentDailyRows: currentDaily.rows,
      previousDailyRows: previousDaily.rows,
      currentAvailable: sourceAvailable(currentDaily),
      previousAvailable: sourceAvailable(previousDaily),
      onlyCurrentPeriodInput: base.scope.filters.onlyCurrentPeriodInput
    });
    base.projects = formal.projects;
    const summary = Object.assign({}, formal);
    delete summary.projects;
    base.formalScope = summary;
    return summary;
  }

  function coverage(base) {
    const successful = base.sourceStatus.filter(function (item) {
      return ["success", "empty", "notApplicable"].includes(item.status);
    }).length;
    return base.sourceStatus.length > 0 ? successful / base.sourceStatus.length : 1;
  }

  async function collect(request, onProgress = function () {}) {
    if (!request || !isValidRequestId(request.requestId)) {
      throw new Error("analytics requestId is required");
    }
    cancel();
    const controller = new AbortControllerCtor();
    const signal = controller.signal;
    active = { requestId: request.requestId, controller };
    const progress = function (stage, extra = {}) {
      if (!signal.aborted) onProgress(Object.assign({ requestId: request.requestId, stage }, extra));
    };
    try {
      progress("departments");
      const departments = await retry(function () { return data.fetchDepartments(signal); }, signal);
      progress("projects");
      const projects = await retry(function () { return data.fetchProjects(signal); }, signal);
      projectCatalog = projects;
      const scope = buildProjectScope({
        departments,
        projects,
        filters: request.projectFilters,
        recentDepartmentIds: request.recentDepartmentIds
      });
      const candidateProjects = selectDepartmentProjects(scope, String(request.departmentId));
      const base = {
        requestId: request.requestId,
        departmentId: request.departmentId,
        departmentName: request.departmentName,
        startDate: request.startDate,
        endDate: request.endDate,
        projects: candidateProjects,
        candidateProjects,
        scope,
        dailyByProject: {},
        previousDailyByProject: {},
        wbsByProject: {},
        milestonesByProject: {},
        invoiceRows: [],
        invoicesByProject: {},
        weeklyByProject: {},
        previousWeeklyByProject: {},
        nextPlannedHoursByProject: {},
        weeklyReplacedIdsByProject: {},
        failedRequests: [],
        sourceStatus: []
      };
      if (request.scopeOnly === true) {
        return Object.assign(base, {
          scopeOnly: true,
          complete: true,
          coverage: 1,
          diagnostics: scope.diagnostics
        });
      }
      const previous = getPreviousDateRange(request);
      const weeklyRange = { startDate: previous.startDate, endDate: request.endDate };
      progress("sharedSources", { totalProjects: candidateProjects.length });
      const sharedDefinitions = [
        ["daily", function () { return data.fetchDailyRows(request.startDate, request.endDate, signal); }],
        ["previousDaily", function () { return data.fetchDailyRows(previous.startDate, previous.endDate, signal); }],
        ["invoices", function () {
          return data.fetchReceivables(request.departmentId, projects, signal);
        }]
      ];
      const shared = {};
      await Promise.all(sharedDefinitions.map(async function ([source, operation]) {
        try {
          shared[source] = await retry(operation, signal);
          base.sourceStatus.push({ source, status: shared[source].status });
        } catch (error) {
          if (isSessionExpired(error)) {
            controller.abort();
            throw error;
          }
          shared[source] = { status: "failed", rows: [] };
          base.sourceStatus.push({ source, status: "failed", error: errorMessage(error) });
          base.failedRequests.push({ source, error: errorMessage(error) });
        }
      }));
      base.dailyByProject = groupByProject(shared.daily.rows);
      base.previousDailyByProject = groupByProject(shared.previousDaily.rows);
      base.invoiceRows = shared.invoices.rows;
      base.invoicesByProject = groupByProject(shared.invoices.rows.filter(function (row) {
        return row.projectId !== null && row.projectId !== undefined;
      }));
      setFormalScope(base, shared.daily, shared.previousDaily);
      const selectedProjects = base.projects;

      if (selectedProjects.length === 0) {
        const complete = base.failedRequests.length === 0;
        progress("complete", { complete });
        return Object.assign(base, {
          complete,
          coverage: coverage(base),
          diagnostics: Object.assign({}, scope.diagnostics, base.formalScope, {
            receivables: shared.invoices.diagnostics || {},
            replacedWeeklyReportIds: []
          })
        });
      }

      let nextIndex = 0;
      let completedProjects = 0;
      async function worker() {
        while (nextIndex < selectedProjects.length && !signal.aborted) {
          const project = selectedProjects[nextIndex];
          nextIndex += 1;
          const projectId = String(project.projectId);
          const operations = {
            wbs: function () { return data.fetchWbs(projectId, signal); },
            milestones: function () { return data.fetchMilestones(projectId, signal); },
            weeklyReports: function () { return data.fetchWeeklyReports(project, weeklyRange, signal); }
          };
          for (const source of PROJECT_SOURCES) {
            try {
              const value = await retry(operations[source], signal);
              base.sourceStatus.push({ source, projectId, status: value.status });
              if (source === "wbs") base.wbsByProject[projectId] = value.rows;
              if (source === "milestones") base.milestonesByProject[projectId] = value.rows;
              if (source === "weeklyReports") {
                const periods = splitWeeklyReportsByRange(value, request, previous);
                base.weeklyByProject[projectId] = periods.current;
                base.previousWeeklyByProject[projectId] = periods.previous;
                base.nextPlannedHoursByProject[projectId] = plannedHours(periods.current);
                base.weeklyReplacedIdsByProject[projectId] = value.replacedIds || [];
              }
            } catch (error) {
              if (isSessionExpired(error)) {
                controller.abort();
                throw error;
              }
              base.sourceStatus.push({ source, projectId, status: "failed", error: errorMessage(error) });
              base.failedRequests.push({ source, projectId, error: errorMessage(error) });
            }
          }
          completedProjects += 1;
          progress("projectSources", {
            completedProjects,
            totalProjects: selectedProjects.length,
            projectId
          });
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, selectedProjects.length) }, worker));
      if (signal.aborted) throw abortError();

      const complete = base.failedRequests.length === 0;
      progress("complete", { complete });
      return Object.assign(base, {
        complete,
        coverage: coverage(base),
        diagnostics: Object.assign({}, scope.diagnostics, base.formalScope, {
          receivables: shared.invoices.diagnostics || {},
          replacedWeeklyReportIds: Object.values(base.weeklyReplacedIdsByProject).flat()
        })
      });
    } finally {
      if (active && active.requestId === request.requestId) active = null;
    }
  }

  async function retryFailed(request, previous, onProgress = function () {}) {
    if (!request || !isValidRequestId(request.requestId)) {
      throw new Error("analytics requestId is required");
    }
    cancel();
    const controller = new AbortControllerCtor();
    const signal = controller.signal;
    active = { requestId: request.requestId, controller };
    const result = structuredClone(previous);
    result.requestId = request.requestId;
    const failures = Array.isArray(previous && previous.failedRequests)
      ? previous.failedRequests
      : [];
    const previousRange = getPreviousDateRange(request);
    const weeklyRange = { startDate: previousRange.startDate, endDate: request.endDate };
    const remaining = [];
    function replaceStatus(descriptor, status) {
      const item = result.sourceStatus.find(function (candidate) {
        return candidate.source === descriptor.source &&
          String(candidate.projectId || "") === String(descriptor.projectId || "") &&
          candidate.status === "failed";
      });
      if (item) {
        item.status = status;
        delete item.error;
      }
    }
    try {
      for (const descriptor of failures) {
        if (signal.aborted) throw abortError();
        const projectId = descriptor.projectId && String(descriptor.projectId);
        const project = projectId && (result.candidateProjects || result.projects).find(function (item) {
          return String(item.projectId) === projectId;
        });
        let operation;
        if (descriptor.source === "daily") {
          operation = function () { return data.fetchDailyRows(request.startDate, request.endDate, signal); };
        } else if (descriptor.source === "previousDaily") {
          operation = function () {
            return data.fetchDailyRows(previousRange.startDate, previousRange.endDate, signal);
          };
        } else if (descriptor.source === "invoices" && !projectId) {
          operation = function () {
            return data.fetchReceivables(
              request.departmentId,
              projectCatalog.length > 0 ? projectCatalog : result.candidateProjects || result.projects,
              signal
            );
          };
        } else if (descriptor.source === "wbs" && projectId) {
          operation = function () { return data.fetchWbs(projectId, signal); };
        } else if (descriptor.source === "milestones" && projectId) {
          operation = function () { return data.fetchMilestones(projectId, signal); };
        } else if (descriptor.source === "weeklyReports" && project) {
          operation = function () { return data.fetchWeeklyReports(project, weeklyRange, signal); };
        }
        if (!operation) {
          remaining.push(descriptor);
          continue;
        }
        try {
          const value = await retry(operation, signal);
          if (descriptor.source === "daily") result.dailyByProject = groupByProject(value.rows);
          if (descriptor.source === "previousDaily") result.previousDailyByProject = groupByProject(value.rows);
          if (descriptor.source === "invoices") {
            result.invoiceRows = value.rows;
            result.invoicesByProject = groupByProject(value.rows.filter(function (row) {
              return row.projectId !== null && row.projectId !== undefined;
            }));
            result.diagnostics.receivables = value.diagnostics || {};
          }
          if (descriptor.source === "wbs") result.wbsByProject[projectId] = value.rows;
          if (descriptor.source === "milestones") result.milestonesByProject[projectId] = value.rows;
          if (descriptor.source === "weeklyReports") {
            const periods = splitWeeklyReportsByRange(value, request, previousRange);
            result.weeklyByProject[projectId] = periods.current;
            result.previousWeeklyByProject[projectId] = periods.previous;
            result.nextPlannedHoursByProject[projectId] = plannedHours(periods.current);
            result.weeklyReplacedIdsByProject[projectId] = value.replacedIds || [];
          }
          replaceStatus(descriptor, value.status);
          if (["daily", "previousDaily"].includes(descriptor.source)) {
            const dailyStatus = result.sourceStatus.find(function (item) {
              return item.source === "daily";
            });
            const previousDailyStatus = result.sourceStatus.find(function (item) {
              return item.source === "previousDaily";
            });
            setFormalScope(
              result,
              { status: dailyStatus && dailyStatus.status, rows: groupedRows(result.dailyByProject) },
              {
                status: previousDailyStatus && previousDailyStatus.status,
                rows: groupedRows(result.previousDailyByProject)
              }
            );
            Object.assign(result.diagnostics, result.formalScope);
          }
          onProgress({ requestId: request.requestId, stage: "retry", source: descriptor.source, projectId });
        } catch (error) {
          if (isSessionExpired(error)) {
            controller.abort();
            throw error;
          }
          remaining.push(Object.assign({}, descriptor, { error: errorMessage(error) }));
        }
      }
      result.failedRequests = remaining;
      result.complete = remaining.length === 0;
      result.coverage = coverage(result);
      return result;
    } finally {
      if (active && active.requestId === request.requestId) active = null;
    }
  }

  return { collect, retryFailed, cancel };
}
