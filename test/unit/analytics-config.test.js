import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROJECT_FILTERS,
  DEFAULT_RISK_THRESHOLDS,
  createAnalyticsConfig,
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
import {
  normalizeDailyRow,
  normalizeWbsRows
} from "../../src/page/business-analytics/normalizers.js";

test("analytics config applies business defaults", function () {
  const config = createAnalyticsConfig();
  assert.deepEqual(config.projectFilters, {
    attribute: null,
    classification: ["J", "Z"],
    currStatus: ["10", "20", "50"],
    outsourcing: null,
    onlyCurrentPeriodInput: true
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
  assert.throws(
    function () { validateProjectFilters({ onlyCurrentPeriodInput: "true" }); },
    /must be a boolean/
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
  const configC = createAnalyticsConfig({
    projectFilters: {
      classification: ["J", "Z"],
      onlyCurrentPeriodInput: false
    }
  });
  assert.equal(configA.configVersion, configB.configVersion);
  assert.notEqual(configA.configVersion, configC.configVersion);
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
    outsourcing: null,
    onlyCurrentPeriodInput: true
  });
  assert.equal(typeof migrated.analyticsConfigVersion, "string");
  assert.equal(typeof migrated.analyticsPolicyVersion, "string");
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
  assert.equal(project.realWorkload, 0);
  assert.throws(
    function () { normalizeProject({ projectId: 1, projectName: "A", projectDept: 2, realExeuCost: "?" }); },
    /finite number/
  );
  assert.equal(normalizeCalendarDate("2024-02-29"), "2024-02-29");
  assert.throws(function () { normalizeCalendarDate("2023-02-29"); }, /valid calendar date/);
});

test("analytics config falls back to tqSoftAmount for software service revenue", function () {
  const base = { projectId: "P1", projectName: "项目A", projectDept: "D1" };
  assert.equal(normalizeProject(Object.assign({}, base, {
    subcontractAmount: "1,234.50",
    tqSoftAmount: 9999
  })).subcontractAmount, 1234.5);
  assert.equal(normalizeProject(Object.assign({}, base, {
    subcontractAmount: 0,
    tqSoftAmount: 9999
  })).subcontractAmount, 0);
  assert.equal(normalizeProject(Object.assign({}, base, {
    subcontractAmount: " ",
    tqSoftAmount: "-25.5"
  })).subcontractAmount, -25.5);
  assert.equal(normalizeProject(base).subcontractAmount, 0);
  assert.throws(function () {
    normalizeProject(Object.assign({}, base, { subcontractAmount: "未知", tqSoftAmount: 100 }));
  }, /subcontractAmount: must be a finite number/);
  assert.throws(function () {
    normalizeProject(Object.assign({}, base, { subcontractAmount: null, tqSoftAmount: "未知" }));
  }, /tqSoftAmount: must be a finite number/);
});

test("analytics config normalizes successful blank business values as zero", function () {
  const daily = normalizeDailyRow({
    projectId: "P1",
    taskDate: "2026-07-01",
    realHour: null,
    cost: ""
  });
  assert.equal(daily.realHour, 0);
  assert.equal(daily.cost, 0);

  const wbs = normalizeWbsRows([{
    id: "W1",
    costLevel: undefined,
    planEndTime: "2026-07-02"
  }]);
  assert.equal(wbs.length, 1);
  assert.equal(wbs[0].costLevel, 0);
});
