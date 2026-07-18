import { AnalyticsSchemaError, PROJECT_ENUMS, normalizeDateRange } from "./domain.js";

export const FILTER_FIELDS = Object.freeze([
  "attribute",
  "classification",
  "currStatus",
  "outsourcing"
]);

export const DEFAULT_PROJECT_FILTERS = Object.freeze({
  attribute: null,
  classification: Object.freeze(["J", "Z"]),
  currStatus: Object.freeze(["10", "20", "50"]),
  outsourcing: null
});

export const DEFAULT_RISK_THRESHOLDS = Object.freeze({
  lowPerCapita: 300000,
  cpiWarn: 0.85,
  spiWarn: 0.8,
  spiCritical: 0.5,
  budgetExhaustionDays: 90,
  highInputZeroOutputMd: 0.5,
  severeOverrunRatio: 1.15
});

function cloneFilters(filters) {
  return Object.fromEntries(FILTER_FIELDS.map(function (field) {
    return [field, filters[field] === null ? null : [...filters[field]]];
  }));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + canonicalize(value[key]);
    }).join(",") + "}";
  }
  return JSON.stringify(value);
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(value);
  bytes.forEach(function (byte) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  });
  return hash.toString(16).padStart(16, "0");
}

export function stableVersion(value) {
  return "v1-" + fnv1a64(canonicalize(value));
}

export function validateProjectFilters(input) {
  const source = input === undefined || input === null ? DEFAULT_PROJECT_FILTERS : input;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new AnalyticsSchemaError("projectFilters", "must be an object", input);
  }
  const result = {};
  FILTER_FIELDS.forEach(function (field) {
    const value = source[field] === undefined ? DEFAULT_PROJECT_FILTERS[field] : source[field];
    if (value === null) {
      result[field] = null;
      return;
    }
    if (!Array.isArray(value) || value.length === 0) {
      throw new AnalyticsSchemaError(field, "must be null or a non-empty array", value);
    }
    const unique = [...new Set(value.map(function (item) { return String(item); }))];
    unique.forEach(function (item) {
      if (!Object.hasOwn(PROJECT_ENUMS[field], item)) {
        throw new AnalyticsSchemaError(field, "contains unknown value " + item, value);
      }
    });
    result[field] = unique.sort();
  });
  return result;
}

function requireNumber(source, field, predicate, message) {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value) || !predicate(value)) {
    throw new AnalyticsSchemaError(field, message, value);
  }
  return value;
}

export function validateRiskThresholds(input) {
  const source = Object.assign({}, DEFAULT_RISK_THRESHOLDS, input || {});
  const result = {
    lowPerCapita: requireNumber(source, "lowPerCapita", function (v) { return v > 0; }, "must be > 0"),
    cpiWarn: requireNumber(source, "cpiWarn", function (v) { return v > 0; }, "must be > 0"),
    spiWarn: requireNumber(source, "spiWarn", function (v) { return v > 0; }, "must be > 0"),
    spiCritical: requireNumber(source, "spiCritical", function (v) { return v > 0; }, "must be > 0"),
    budgetExhaustionDays: requireNumber(
      source,
      "budgetExhaustionDays",
      Number.isInteger,
      "must be a positive integer"
    ),
    highInputZeroOutputMd: requireNumber(
      source,
      "highInputZeroOutputMd",
      function (v) { return v >= 0; },
      "must be >= 0"
    ),
    severeOverrunRatio: requireNumber(
      source,
      "severeOverrunRatio",
      function (v) { return v > 1; },
      "must be > 1"
    )
  };
  if (result.budgetExhaustionDays <= 0) {
    throw new AnalyticsSchemaError(
      "budgetExhaustionDays",
      "must be a positive integer",
      result.budgetExhaustionDays
    );
  }
  if (result.spiCritical >= result.spiWarn) {
    throw new AnalyticsSchemaError("spiCritical", "must be less than spiWarn", result.spiCritical);
  }
  return result;
}

export function createAnalyticsConfig(input = {}) {
  const projectFilters = validateProjectFilters(input.projectFilters);
  const riskThresholds = validateRiskThresholds(input.riskThresholds);
  return {
    projectFilters,
    riskThresholds,
    configVersion: stableVersion(projectFilters),
    policyVersion: stableVersion(riskThresholds)
  };
}

export function migrateStoredConfig(stored = {}) {
  const analytics = createAnalyticsConfig({
    projectFilters: stored.analyticsProjectFilters,
    riskThresholds: stored.analyticsRiskThresholds
  });
  return Object.assign({}, stored, {
    analyticsProjectFilters: cloneFilters(analytics.projectFilters),
    analyticsRiskThresholds: Object.assign({}, analytics.riskThresholds),
    analyticsConfigVersion: analytics.configVersion,
    analyticsPolicyVersion: analytics.policyVersion
  });
}

export function createReportKey(input) {
  if (!input || typeof input !== "object") {
    throw new AnalyticsSchemaError("reportKey", "input must be an object", input);
  }
  const range = normalizeDateRange(input);
  const configVersion = String(input.configVersion || "").trim();
  const policyVersion = String(input.policyVersion || "").trim();
  const departmentId = String(input.departmentId || "").trim();
  if (!configVersion || !policyVersion || !departmentId) {
    throw new AnalyticsSchemaError(
      "reportKey",
      "configVersion, policyVersion and departmentId are required",
      input
    );
  }
  return [configVersion, policyVersion, encodeURIComponent(departmentId), range.startDate, range.endDate].join(":");
}

export function projectMatchesFilters(project, filters) {
  const normalized = validateProjectFilters(filters);
  return FILTER_FIELDS.every(function (field) {
    return normalized[field] === null || normalized[field].includes(project[field]);
  });
}
