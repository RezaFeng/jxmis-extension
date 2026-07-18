import assert from "node:assert/strict";
import test from "node:test";
import * as protocol from "../../src/shared/protocol.js";

test("creates known messages without allowing source or type overrides", function () {
  const message = protocol.createMessage(
    protocol.SOURCES.WORK_PAGE,
    protocol.MESSAGE_TYPES.WORK_RUNNING,
    {
      source: "wrong",
      type: "wrong",
      message: "running",
      extra: 1
    }
  );

  assert.deepEqual(message, {
    source: protocol.SOURCES.WORK_PAGE,
    type: protocol.MESSAGE_TYPES.WORK_RUNNING,
    message: "running",
    extra: 1
  });
});

test("requires request ids for request-response message types", function () {
  const missing = protocol.parseMessage({
    source: protocol.SOURCES.WORK_PAGE,
    type: protocol.MESSAGE_TYPES.AI_REQUEST,
    userPrompt: "summary"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "requestId is required");

  const message = protocol.createRequestMessage(
    protocol.SOURCES.WORK_PAGE,
    protocol.MESSAGE_TYPES.AI_REQUEST,
    "request-1",
    { userPrompt: "summary" }
  );
  assert.equal(protocol.parseMessage(message).ok, true);
  assert.equal(protocol.parseMessage({
    source: protocol.SOURCES.ANALYTICS_CONTENT,
    type: protocol.MESSAGE_TYPES.ANALYTICS_GET_LATEST,
    reportKey: "R1"
  }).ok, false);
});

test("rejects wrong sources, types, and window senders", function () {
  const message = protocol.createMessage(
    protocol.SOURCES.DAILY_PAGE,
    protocol.MESSAGE_TYPES.DAILY_DONE,
    { message: "done" }
  );

  assert.equal(
    protocol.parseMessage(message, { source: protocol.SOURCES.WEEKLY_PAGE }).ok,
    false
  );
  assert.equal(
    protocol.parseMessage(message, { types: [protocol.MESSAGE_TYPES.DAILY_ERROR] }).ok,
    false
  );
  assert.equal(
    protocol.parseWindowMessage(
      { source: {}, data: message },
      { windowRef: {}, source: protocol.SOURCES.DAILY_PAGE }
    ).ok,
    false
  );
  assert.equal(protocol.parseMessage({ source: "unknown", type: "unknown" }).ok, false);
});

test("validates AI port lifecycle events", function () {
  assert.equal(
    protocol.parseAiPortEvent({
      type: protocol.AI_PORT_TYPES.START,
      requestId: "request-1",
      userPrompt: "summary"
    }).ok,
    true
  );
  assert.equal(
    protocol.parseAiPortEvent({ type: protocol.AI_PORT_TYPES.CHUNK, text: "part" }).ok,
    true
  );
  assert.equal(protocol.parseAiPortEvent({ type: "unknown" }).ok, false);
  assert.equal(protocol.parseAiPortEvent({ type: protocol.AI_PORT_TYPES.CHUNK }).ok, false);
  assert.equal(
    protocol.parseAiPortEvent({ type: protocol.AI_PORT_TYPES.ERROR, message: 500 }).ok,
    false
  );
});

test("creates cache results with stable response types", function () {
  const result = protocol.createCacheResult(
    protocol.SOURCES.WORK_CONTENT,
    protocol.MESSAGE_TYPES.CACHE_GET,
    "cache-1",
    { ok: true, cache: { summary: "text" } }
  );

  assert.deepEqual(result, {
    source: protocol.SOURCES.WORK_CONTENT,
    type: protocol.MESSAGE_TYPES.CACHE_GET_RESULT,
    requestId: "cache-1",
    ok: true,
    cache: { summary: "text" },
    error: undefined
  });
  assert.equal(protocol.parseMessage(result).ok, true);
  assert.throws(function () {
    protocol.getCacheResultType(protocol.MESSAGE_TYPES.WORK_START);
  }, /not a cache request type/);
});
