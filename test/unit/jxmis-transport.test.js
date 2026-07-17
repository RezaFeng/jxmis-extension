import assert from "node:assert/strict";
import test from "node:test";
import * as transport from "../../src/page/shared/jxmis-transport.js";

function storageWith(value) {
  return {
    getItem: function (key) {
      assert.equal(key, "webapp");
      return value;
    }
  };
}

test("normalizes webapp from storage", function () {
  assert.equal(transport.getWebapp(storageWith(null)), "/jxpmo");
  assert.equal(transport.getWebapp(storageWith("/")), "");
  assert.equal(transport.getWebapp(storageWith("jxpmo/")), "/jxpmo");
  assert.equal(transport.getWebapp(storageWith(" /jxpmo/ ")), "/jxpmo");
});

test("builds base URL from location and webapp", function () {
  assert.equal(
    transport.getBaseUrl({ origin: "https://jxmis.example.com" }, storageWith("jxpmo/")),
    "https://jxmis.example.com/jxpmo"
  );
});

test("creates page messages and merges extra fields", function () {
  const message = transport.createMessage("source-page", "TYPE", "hello", {
    requestId: "REQ-1",
    ok: true
  });

  assert.deepEqual(message, {
    source: "source-page",
    type: "TYPE",
    message: "hello",
    requestId: "REQ-1",
    ok: true
  });
});

test("posts page message to window", function () {
  const calls = [];
  const win = {
    postMessage: function (payload, target) {
      calls.push({ payload: payload, target: target });
    }
  };

  transport.post(win, "source-page", "TYPE", "hello", { requestId: "REQ-1" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, "*");
  assert.deepEqual(calls[0].payload, {
    source: "source-page",
    type: "TYPE",
    message: "hello",
    requestId: "REQ-1"
  });
});

test("assertOk returns ok response", async function () {
  const response = { ok: true };
  assert.equal(await transport.assertOk(response, "fetch thing"), response);
});

test("assertOk includes response details for HTTP errors", async function () {
  const response = {
    ok: false,
    status: 500,
    statusText: "Server Error",
    text: async function () {
      return "boom";
    }
  };

  await assert.rejects(
    transport.assertOk(response, "fetch thing"),
    /fetch thing failed: HTTP 500 Server Error boom/
  );
});

test("fetchJson sends unified GET options and returns JSON", async function () {
  const calls = [];
  const result = await transport.fetchJson(
    async function (url, options) {
      calls.push({ url: url, options: options });
      return {
        ok: true,
        json: async function () {
          return { ok: true };
        }
      };
    },
    "https://jxmis.example.com/rest/test",
    "fetch test"
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, "https://jxmis.example.com/rest/test");
  assert.deepEqual(calls[0].options, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest"
    },
    cache: "no-store"
  });
});

test("fetchJson wraps network errors with label and url", async function () {
  await assert.rejects(
    transport.fetchJson(
      async function () {
        throw new Error("network down");
      },
      "https://jxmis.example.com/rest/test",
      "fetch test"
    ),
    /fetch test failed: network down url=https:\/\/jxmis\.example\.com\/rest\/test/
  );
});

test("randomDelay stays within configured range", function () {
  assert.equal(
    transport.randomDelay({ baseDelayMs: 500, randomDelayMaxMs: 1000 }, function () {
      return 0;
    }),
    500
  );
  assert.equal(
    transport.randomDelay({ baseDelayMs: 500, randomDelayMaxMs: 1000 }, function () {
      return 0.999;
    }),
    1499
  );
});

test("sleep resolves through provided window timer", async function () {
  const calls = [];
  const win = {
    setTimeout: function (resolve, ms) {
      calls.push(ms);
      resolve();
    }
  };

  await transport.sleep(win, 123);
  assert.deepEqual(calls, [123]);
});
