import { createAnalyticsConfig, migrateStoredConfig } from "../../analytics/config.js";
import { getDefaultDateRange } from "../../analytics/date-range.js";
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
    onDepartment: function (departmentId) { controller.selectDepartment(departmentId); },
    onDateRange: function () { controller.handleDateRangeChange(); }
  });
  let config = adapters.config;
  let activeRequestId = null;
  let activeRequestKind = null;
  let lastQuery = null;
  let requestSequence = 0;
  let formalInput = null;
  let formalReport = null;
  let availableDepartments = adapters.departments || [];
  let scopeReady = adapters.scopeReady === true || availableDepartments.length > 0;
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
    if (activeRequestId) {
      window.postMessage(createRequestMessage(
        SOURCES.ANALYTICS_CONTENT,
        MESSAGE_TYPES.ANALYTICS_CANCEL,
        activeRequestId
      ), "*");
    }
    const id = requestId(type === MESSAGE_TYPES.ANALYTICS_REQUEST ? "analytics" : "request");
    activeRequestId = id;
    activeRequestKind = payload && payload.scopeOnly === true ? "scope" : "query";
    window.postMessage(createRequestMessage(
      SOURCES.ANALYTICS_CONTENT,
      type,
      id,
      payload
    ), "*");
    return id;
  }

  async function loadConfig() {
    const stored = migrateStoredConfig(await storageGet(DEFAULTS));
    config = createAnalyticsConfig({
      projectFilters: stored.analyticsProjectFilters,
      riskThresholds: stored.analyticsRiskThresholds
    });
  }

  async function open() {
    const shadow = navigation.mount();
    view.mount(shadow);
    view.setDateRange(getDefaultDateRange(new Date()));
    await loadConfig();
    loadScope();
  }

  function loadScope() {
    const range = view.getQuery();
    normalizeDateRange(range);
    scopeReady = false;
    availableDepartments = [];
    formalInput = null;
    formalReport = null;
    lastQuery = null;
    view.clearReport?.();
    view.setExportEnabled?.(false);
    view.setScopeEnabled?.(false);
    view.renderState({ kind: "scope" });
    send(MESSAGE_TYPES.ANALYTICS_REQUEST, {
      scopeOnly: true,
      departmentId: "all",
      startDate: range.startDate,
      endDate: range.endDate,
      projectFilters: config.projectFilters
    });
  }

  async function query() {
    try {
      const values = view.getQuery();
      if (!scopeReady) throw new Error("部门范围尚未加载");
      if (!values.departmentId) throw new Error("请选择部门");
      normalizeDateRange(values);
      lastQuery = Object.assign({}, values);
      formalInput = null;
      formalReport = null;
      view.clearReport?.();
      view.setExportEnabled?.(false);
      view.setQueryPending?.(true);
      view.renderState({ kind: "loading", message: "正在实时获取经营数据..." });
      send(MESSAGE_TYPES.ANALYTICS_REQUEST, Object.assign({}, values, {
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
    activeRequestKind = null;
    view.setQueryPending?.(false);
    view.renderState({ kind: "initial", status: "已取消" });
  }

  function retryFailed() {
    if (!lastQuery || !formalInput || !(formalInput.failedRequests || []).length) return;
    view.setQueryPending?.(true);
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
    if (action === "query") query();
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
  }

  function handleDateRangeChange() {
    try {
      const values = view.getQuery();
      normalizeDateRange(values);
      if (activeRequestId) {
        window.postMessage(createRequestMessage(
          SOURCES.ANALYTICS_CONTENT,
          MESSAGE_TYPES.ANALYTICS_CANCEL,
          activeRequestId
        ), "*");
        activeRequestId = null;
        activeRequestKind = null;
      }
      view.setQueryPending?.(false);
      formalInput = null;
      formalReport = null;
      lastQuery = null;
      view.clearReport?.();
      view.setExportEnabled?.(false);
      if (config.projectFilters.onlyCurrentPeriodInput === false) {
        view.renderState({ kind: "initial", status: "日期已更新" });
        return;
      }
      view.setDepartment?.("");
      loadScope();
    } catch (error) {
      scopeReady = false;
      view.setScopeEnabled?.(false);
      view.renderState({ kind: "error", message: error.message || String(error) });
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
      view.renderState({
        kind: activeRequestKind === "scope" ? "scope" : "loading",
        message: progress.stage || "处理中",
        percent
      });
      return;
    }
    const requestKind = activeRequestKind;
    activeRequestId = null;
    activeRequestKind = null;
    if (message.type === MESSAGE_TYPES.ANALYTICS_ERROR) {
      if (requestKind === "scope") {
        scopeReady = false;
        view.setScopeEnabled?.(false);
      }
      view.setQueryPending?.(false);
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
      scopeReady = true;
      view.setScopeEnabled?.(true);
      view.renderState({ kind: "initial", status: "部门已加载" });
      return;
    }
    formalInput = Object.assign({}, result, {
      departmentId: lastQuery.departmentId,
      departmentName: lastQuery.departmentName,
      configVersion: config.configVersion,
      policyVersion: config.policyVersion,
      riskThresholds: config.riskThresholds,
      capturedAt: new Date().toISOString()
    });
    formalReport = lastQuery.departmentId === "all"
      ? engine.buildCompanyReport({ liveInput: formalInput, departments: availableDepartments })
      : engine.buildReport(formalInput);
    const empty = formalInput.formalScope && formalInput.formalScope.formalProjectCount === 0;
    view.renderState({ kind: empty ? "empty" : result.complete ? "ready" : "partial" });
    view.renderReport(formalReport, {
      formal: true,
      company: lastQuery.departmentId === "all"
    });
    view.setQueryPending?.(false);
    view.setExportEnabled?.(true);
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
    handleDateRangeChange,
    ensureNavigation,
    syncLocation
  };
  return controller;
}
