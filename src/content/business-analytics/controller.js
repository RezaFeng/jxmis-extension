import { createAnalyticsConfig, createReportKey, migrateStoredConfig } from "../../analytics/config.js";
import { getDefaultDateRange, getPreviousDateRange } from "../../analytics/date-range.js";
import { normalizeDateRange } from "../../analytics/domain.js";
import { DEFAULTS } from "../../shared/defaults.js";
import { createAnalyticsEngine } from "../../analytics/engine.js";
import { createOfflineReport, createOfflineReportFileName } from "../../analytics/html-export.js";
import { MESSAGE_TYPES, SOURCES, createRequestMessage, parseWindowMessage } from "../../shared/protocol.js";
import { createBusinessAnalyticsNavigation } from "./navigation.js";
import { createBusinessAnalyticsReportView } from "./report-view.js";

export function createBusinessAnalyticsController(adapters) {
  const window = adapters.window;
  const chrome = adapters.chrome;
  let controller;
  const engine = adapters.engine || createAnalyticsEngine();
  const navigation = adapters.navigation || createBusinessAnalyticsNavigation({
    window,
    document: adapters.document
  });
  const view = adapters.view || createBusinessAnalyticsReportView({
    document: adapters.document,
    cssUrl: chrome.runtime.getURL("business-analytics.css"),
    onAction: function (action) { controller.handleAction(action); },
    onSelection: function (projectIds) { controller.selectProjects(projectIds); },
    onDepartment: function (departmentId) { controller.selectDepartment(departmentId); }
  });
  let config = adapters.config;
  let activeRequestId = null;
  let lastQuery = null;
  let requestSequence = 0;
  let formalInput = null;
  let formalReport = null;
  let previousSnapshot = null;
  let availableDepartments = adapters.departments || [];
  const now = adapters.now || function () { return new Date(); };

  function download(value) {
    if (adapters.download) {
      adapters.download(value);
      return;
    }
    const BlobCtor = adapters.Blob || window.Blob || globalThis.Blob;
    const urlApi = adapters.URL || window.URL || globalThis.URL;
    const url = urlApi.createObjectURL(new BlobCtor([value.html], { type: "text/html;charset=utf-8" }));
    const anchor = adapters.document.createElement("a");
    anchor.href = url;
    anchor.download = value.fileName;
    anchor.click();
    urlApi.revokeObjectURL(url);
  }

  function requestId(prefix) {
    requestSequence += 1;
    return prefix + "-" + Date.now() + "-" + requestSequence;
  }

  function storageGet(defaults) {
    return new Promise(function (resolve) { chrome.storage.local.get(defaults, resolve); });
  }

  function send(type, payload) {
    const id = requestId(type === MESSAGE_TYPES.ANALYTICS_REQUEST ? "analytics" : "request");
    activeRequestId = id;
    window.postMessage(createRequestMessage(
      SOURCES.ANALYTICS_CONTENT,
      type,
      id,
      payload
    ), "*");
    return id;
  }

  function sendBackground(type, payload) {
    const message = Object.assign({}, payload, {
      type,
      requestId: requestId("repository")
    });
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (response) {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message || "background unavailable" });
      });
    });
  }

  async function loadConfig() {
    const stored = migrateStoredConfig(await storageGet(DEFAULTS));
    config = createAnalyticsConfig({
      projectFilters: stored.analyticsProjectFilters,
      riskThresholds: stored.analyticsRiskThresholds
    });
  }

  async function loadCompanyReport(values) {
    const results = await Promise.all(availableDepartments.map(async function (department) {
      const reportKey = createReportKey(Object.assign({}, values, config, {
        departmentId: department.id
      }));
      const response = await sendBackground(MESSAGE_TYPES.ANALYTICS_GET_LATEST, { reportKey });
      return response.ok ? response.result : null;
    }));
    const report = engine.buildCompanyReport({
      snapshots: results.filter(Boolean),
      departments: availableDepartments,
      configVersion: config.configVersion,
      policyVersion: config.policyVersion,
      startDate: values.startDate,
      endDate: values.endDate
    });
    formalInput = null;
    formalReport = report;
    view.renderReport(report, { formal: true, cached: true, company: true });
    view.setExportEnabled?.(true);
    view.renderState({
      kind: report.company.complete ? "ready" : "partial",
      status: "部门覆盖 " + Math.round(report.company.coverage * availableDepartments.length) + "/" + availableDepartments.length,
      message: report.company.complete ? "全部有效部门快照已聚合。" : "部分部门尚无同口径完整快照。"
    });
  }

  async function open() {
    const shadow = navigation.mount();
    view.mount(shadow);
    view.setDateRange(getDefaultDateRange(new Date()));
    view.renderState({ kind: "scope" });
    await loadConfig();
    const range = view.getQuery();
    send(MESSAGE_TYPES.ANALYTICS_REQUEST, {
      scopeOnly: true,
      departmentId: "all",
      startDate: range.startDate,
      endDate: range.endDate,
      projectFilters: config.projectFilters
    });
  }

  async function query(forceRefresh) {
    try {
      const options = forceRefresh && typeof forceRefresh === "object"
        ? forceRefresh
        : { forceRefresh: forceRefresh === true };
      const values = view.getQuery();
      if (!values.departmentId) throw new Error("请选择部门");
      normalizeDateRange(values);
      lastQuery = Object.assign({}, values, {
        cumulativeAvailable: options.historical ? false : undefined,
        historyMode: options.historical ? "interval" : "current"
      });
      view.setExportEnabled?.(false);
      view.renderState({ kind: "loading", message: "正在准备经营数据..." });
      if (values.departmentId === "all" && options.forceRefresh !== true && availableDepartments.length > 0) {
        await loadCompanyReport(values);
        return;
      }
      const reportKey = createReportKey(Object.assign({}, values, config));
      if (options.forceRefresh !== true) {
        const cached = await sendBackground(MESSAGE_TYPES.ANALYTICS_GET_LATEST, { reportKey });
        const snapshot = cached.ok && cached.result;
        if (snapshot && snapshot.report) {
          formalInput = snapshot.input || null;
          formalReport = snapshot.report;
          view.renderReport(formalReport, { formal: true, cached: true });
          view.setExportEnabled?.(true);
          view.renderState({
            kind: "ready",
            status: (options.historical ? "历史快照 " : "缓存 ") + snapshot.capturedAt,
            message: "已显示最近完整快照，正在刷新经营数据..."
          });
          if (options.historical) return;
        }
      }
      const previousRange = getPreviousDateRange(values);
      const previousKey = createReportKey(Object.assign({}, values, previousRange, config));
      const previous = await sendBackground(MESSAGE_TYPES.ANALYTICS_GET_LATEST, {
        reportKey: previousKey
      });
      previousSnapshot = previous.ok ? previous.result : null;
      send(MESSAGE_TYPES.ANALYTICS_REQUEST, Object.assign({}, values, {
        forceRefresh: options.forceRefresh === true,
        cumulativeAvailable: options.historical ? false : undefined,
        historyMode: options.historical ? "interval" : "current",
        projectFilters: config.projectFilters,
        riskThresholds: config.riskThresholds,
        configVersion: config.configVersion,
        policyVersion: config.policyVersion
      }));
    } catch (error) {
      view.renderState({ kind: "error", message: error.message || String(error) });
    }
  }

  function cancel() {
    if (!activeRequestId) return;
    window.postMessage(createRequestMessage(
      SOURCES.ANALYTICS_CONTENT,
      MESSAGE_TYPES.ANALYTICS_CANCEL,
      activeRequestId
    ), "*");
    activeRequestId = null;
    view.renderState({ kind: "initial", status: "已取消" });
  }

  function retryFailed() {
    if (!lastQuery || !formalInput || !(formalInput.failedRequests || []).length) return;
    view.renderState({ kind: "loading", message: "正在重试失败数据源..." });
    send(MESSAGE_TYPES.ANALYTICS_REQUEST, Object.assign({}, lastQuery, {
      retryFailed: true,
      previous: formalInput,
      projectFilters: config.projectFilters,
      riskThresholds: config.riskThresholds,
      configVersion: config.configVersion,
      policyVersion: config.policyVersion
    }));
  }

  function exportReport() {
    if (!formalReport) return;
    download({
      html: createOfflineReport(formalReport),
      fileName: createOfflineReportFileName(formalReport, now())
    });
  }

  function handleAction(action) {
    if (action === "close") {
      cancel();
      navigation.restore();
    }
    if (action === "query") query(false);
    if (action === "refresh" && lastQuery) query(true);
    if (action === "cancel") cancel();
    if (action === "settings") chrome.runtime.openOptionsPage();
    if (action === "retry-failed") retryFailed();
    if (action === "export") exportReport();
  }

  function selectProjects(projectIds) {
    if (!formalInput || !formalReport) return;
    if (!projectIds || projectIds.length === formalInput.projects.length) {
      view.renderReport(formalReport, { formal: false });
      return;
    }
    const report = engine.buildReport(Object.assign({}, formalInput, {
      selectedProjectIds: projectIds
    }));
    view.renderReport(report, { formal: false });
  }

  function selectDepartment(departmentId) {
    if (!view.setDepartment) return;
    view.setDepartment(departmentId);
    query(false);
  }

  function persistFormalResult(input, report) {
    const reportKey = createReportKey(input);
    if (input.complete === true && report.scope.persistable) {
      const snapshot = {
        reportKey,
        complete: true,
        capturedAt: input.capturedAt,
        departmentId: input.departmentId,
        configVersion: input.configVersion,
        policyVersion: input.policyVersion,
        startDate: input.startDate,
        endDate: input.endDate,
        input,
        report,
        metrics: report.metrics
      };
      sendBackground(MESSAGE_TYPES.ANALYTICS_SAVE_COMPLETE, { snapshot });
      sendBackground(MESSAGE_TYPES.ANALYTICS_SAVE_QUERY_CACHE, {
        entry: {
          reportKey,
          queryKey: reportKey,
          capturedAt: input.capturedAt,
          input
        }
      });
      return;
    }
    if ((input.failedRequests || []).length > 0) {
      sendBackground(MESSAGE_TYPES.ANALYTICS_SAVE_FAILED, {
        reportKey,
        descriptors: input.failedRequests
      });
    }
  }

  function handlePageMessage(event) {
    const parsed = parseWindowMessage(event, {
      windowRef: window,
      source: SOURCES.ANALYTICS_PAGE,
      types: [
        MESSAGE_TYPES.ANALYTICS_PROGRESS,
        MESSAGE_TYPES.ANALYTICS_RESULT,
        MESSAGE_TYPES.ANALYTICS_ERROR
      ]
    });
    if (!parsed.ok || parsed.value.requestId !== activeRequestId) return;
    const message = parsed.value;
    if (message.type === MESSAGE_TYPES.ANALYTICS_PROGRESS) {
      const progress = message.progress || {};
      const percent = progress.totalProjects
        ? Math.round((progress.completedProjects || 0) / progress.totalProjects * 100)
        : 12;
      view.renderState({ kind: "loading", message: progress.stage || "处理中", percent });
      return;
    }
    activeRequestId = null;
    if (message.type === MESSAGE_TYPES.ANALYTICS_ERROR) {
      view.renderState({
        kind: message.code === "SESSION_EXPIRED" ? "session" : "error",
        message: message.error
      });
      return;
    }
    const result = message.result;
    if (result.scopeOnly) {
      availableDepartments = result.scope.departments || [];
      view.setDepartments(result.scope.departments);
      view.renderState({ kind: "initial", status: "部门已加载" });
      return;
    }
    if (result.projects.length === 0) view.renderState({ kind: "empty" });
    else {
      formalInput = Object.assign({}, result, {
        departmentId: lastQuery.departmentId,
        departmentName: lastQuery.departmentName,
        configVersion: config.configVersion,
        policyVersion: config.policyVersion,
        riskThresholds: config.riskThresholds,
        previousReport: previousSnapshot && previousSnapshot.report,
        cumulativeAvailable: lastQuery.cumulativeAvailable,
        historyMode: lastQuery.historyMode,
        capturedAt: new Date().toISOString()
      });
      formalReport = engine.buildReport(formalInput);
      view.renderState({ kind: result.complete ? "ready" : "partial" });
      view.renderReport(formalReport, { formal: true });
      view.setExportEnabled?.(true);
      persistFormalResult(formalInput, formalReport);
    }
  }

  function ensureNavigation() {
    return navigation.ensure(function () { open().catch(function (error) {
      view.renderState({ kind: "error", message: error.message || String(error) });
    }); }, function () {
      cancel();
      navigation.restore();
    });
  }

  function syncLocation() {
    const wasActive = navigation.isActive();
    navigation.syncLocation();
    if (wasActive && !navigation.isActive()) cancel();
  }

  window.addEventListener("message", handlePageMessage);
  controller = {
    open,
    query,
    retryFailed,
    exportReport,
    cancel,
    handleAction,
    selectProjects,
    selectDepartment,
    ensureNavigation,
    syncLocation
  };
  return controller;
}
