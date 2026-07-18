import assert from "node:assert/strict";
import test from "node:test";
import { createAiBridge } from "../../src/content/ai-bridge.js";
import { startContentRuntime } from "../../src/content/runtime.js";
import { AI_PORT_TYPES, MESSAGE_TYPES } from "../../src/shared/protocol.js";

function createEvent() {
  const listeners = [];
  return {
    addListener: function (listener) { listeners.push(listener); },
    emit: function (value) { listeners.forEach(function (listener) { listener(value); }); }
  };
}

function createPort() {
  const onMessage = createEvent();
  const onDisconnect = createEvent();
  return {
    name: "cw-ai-summary",
    onMessage: onMessage,
    onDisconnect: onDisconnect,
    sent: [],
    disconnected: false,
    postMessage: function (message) { this.sent.push(message); },
    disconnect: function () {
      this.disconnected = true;
      onDisconnect.emit();
    }
  };
}

test("AI bridge forwards lifecycle events and ignores stale ports", function () {
  const ports = [];
  const pageMessages = [];
  const bridge = createAiBridge({
    chrome: {
      runtime: {
        connect: function () {
          const port = createPort();
          ports.push(port);
          return port;
        }
      }
    },
    postToPage: function (message) { pageMessages.push(message); },
    logger: { warn: function () {} }
  });

  bridge.start({ requestId: "request-1", userPrompt: "first" });
  bridge.start({ requestId: "request-2", userPrompt: "second" });
  ports[0].onMessage.emit({ type: AI_PORT_TYPES.CHUNK, text: "stale" });
  ports[1].onMessage.emit({ type: AI_PORT_TYPES.CHUNK, text: "current" });
  ports[1].onMessage.emit({ type: AI_PORT_TYPES.DONE });

  assert.equal(ports[0].disconnected, true);
  assert.equal(pageMessages.some(function (message) { return message.text === "stale"; }), false);
  assert.equal(pageMessages.some(function (message) {
    return message.type === MESSAGE_TYPES.AI_CHUNK && message.text === "current";
  }), true);
  assert.equal(pageMessages.at(-1).type, MESSAGE_TYPES.AI_DONE);
});

test("content runtime starts without matching a page and posts initial manager config", function () {
  const posted = [];
  const windowListeners = {};
  const windowRef = {
    location: { href: "https://jxmis.cyberwing.cn/jxpmo/index/frame", hash: "" },
    postMessage: function (message) { posted.push(message); },
    addEventListener: function (type, listener) { windowListeners[type] = listener; },
    setTimeout: function () {},
    top: null,
    self: null
  };
  windowRef.top = windowRef;
  windowRef.self = windowRef;
  const document = {
    documentElement: {},
    getElementById: function () { return null; },
    querySelector: function () { return null; }
  };
  const storageChanged = createEvent();
  const chrome = {
    runtime: {
      getURL: function (fileName) { return "chrome-extension://id/" + fileName; },
      sendMessage: function () {},
      connect: function () { return createPort(); }
    },
    storage: {
      local: {
        get: function (_defaults, callback) { callback({ projectManager: "PM-1" }); }
      },
      onChanged: storageChanged
    }
  };
  class FakeMutationObserver {
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }

  const runtime = startContentRuntime({
    window: windowRef,
    document: document,
    chrome: chrome,
    MutationObserver: FakeMutationObserver
  });

  assert.ok(runtime);
  assert.equal(posted[0].type, MESSAGE_TYPES.PROJECT_MANAGER_CONFIG);
  assert.equal(posted[0].projectManager, "PM-1");
  assert.equal(typeof windowListeners.message, "function");
  assert.equal(typeof windowListeners.hashchange, "function");
});

test("business analytics content loads once on the specified project home page", async function () {
  const loaded = [];
  let ensured = 0;
  const listeners = {};
  const windowRef = {
    location: {
      href: "https://jxmis.cyberwing.cn/jxpmo/index/frame",
      hash: "#!/jxpmo/project/ProjectInfoService/projectinDedaultHomePage"
    },
    addEventListener: function (type, listener) { listeners[type] = listener; },
    postMessage: function () {},
    top: null,
    self: null
  };
  windowRef.top = windowRef;
  windowRef.self = windowRef;
  const controller = {
    ensureNavigation: function () { ensured += 1; },
    syncLocation: function () {}
  };
  class Observer { observe() {} }
  const runtime = startContentRuntime({
    window: windowRef,
    document: {
      documentElement: {},
      getElementById: function () { return null; },
      querySelector: function () { return null; }
    },
    chrome: {
      runtime: { sendMessage: function () {}, connect: function () { return createPort(); } },
      storage: {
        local: { get: function (_defaults, callback) { callback({ projectManager: "" }); } },
        onChanged: createEvent()
      }
    },
    MutationObserver: Observer,
    businessAnalyticsController: controller,
    pageScriptLoader: async function (id, fileName) { loaded.push({ id, fileName }); }
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  runtime.ensureAutomation();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.deepEqual(loaded, [{
    id: "cw-business-analytics-page-script",
    fileName: "page-business-analytics.js"
  }]);
  assert.ok(ensured >= 1);
  assert.equal(typeof listeners.hashchange, "function");
});
