import assert from "node:assert/strict";
import test from "node:test";
import * as weeklyDetail from "../../src/page/shared/weekly-detail.js";

test("normalizes first item from array payload", function () {
  assert.deepEqual(weeklyDetail.normalizeWeeklyDetail([{ id: "wk-1" }]), { id: "wk-1" });
  assert.equal(weeklyDetail.normalizeWeeklyDetail([]), null);
});

test("normalizes first row from rows payload", function () {
  assert.deepEqual(weeklyDetail.normalizeWeeklyDetail({ rows: [{ id: "wk-2" }] }), {
    id: "wk-2"
  });
  assert.equal(weeklyDetail.normalizeWeeklyDetail({ rows: [] }), null);
});

test("normalizes array and object data payloads", function () {
  assert.deepEqual(weeklyDetail.normalizeWeeklyDetail({ data: [{ id: "wk-3" }] }), {
    id: "wk-3"
  });
  assert.deepEqual(weeklyDetail.normalizeWeeklyDetail({ data: { id: "wk-4" } }), {
    id: "wk-4"
  });
});

test("normalizes result object payload", function () {
  assert.deepEqual(weeklyDetail.normalizeWeeklyDetail({ result: { id: "wk-5" } }), {
    id: "wk-5"
  });
});

test("falls back to raw payload or null", function () {
  assert.deepEqual(weeklyDetail.normalizeWeeklyDetail({ id: "wk-6" }), { id: "wk-6" });
  assert.equal(weeklyDetail.normalizeWeeklyDetail(null), null);
  assert.equal(weeklyDetail.normalizeWeeklyDetail(undefined), null);
});
