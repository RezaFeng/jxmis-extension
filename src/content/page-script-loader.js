export function createPageScriptLoader(document, chrome) {
  const scriptLoads = new Map();

  function getInjectionHost() {
    return document.head || document.documentElement;
  }

  function createLoadError(fileName) {
    return new Error("load page script failed: " + fileName);
  }

  function waitForInjectionHost() {
    const host = getInjectionHost();
    if (host) {
      return Promise.resolve(host);
    }

    return new Promise(function (resolve, reject) {
      function cleanup() {
        document.removeEventListener("readystatechange", handleDocumentReady);
        document.removeEventListener("DOMContentLoaded", handleDocumentReady);
      }

      function handleDocumentReady() {
        const readyHost = getInjectionHost();
        if (readyHost) {
          cleanup();
          resolve(readyHost);
          return;
        }
        if (document.readyState !== "loading") {
          cleanup();
          reject(new Error("page script injection host is unavailable"));
        }
      }

      document.addEventListener("readystatechange", handleDocumentReady);
      document.addEventListener("DOMContentLoaded", handleDocumentReady);
      handleDocumentReady();
    });
  }

  function loadScript(id, fileName, host) {
    return new Promise(function (resolve, reject) {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.cwLoaded === "true") {
          resolve();
          return;
        }
        if (existing.dataset.cwLoading === "true") {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", function () {
            reject(createLoadError(fileName));
          }, { once: true });
          return;
        }
        reject(createLoadError(fileName));
        return;
      }

      const script = document.createElement("script");
      script.id = id;
      script.src = chrome.runtime.getURL(fileName);
      script.async = false;
      script.dataset.cwLoading = "true";
      script.addEventListener("load", function () {
        script.dataset.cwLoading = "false";
        script.dataset.cwLoaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", function () {
        script.dataset.cwLoading = "false";
        script.dataset.cwLoaded = "false";
        script.remove();
        reject(createLoadError(fileName));
      }, { once: true });
      host.appendChild(script);
    });
  }

  return function injectPageScript(id, fileName) {
    if (scriptLoads.has(id)) {
      return scriptLoads.get(id);
    }
    const loading = waitForInjectionHost().then(function (host) {
      return loadScript(id, fileName, host);
    });
    scriptLoads.set(id, loading);
    return loading;
  };
}
