import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalyticsRepository,
  createMemoryAnalyticsAdapter
} from "../../src/background/business-analytics/repository.js";

function createRepository(options = {}) {
  const adapter = createMemoryAnalyticsAdapter(options.initial);
  const repository = createAnalyticsRepository(null, {
    adapter,
    now: function () { return new Date(options.now || "2026-07-18T00:00:00.000Z"); }
  });
  return { adapter, repository };
}

test("analytics repository migrates idempotently", async function () {
  const { adapter, repository } = createRepository({ initial: { version: 0 } });
  await repository.initialize();
  await repository.initialize();
  assert.equal(adapter.inspect().version, 1);
  assert.deepEqual([...adapter.inspect().stores.keys()].sort(), [
    "failedRequests", "metadata", "metricHistory", "queryCache", "reportSnapshots"
  ]);
});

test("analytics repository saves only complete snapshots and returns latest", async function () {
  const { repository } = createRepository();
  await assert.rejects(repository.saveComplete({ reportKey: "R1", complete: false }), /complete snapshot/);
  await repository.saveComplete({ reportKey: "R1", complete: true, capturedAt: "2026-07-17T00:00:00Z" });
  await repository.saveComplete({ reportKey: "R1", complete: true, capturedAt: "2026-07-18T00:00:00Z" });
  assert.equal((await repository.getLatest("R1")).capturedAt, "2026-07-18T00:00:00Z");
});

test("analytics repository stores metric history and caps each scope at 104 periods", async function () {
  const { adapter, repository } = createRepository();
  for (let index = 0; index < 106; index += 1) {
    const day = String(index + 1).padStart(3, "0");
    await repository.saveComplete({
      reportKey: "R" + index,
      complete: true,
      capturedAt: "2026-07-18T00:00:00Z",
      departmentId: "D1",
      configVersion: "C1",
      policyVersion: "P1",
      startDate: "2026-01-01",
      endDate: "2026-" + day,
      metrics: { projectCount: index }
    });
  }
  await repository.cleanup();
  assert.equal(adapter.inspect().stores.get("metricHistory").size, 104);
});

test("analytics repository cleans expired and excess query combinations", async function () {
  const { adapter, repository } = createRepository();
  await repository.saveQueryCache({ reportKey: "expired", queryKey: "expired", capturedAt: "2026-06-01T00:00:00Z" });
  for (let index = 0; index < 21; index += 1) {
    await repository.saveQueryCache({
      reportKey: "R" + index,
      queryKey: "Q" + index,
      capturedAt: "2026-07-" + String(index + 1).padStart(2, "0") + "T00:00:00Z"
    });
  }
  const result = await repository.cleanup();
  assert.equal(result.removedCache, 2);
  assert.equal(adapter.inspect().stores.get("queryCache").size, 20);
});

test("analytics repository keeps retry descriptors free of credentials", async function () {
  const { repository } = createRepository();
  await repository.saveFailedRequests("R1", [{ source: "wbs", projectId: "P1" }]);
  assert.deepEqual(await repository.retryDescriptor("R1"), [{ source: "wbs", projectId: "P1" }]);
  await assert.rejects(
    repository.saveFailedRequests("R2", [{ headers: { Cookie: "secret" } }]),
    /forbidden authentication data/
  );
});

test("analytics repository clears cache and history independently", async function () {
  const { repository } = createRepository();
  await repository.saveQueryCache({ reportKey: "R1", capturedAt: "2026-07-18T00:00:00Z" });
  await repository.saveComplete({ reportKey: "R1", complete: true, capturedAt: "2026-07-18T00:00:00Z" });
  await repository.clearQueryCache();
  assert.equal((await repository.getStats()).queryCache.count, 0);
  assert.ok(await repository.getLatest("R1"));
  await repository.clearHistory();
  assert.equal(await repository.getLatest("R1"), null);
});
