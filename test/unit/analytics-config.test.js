import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROJECT_FILTERS,
  DEFAULT_RISK_THRESHOLDS,
  createAnalyticsConfig,
  createReportKey,
  migrateStoredConfig,
  projectMatchesFilters,
  stableVersion,
  validateProjectFilters,
  validateRiskThresholds
} from "../../src/analytics/config.js";
import {
  AnalyticsSchemaError,
  normalizeCalendarDate,
  normalizeProject
} from "../../src/analytics/domain.js";

test("analytics config applies business defaults", function () {
  const config = createAnalyticsConfig();
  assert.deepEqual(config.projectFilters, {
    attribute: null,
    classification: ["J", "Z"],
    currStatus: ["10", "20", "50"],
    outsourcing: null
  });
  assert.deepEqual(config.riskThresholds, DEFAULT_RISK_THRESHOLDS);
  assert.match(config.configVersion, /^v1-[0-9a-f]{16}$/);
  assert.match(config.policyVersion, /^v1-[0-9a-f]{16}$/);
});

test("analytics config treats unrestricted dimensions and unknown project values correctly", function () {
  const filters = validateProjectFilters(DEFAULT_PROJECT_FILTERS);
  assert.equal(projectMatchesFilters({
    attribute: "FUTURE",
    classification: "J",
    currStatus: "20",
    outsourcing: null
  }, filters), true);
  assert.equal(projectMatchesFilters({
    attribute: "C",
    classification: "R",
    currStatus: "20",
    outsourcing: "01"
  }, filters), false);
  assert.throws(
    function () { validateProjectFilters({ classification: ["FUTURE"] }); },
    AnalyticsSchemaError
  );
  assert.throws(
    function () { validateProjectFilters({ classification: [] }); },
    /non-empty array/
  );
});

test("analytics config validates thresholds", function () {
  assert.throws(
    function () { validateRiskThresholds({ spiCritical: 0.9, spiWarn: 0.8 }); },
    /less than spiWarn/
  );
  assert.throws(
    function () { validateRiskThresholds({ budgetExhaustionDays: 1.5 }); },
    /positive integer/
  );
  assert.throws(
    function () { validateRiskThresholds({ severeOverrunRatio: 1 }); },
    /> 1/
  );
});

test("analytics config versions are stable across object and selection order", function () {
  const first = stableVersion({ b: 2, a: ["Z", "J"] });
  const second = stableVersion({ a: ["Z", "J"], b: 2 });
  assert.equal(first, second);

  const configA = createAnalyticsConfig({
    projectFilters: { classification: ["Z", "J"] }
  });
  const configB = createAnalyticsConfig({
    projectFilters: { classification: ["J", "Z"] }
  });
  assert.equal(configA.configVersion, configB.configVersion);
});

test("analytics config migrates legacy storage without losing AI settings", function () {
  const legacy = {
    provider: "openai",
    baseUrl: "https://ai.example.com/v1",
    apiKey: "secret",
    model: "model-1",
    enableThinking: true,
    systemPrompt: "custom",
    projectManager: "PM-7"
  };
  const migrated = migrateStoredConfig(legacy);
  Object.entries(legacy).forEach(function ([key, value]) {
    assert.equal(migrated[key], value);
  });
  assert.deepEqual(migrated.analyticsProjectFilters, {
    attribute: null,
    classification: ["J", "Z"],
    currStatus: ["10", "20", "50"],
    outsourcing: null
  });
  assert.equal(typeof migrated.analyticsConfigVersion, "string");
  assert.equal(typeof migrated.analyticsPolicyVersion, "string");
});

test("analytics config creates the specified report identity", function () {
  assert.equal(createReportKey({
    configVersion: "config-v1",
    policyVersion: "policy-v2",
    departmentId: "D:10",
    startDate: "2026-07-06",
    endDate: "2026-07-12"
  }), "config-v1:policy-v2:D%3A10:2026-07-06:2026-07-12");
});

test("analytics config normalizes project values without discarding future enums", function () {
  const project = normalizeProject({
    projectId: 12,
    projectName: "项目A",
    projectDept: 100,
    classification: "FUTURE",
    subcontractAmount: "1,234.50",
    estiExeuCost: 800,
    realExeuCost: "400",
    planCompleteSchedule: 50
  });
  assert.equal(project.projectId, "12");
  assert.equal(project.projectDept, "100");
  assert.equal(project.classification, "FUTURE");
  assert.equal(project.subcontractAmount, 1234.5);
  assert.equal(project.realWorkload, null);
  assert.throws(
    function () { normalizeProject({ projectId: 1, projectName: "A", projectDept: 2, realExeuCost: "?" }); },
    /finite number/
  );
  assert.equal(normalizeCalendarDate("2024-02-29"), "2024-02-29");
  assert.throws(function () { normalizeCalendarDate("2023-02-29"); }, /valid calendar date/);
});
