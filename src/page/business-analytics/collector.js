import { getEndMonthRange, getPreviousDateRange } from "../../analytics/date-range.js";
import { isValidRequestId } from "../../shared/protocol.js";
import { buildProjectScope, selectDepartmentProjects } from "./scope.js";

const PROJECT_SOURCES = Object.freeze(["wbs", "milestones", "weeklyReports", "invoices"]);

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

function plannedHours(weekly) {
  if (!weekly || weekly.status === "failed") return null;
  const rows = weekly.aggregate && weekly.aggregate.nextExecutions || [];
  return rows.reduce(function (sum, row) {
    const value = Number(row.planHour ?? row.plannedHours ?? row.duration ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export function createAnalyticsCollector(adapters) {
  const data = adapters.data;
  const AbortControllerCtor = adapters.AbortController || globalThis.AbortController;
  const sleep = adapters.sleep || function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };
  const concurrency = Math.min(4, Math.max(1, adapters.concurrency || 4));
  let active = null;

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
      const scope = buildProjectScope({
        departments,
        projects,
        filters: request.projectFilters,
        recentDepartmentIds: request.recentDepartmentIds
      });
      const selectedProjects = selectDepartmentProjects(scope, String(request.departmentId));
      const base = {
        requestId: request.requestId,
        departmentId: request.departmentId,
        departmentName: request.departmentName,
        startDate: request.startDate,
        endDate: request.endDate,
        projects: selectedProjects,
        scope,
        dailyByProject: {},
        previousDailyByProject: {},
        wbsByProject: {},
        milestonesByProject: {},
        invoicesByProject: {},
        weeklyByProject: {},
        nextPlannedHoursByProject: {},
        failedRequests: [],
        sourceStatus: []
      };
      if (selectedProjects.length === 0) {
        return Object.assign(base, {
          complete: true,
          coverage: 1,
          diagnostics: scope.diagnostics
        });
      }

      const previous = getPreviousDateRange(request);
      const month = getEndMonthRange(request);
      progress("sharedSources", { totalProjects: selectedProjects.length });
      const sharedDefinitions = [
        ["daily", function () { return data.fetchDailyRows(request.startDate, request.endDate, signal); }],
        ["previousDaily", function () { return data.fetchDailyRows(previous.startDate, previous.endDate, signal); }],
        ["monthlyInvoices", function () {
          return data.fetchMonthlyInvoiceSupplement(month.startDate, month.endDate, selectedProjects, signal);
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
            weeklyReports: function () { return data.fetchWeeklyReports(project, request, signal); },
            invoices: function () { return data.fetchProjectInvoices(projectId, signal); }
          };
          for (const source of PROJECT_SOURCES) {
            try {
              const value = await retry(operations[source], signal);
              base.sourceStatus.push({ source, projectId, status: value.status });
              if (source === "wbs") base.wbsByProject[projectId] = value.rows;
              if (source === "milestones") base.milestonesByProject[projectId] = value.rows;
              if (source === "weeklyReports") {
                base.weeklyByProject[projectId] = value;
                base.nextPlannedHoursByProject[projectId] = plannedHours(value);
              }
              if (source === "invoices") base.invoicesByProject[projectId] = value.rows;
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

      (shared.monthlyInvoices.rows || []).forEach(function (row) {
        (base.invoicesByProject[row.projectId] ||= []).push(row);
      });
      const mandatory = base.sourceStatus;
      const successful = mandatory.filter(function (item) {
        return ["success", "empty", "notApplicable"].includes(item.status);
      }).length;
      const complete = base.failedRequests.length === 0;
      progress("complete", { complete });
      return Object.assign(base, {
        complete,
        coverage: mandatory.length > 0 ? successful / mandatory.length : 1,
        diagnostics: Object.assign({}, scope.diagnostics, {
          invoiceSupplement: shared.monthlyInvoices.diagnostics || {},
          replacedWeeklyReportIds: Object.values(base.weeklyByProject).flatMap(function (item) {
            return item.replacedIds || [];
          })
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
        const project = projectId && result.projects.find(function (item) {
          return String(item.projectId) === projectId;
        });
        let operation;
        if (descriptor.source === "daily") {
          operation = function () { return data.fetchDailyRows(request.startDate, request.endDate, signal); };
        } else if (descriptor.source === "previousDaily") {
          const range = getPreviousDateRange(request);
          operation = function () { return data.fetchDailyRows(range.startDate, range.endDate, signal); };
        } else if (descriptor.source === "monthlyInvoices") {
          const range = getEndMonthRange(request);
          operation = function () {
            return data.fetchMonthlyInvoiceSupplement(range.startDate, range.endDate, result.projects, signal);
          };
        } else if (descriptor.source === "wbs" && projectId) {
          operation = function () { return data.fetchWbs(projectId, signal); };
        } else if (descriptor.source === "milestones" && projectId) {
          operation = function () { return data.fetchMilestones(projectId, signal); };
        } else if (descriptor.source === "weeklyReports" && project) {
          operation = function () { return data.fetchWeeklyReports(project, request, signal); };
        } else if (descriptor.source === "invoices" && projectId) {
          operation = function () { return data.fetchProjectInvoices(projectId, signal); };
        }
        if (!operation) {
          remaining.push(descriptor);
          continue;
        }
        try {
          const value = await retry(operation, signal);
          if (descriptor.source === "daily") result.dailyByProject = groupByProject(value.rows);
          if (descriptor.source === "previousDaily") result.previousDailyByProject = groupByProject(value.rows);
          if (descriptor.source === "monthlyInvoices") {
            value.rows.forEach(function (row) { (result.invoicesByProject[row.projectId] ||= []).push(row); });
            result.diagnostics.invoiceSupplement = value.diagnostics || {};
          }
          if (descriptor.source === "wbs") result.wbsByProject[projectId] = value.rows;
          if (descriptor.source === "milestones") result.milestonesByProject[projectId] = value.rows;
          if (descriptor.source === "weeklyReports") {
            result.weeklyByProject[projectId] = value;
            result.nextPlannedHoursByProject[projectId] = plannedHours(value);
          }
          if (descriptor.source === "invoices") result.invoicesByProject[projectId] = value.rows;
          replaceStatus(descriptor, value.status);
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
      const successful = result.sourceStatus.filter(function (item) {
        return ["success", "empty", "notApplicable"].includes(item.status);
      }).length;
      result.coverage = result.sourceStatus.length > 0 ? successful / result.sourceStatus.length : 1;
      return result;
    } finally {
      if (active && active.requestId === request.requestId) active = null;
    }
  }

  return { collect, retryFailed, cancel };
}
