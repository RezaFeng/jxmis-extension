import assert from "node:assert/strict";
import test from "node:test";
import { createOptionsPayload } from "../../src/options/options.js";

test("options preserves AI settings and versions analytics settings", function () {
  const result = createOptionsPayload({
    provider: "openai-compatible",
    baseUrl: " https://ai.example.com/v1 ",
    apiKey: " secret ",
    model: " model-1 ",
    enableThinking: true,
    systemPrompt: "custom",
    projectManager: " PM-1 ",
    analyticsProjectFilters: {
      attribute: null,
      classification: ["Z", "J"],
      currStatus: ["20"],
      outsourcing: null,
      onlyCurrentPeriodInput: false
    },
    analyticsRiskThresholds: {
      lowPerCapita: 300000,
      cpiWarn: 0.85,
      spiWarn: 0.8,
      spiCritical: 0.5,
      budgetExhaustionDays: 90,
      highInputZeroOutputMd: 0.5,
      severeOverrunRatio: 1.15
    }
  });
  assert.equal(result.provider, "openai-compatible");
  assert.equal(result.baseUrl, "https://ai.example.com/v1");
  assert.equal(result.apiKey, "secret");
  assert.equal(result.projectManager, "PM-1");
  assert.deepEqual(result.analyticsProjectFilters.classification, ["J", "Z"]);
  assert.equal(result.analyticsProjectFilters.onlyCurrentPeriodInput, false);
  assert.match(result.analyticsConfigVersion, /^v1-/);
  assert.match(result.analyticsPolicyVersion, /^v1-/);
});

test("options rejects empty selections and invalid threshold ordering", function () {
  assert.throws(function () {
    createOptionsPayload({
      analyticsProjectFilters: {
        attribute: null,
        classification: [],
        currStatus: ["20"],
        outsourcing: null
      },
      analyticsRiskThresholds: { spiWarn: 0.5, spiCritical: 0.8 }
    });
  }, /non-empty array/);
  assert.throws(function () {
    createOptionsPayload({
      analyticsProjectFilters: {
        attribute: null,
        classification: ["J"],
        currStatus: ["20"],
        outsourcing: null
      },
      analyticsRiskThresholds: { spiWarn: 0.5, spiCritical: 0.8 }
    });
  }, /less than spiWarn/);
});
