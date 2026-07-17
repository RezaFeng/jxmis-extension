import assert from "node:assert/strict";
import test from "node:test";
import * as aiRequests from "../../src/shared/ai-request-body.js";

function createBody(overrides) {
  return aiRequests.createChatRequestBody(
    Object.assign(
      {
        provider: "deepseek",
        model: "test-model",
        enableThinking: false,
        systemPrompt: "system",
        userPrompt: "user"
      },
      overrides || {}
    )
  );
}

test("defaults unknown provider to DeepSeek thinking format", function () {
  const body = createBody({ provider: "unknown" });

  assert.equal(aiRequests.normalizeProvider("unknown"), "deepseek");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning_effort, undefined);
});

test("creates DeepSeek thinking parameters", function () {
  assert.deepEqual(createBody({ enableThinking: false }).thinking, { type: "disabled" });

  const enabled = createBody({ enableThinking: true });
  assert.deepEqual(enabled.thinking, { type: "enabled" });
  assert.equal(enabled.reasoning_effort, "high");
});

test("creates ModelScope chat template thinking parameters", function () {
  assert.deepEqual(createBody({ provider: "modelscope", enableThinking: false }).chat_template_kwargs, {
    enable_thinking: false
  });

  assert.deepEqual(createBody({ provider: "modelscope", enableThinking: true }).chat_template_kwargs, {
    enable_thinking: true
  });
});

test("creates OpenAI-compatible reasoning effort parameters", function () {
  assert.equal(createBody({ provider: "openai-compatible", enableThinking: false }).reasoning_effort, "none");
  assert.equal(createBody({ provider: "openai-compatible", enableThinking: true }).reasoning_effort, "high");
});

test("keeps common chat request body fields", function () {
  const body = createBody();

  assert.equal(body.model, "test-model");
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [
    {
      role: "system",
      content: "system"
    },
    {
      role: "user",
      content: "user"
    }
  ]);
});
