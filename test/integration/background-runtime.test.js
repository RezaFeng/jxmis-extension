import assert from "node:assert/strict";
import test from "node:test";
import { registerBackgroundRuntime } from "../../src/background/runtime.js";
import { AI_PORT_TYPES, MESSAGE_TYPES } from "../../src/shared/protocol.js";

function createEvent() {
  const listeners = [];
  return {
    addListener: function (listener) { listeners.push(listener); },
    first: function () { return listeners[0]; }
  };
}

function createChrome() {
  const values = {
    baseUrl: "https://ai.example.com/v1",
    apiKey: "secret",
    model: "model-1",
    provider: "deepseek",
    enableThinking: false,
    systemPrompt: "system"
  };
  return {
    values: values,
    runtime: {
      onMessage: createEvent(),
      onConnect: createEvent(),
      openOptionsPage: function () { this.optionsOpened = true; }
    },
    action: { onClicked: createEvent() },
    storage: {
      local: {
        get: function (keys, callback) {
          if (Array.isArray(keys)) {
            const result = {};
            keys.forEach(function (key) { result[key] = values[key]; });
            callback(result);
            return;
          }
          callback(Object.assign({}, keys, values));
        },
        set: function (data, callback) {
          Object.assign(values, data);
          callback();
        }
      }
    }
  };
}

function sendRuntimeMessage(chrome, message) {
  return new Promise(function (resolve) {
    const keepOpen = chrome.runtime.onMessage.first()(message, {}, resolve);
    assert.equal(keepOpen, true);
  });
}

test("background runtime handles model and cache messages", async function () {
  const chrome = createChrome();
  const runtime = registerBackgroundRuntime({
    chrome: chrome,
    fetch: async function (url) {
      assert.equal(url, "https://ai.example.com/v1/models");
      return {
        ok: true,
        json: async function () { return { data: [{ id: "b" }, { id: "a" }, { id: "a" }] }; }
      };
    }
  });

  const models = await sendRuntimeMessage(chrome, { type: MESSAGE_TYPES.AI_FETCH_MODELS });
  const cacheSet = await sendRuntimeMessage(chrome, {
    type: MESSAGE_TYPES.CACHE_SET,
    key: "WK-1",
    value: { summary: "text" }
  });
  const cacheGet = await sendRuntimeMessage(chrome, {
    type: MESSAGE_TYPES.CACHE_GET,
    key: "WK-1"
  });

  assert.deepEqual(models, { ok: true, models: ["a", "b"] });
  assert.deepEqual(cacheSet, { ok: true });
  assert.deepEqual(cacheGet, { ok: true, cache: { summary: "text" } });
  assert.ok(runtime.aiClient);
  chrome.action.onClicked.first()();
  assert.equal(chrome.runtime.optionsOpened, true);
});

test("background port returns stream content and done", async function () {
  const chrome = createChrome();
  registerBackgroundRuntime({
    chrome: chrome,
    fetch: async function () {
      return {
        ok: true,
        status: 200,
        body: null,
        json: async function () {
          return { choices: [{ message: { content: "summary" } }] };
        }
      };
    }
  });
  const port = {
    name: "cw-ai-summary",
    sent: [],
    onMessage: createEvent(),
    onDisconnect: createEvent(),
    postMessage: function (message) { this.sent.push(message); }
  };
  chrome.runtime.onConnect.first()(port);
  port.onMessage.first()({
    type: AI_PORT_TYPES.START,
    requestId: "request-1",
    userPrompt: "tasks"
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  assert.equal(port.sent.some(function (message) {
    return message.type === AI_PORT_TYPES.CHUNK && message.text === "summary";
  }), true);
  assert.equal(port.sent.at(-1).type, AI_PORT_TYPES.DONE);
});
