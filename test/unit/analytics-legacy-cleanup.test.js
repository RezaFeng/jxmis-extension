import assert from "node:assert/strict";
import test from "node:test";
import { cleanupLegacyAnalyticsDatabase } from "../../src/background/business-analytics/legacy-cleanup.js";

test("legacy analytics database cleanup retries naturally after a blocked deletion", async function () {
  const warnings = [];
  const result = cleanupLegacyAnalyticsDatabase({
    deleteDatabase: function (name) {
      assert.equal(name, "cw-business-analytics");
      const request = {};
      queueMicrotask(function () { request.onblocked(); });
      return request;
    }
  }, {
    warn: function (message) { warnings.push(message); }
  });
  assert.deepEqual(await result, { status: "blocked" });
  assert.equal(warnings.length, 1);
});

test("legacy analytics database cleanup does not create a database when unavailable", async function () {
  assert.deepEqual(await cleanupLegacyAnalyticsDatabase(null), { status: "unavailable" });
});
