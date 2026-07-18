import {
  DEFAULT_PROJECT_FILTERS,
  DEFAULT_RISK_THRESHOLDS,
  createAnalyticsConfig,
  migrateStoredConfig
} from "../analytics/config.js";
import { PROJECT_ENUMS } from "../analytics/domain.js";
import { DEFAULTS, DEFAULT_SYSTEM_PROMPT } from "../shared/defaults.js";
import { MESSAGE_TYPES } from "../shared/protocol.js";

const FILTER_LABELS = Object.freeze({
  attribute: "项目属性",
  classification: "项目分类",
  currStatus: "一级项目状态",
  outsourcing: "执行类型"
});

export function createOptionsPayload(values) {
  const analytics = createAnalyticsConfig({
    projectFilters: values.analyticsProjectFilters,
    riskThresholds: values.analyticsRiskThresholds
  });
  return {
    provider: values.provider || "deepseek",
    baseUrl: String(values.baseUrl || "").trim(),
    apiKey: String(values.apiKey || "").trim(),
    model: String(values.model || "").trim(),
    enableThinking: values.enableThinking === true,
    systemPrompt: String(values.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT,
    projectManager: String(values.projectManager || "").trim(),
    analyticsProjectFilters: analytics.projectFilters,
    analyticsRiskThresholds: analytics.riskThresholds,
    analyticsConfigVersion: analytics.configVersion,
    analyticsPolicyVersion: analytics.policyVersion
  };
}

export function startOptions(adapters) {
  const document = adapters.document;
  const window = adapters.window;
  const chrome = adapters.chrome;
  const fields = Object.fromEntries([
    "provider", "baseUrl", "apiKey", "model", "enableThinking", "projectManager",
    "systemPrompt", "modelList", "refreshModels", "save", "restoreAnalytics", "status"
  ].map(function (id) { return [id, document.getElementById(id)]; }));
  let dirty = false;

  function storageGet(defaults) {
    return new Promise(function (resolve) { chrome.storage.local.get(defaults, resolve); });
  }

  function storageSet(data) {
    return new Promise(function (resolve) { chrome.storage.local.set(data, resolve); });
  }

  function sendMessage(message) {
    return new Promise(function (resolve) { chrome.runtime.sendMessage(message, resolve); });
  }

  function setStatus(text, kind) {
    fields.status.textContent = text || "";
    fields.status.dataset.kind = kind || "";
  }

  function renderFilterFields() {
    const root = document.getElementById("projectFilters");
    Object.entries(PROJECT_ENUMS).forEach(function ([field, choices]) {
      const group = document.createElement("fieldset");
      group.dataset.filter = field;
      const legend = document.createElement("legend");
      legend.textContent = FILTER_LABELS[field];
      group.appendChild(legend);
      const unlimited = document.createElement("label");
      unlimited.innerHTML = '<input type="checkbox" data-unlimited="' + field + '"><span>不限</span>';
      group.appendChild(unlimited);
      Object.entries(choices).forEach(function ([key, label]) {
        const option = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = key;
        input.dataset.choice = field;
        const text = document.createElement("span");
        text.textContent = label;
        option.append(input, text);
        group.appendChild(option);
      });
      root.appendChild(group);
    });
  }

  function setFilters(filters) {
    Object.keys(PROJECT_ENUMS).forEach(function (field) {
      const value = filters[field];
      document.querySelector('[data-unlimited="' + field + '"]').checked = value === null;
      document.querySelectorAll('[data-choice="' + field + '"]').forEach(function (input) {
        input.checked = Array.isArray(value) && value.includes(input.value);
        input.disabled = value === null;
      });
    });
  }

  function readFilters() {
    return Object.fromEntries(Object.keys(PROJECT_ENUMS).map(function (field) {
      const unlimited = document.querySelector('[data-unlimited="' + field + '"]').checked;
      const selected = [...document.querySelectorAll('[data-choice="' + field + '"]:checked')]
        .map(function (input) { return input.value; });
      return [field, unlimited ? null : selected];
    }));
  }

  function readThresholds() {
    return Object.fromEntries(Object.keys(DEFAULT_RISK_THRESHOLDS).map(function (field) {
      return [field, Number(document.querySelector('[data-threshold="' + field + '"]').value)];
    }));
  }

  function readForm() {
    return createOptionsPayload({
      provider: fields.provider.value,
      baseUrl: fields.baseUrl.value,
      apiKey: fields.apiKey.value,
      model: fields.model.value,
      enableThinking: fields.enableThinking.checked,
      projectManager: fields.projectManager.value,
      systemPrompt: fields.systemPrompt.value,
      analyticsProjectFilters: readFilters(),
      analyticsRiskThresholds: readThresholds()
    });
  }

  function fillForm(data) {
    fields.provider.value = data.provider;
    fields.baseUrl.value = data.baseUrl;
    fields.apiKey.value = data.apiKey;
    fields.model.value = data.model;
    fields.enableThinking.checked = data.enableThinking;
    fields.projectManager.value = data.projectManager;
    fields.systemPrompt.value = data.systemPrompt;
    setFilters(data.analyticsProjectFilters);
    Object.entries(data.analyticsRiskThresholds).forEach(function ([field, value]) {
      document.querySelector('[data-threshold="' + field + '"]').value = value;
    });
  }

  async function load() {
    const data = migrateStoredConfig(await storageGet(DEFAULTS));
    fillForm(createOptionsPayload(data));
    dirty = false;
  }

  async function save() {
    try {
      await storageSet(readForm());
      dirty = false;
      setStatus("配置已保存。筛选变化后旧报告缓存不会作为当前口径使用。", "ok");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), "error");
      throw error;
    }
  }

  async function refreshModels() {
    fields.refreshModels.disabled = true;
    try {
      await save();
      const response = await sendMessage({ type: MESSAGE_TYPES.AI_FETCH_MODELS });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "获取模型失败");
      }
      fields.modelList.textContent = "";
      (response.models || []).forEach(function (model) {
        const option = document.createElement("option");
        option.value = model;
        fields.modelList.appendChild(option);
      });
      setStatus("已获取 " + (response.models || []).length + " 个模型", "ok");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), "error");
    } finally {
      fields.refreshModels.disabled = false;
    }
  }

  renderFilterFields();
  document.addEventListener("input", function () { dirty = true; });
  document.addEventListener("change", function (event) {
    dirty = true;
    const field = event.target.dataset.unlimited;
    if (field) {
      document.querySelectorAll('[data-choice="' + field + '"]').forEach(function (input) {
        input.disabled = event.target.checked;
      });
    }
  });
  fields.save.addEventListener("click", function () { save().catch(function () {}); });
  fields.refreshModels.addEventListener("click", refreshModels);
  fields.restoreAnalytics.addEventListener("click", function () {
    setFilters(DEFAULT_PROJECT_FILTERS);
    Object.entries(DEFAULT_RISK_THRESHOLDS).forEach(function ([field, value]) {
      document.querySelector('[data-threshold="' + field + '"]').value = value;
    });
    dirty = true;
    setStatus("已恢复经营分析默认值，保存后生效。", "");
  });
  window.addEventListener("beforeunload", function (event) {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  load().catch(function (error) { setStatus(error.message || String(error), "error"); });
  return { load, readForm, refreshModels, save };
}
