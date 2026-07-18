import assert from "node:assert/strict";
import test from "node:test";
import { createPageScriptLoader } from "../../src/content/page-script-loader.js";

function createFakeScript() {
  const listeners = {};
  return {
    dataset: {},
    addEventListener: function (type, listener) {
      listeners[type] = listener;
    },
    emit: function (type) {
      listeners[type]();
    }
  };
}

function createFakeDocument() {
  const listeners = {};
  const scripts = [];
  return {
    head: null,
    documentElement: null,
    readyState: "loading",
    scripts: scripts,
    addEventListener: function (type, listener) {
      listeners[type] = listener;
    },
    removeEventListener: function (type, listener) {
      if (listeners[type] === listener) delete listeners[type];
    },
    dispatch: function (type) {
      if (listeners[type]) listeners[type]();
    },
    getElementById: function () { return null; },
    createElement: function () {
      const script = createFakeScript();
      scripts.push(script);
      return script;
    }
  };
}

test("page script waits until the document has an injection host", async function () {
  const document = createFakeDocument();
  const appended = [];
  const loadPageScript = createPageScriptLoader(document, {
    runtime: { getURL: function (fileName) { return "chrome-extension://id/" + fileName; } }
  });

  const loading = loadPageScript("page-script", "page.js");
  await Promise.resolve();
  assert.equal(appended.length, 0);

  document.documentElement = {
    appendChild: function (script) { appended.push(script); }
  };
  document.dispatch("DOMContentLoaded");
  await Promise.resolve();
  assert.equal(appended.length, 1);

  appended[0].emit("load");
  await loading;
  assert.equal(appended[0].dataset.cwLoaded, "true");
});

test("page script keeps a real load failure for the current page", async function () {
  const document = createFakeDocument();
  const appended = [];
  const nodes = new Map();
  document.documentElement = {
    appendChild: function (script) {
      appended.push(script);
      nodes.set(script.id, script);
      script.remove = function () { nodes.delete(script.id); };
    }
  };
  document.getElementById = function (id) { return nodes.get(id) || null; };
  const loadPageScript = createPageScriptLoader(document, {
    runtime: { getURL: function (fileName) { return "chrome-extension://id/" + fileName; } }
  });

  const firstLoad = loadPageScript("page-script", "page.js");
  await Promise.resolve();
  appended[0].emit("error");
  await assert.rejects(firstLoad, /load page script failed: page\.js/);

  await assert.rejects(
    loadPageScript("page-script", "page.js"),
    /load page script failed: page\.js/
  );
  assert.equal(appended.length, 1);
  assert.equal(document.getElementById("page-script"), null);
});

test("concurrent page script requests share one load", async function () {
  const document = createFakeDocument();
  const appended = [];
  document.documentElement = {
    appendChild: function (script) { appended.push(script); }
  };
  const loadPageScript = createPageScriptLoader(document, {
    runtime: { getURL: function (fileName) { return "chrome-extension://id/" + fileName; } }
  });

  const firstLoad = loadPageScript("page-script", "page.js");
  const secondLoad = loadPageScript("page-script", "page.js");
  assert.equal(firstLoad, secondLoad);

  await Promise.resolve();
  assert.equal(appended.length, 1);
  appended[0].emit("load");
  await Promise.all([firstLoad, secondLoad]);
});
