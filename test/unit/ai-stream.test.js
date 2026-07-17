import assert from "node:assert/strict";
import test from "node:test";
import { AI_PORT_TYPES } from "../../src/shared/protocol.js";
import { createStreamState, readStreamLine } from "../../src/background/ai-stream.js";

function createPort() {
  const messages = [];
  return {
    messages: messages,
    postMessage: function (message) { messages.push(message); }
  };
}

test("parses reasoning and text SSE events", function () {
  const port = createPort();
  const state = createStreamState("request-1");

  readStreamLine('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}', port, state);
  readStreamLine('data: {"choices":[{"delta":{"content":"answer"}}]}', port, state);

  assert.equal(state.reasoningChunkCount, 1);
  assert.equal(state.textChunkCount, 1);
  assert.equal(port.messages.some(function (message) {
    return message.type === AI_PORT_TYPES.REASONING && message.text === "think";
  }), true);
  assert.equal(port.messages.some(function (message) {
    return message.type === AI_PORT_TYPES.CHUNK && message.text === "answer";
  }), true);
});

test("recognizes done and warns for malformed SSE", function () {
  const port = createPort();
  const warnings = [];
  const state = createStreamState("request-1");
  const logger = { warn: function (message) { warnings.push(message); } };

  assert.equal(readStreamLine("data: [DONE]", port, state, logger), true);
  assert.equal(readStreamLine("data: {bad", port, state, logger), false);
  assert.equal(warnings.length, 1);
  assert.equal(port.messages.at(-1).type, AI_PORT_TYPES.WARNING);
});
