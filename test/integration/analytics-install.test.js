import assert from "node:assert/strict";
import test from "node:test";
import { installBusinessAnalyticsPage } from "../../src/page/business-analytics/install.js";
import { MESSAGE_TYPES, SOURCES, createRequestMessage } from "../../src/shared/protocol.js";

test("data diagnostics retry routes only failed analytics descriptors", async function () {
  let listener;
  const posted = [];
  const windowRef = {
    addEventListener: function (_type, value) { listener = value; },
    removeEventListener: function () {},
    postMessage: function (message) { posted.push(message); }
  };
  const previous = { failedRequests: [{ source: "wbs", projectId: "P1" }] };
  let retried;
  installBusinessAnalyticsPage({
    window: windowRef,
    collector: {
      collect: function () { throw new Error("full collection must not run"); },
      retryFailed: async function (request, value) {
        retried = { request, value };
        return { complete: true, projects: [] };
      },
      cancel: function () {}
    }
  });

  listener({
    source: windowRef,
    data: createRequestMessage(SOURCES.ANALYTICS_CONTENT, MESSAGE_TYPES.ANALYTICS_REQUEST, "R2", {
      retryFailed: true,
      previous
    })
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  assert.equal(retried.request.requestId, "R2");
  assert.equal(retried.value, previous);
  assert.equal(posted.at(-1).type, MESSAGE_TYPES.ANALYTICS_RESULT);
});
