import { createAnalyticsConfig, migrateStoredConfig } from "../../analytics/config.js";
import { getDefaultDateRange } from "../../analytics/date-range.js";
import { normalizeDateRange } from "../../analytics/domain.js";
import { DEFAULTS } from "../../shared/defaults.js";
import { createAnalyticsEngine } from "../../analytics/engine.js";
import { MESSAGE_TYPES, SOURCES, createRequestMessage, parseWindowMessage } from "../../shared/protocol.js";
import { createBusinessAnalyticsNavigation } from "./navigation.js";
import { createBusinessAnalyticsReportView } from "./report-view.js";

export function createBusinessAnalyticsController(adapters) {
  const window = adapters.window;
  const chrome = adapters.chrome;
  let controller;
  const engine = createAnalyticsEngine();
  const navigation = createBusinessAnalyticsNavigation({
    window,
    document: adapters.document
  });
  const view = createBusinessAnalyticsReportView({
    document: adapters.document,
    cssUrl: chrome.runtime.getURL("business-analytics.css"),
    onAction: function (action) { controller.handleAction(action); },
    onSelection: function (projectIds) { controller.selectProjects(projectIds); }
  });
  let config;
  let activeRequestId = null;
  let lastQuery = null;
  let requestSequence = 0;
  let formalInput = null;
  let formalReport = null;

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

  function query(forceRefresh) {
    try {
      const values = view.getQuery();
      if (!values.departmentId) throw new Error("请选择部门");
      normalizeDateRange(values);
      lastQuery = values;
      view.renderState({ kind: "loading", message: "正在准备经营数据..." });
      send(MESSAGE_TYPES.ANALYTICS_REQUEST, Object.assign({}, values, {
        forceRefresh: forceRefresh === true,
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
        capturedAt: new Date().toISOString()
      });
      formalReport = engine.buildReport(formalInput);
      view.renderState({ kind: result.complete ? "ready" : "partial" });
      view.renderReport(formalReport, { formal: true });
    }
  }

  function ensureNavigation() {
    return navigation.ensure(function () { open().catch(function (error) {
      view.renderState({ kind: "error", message: error.message || String(error) });
    }); });
  }

  function syncLocation() {
    const wasActive = navigation.isActive();
    navigation.syncLocation();
    if (wasActive && !navigation.isActive()) cancel();
  }

  window.addEventListener("message", handlePageMessage);
  controller = { open, query, retryFailed, cancel, handleAction, selectProjects, ensureNavigation, syncLocation };
  return controller;
}
