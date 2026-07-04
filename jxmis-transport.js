(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.CwJxmisTransport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";

  function createMessage(sourcePage, type, message, extra) {
    return Object.assign(
      {
        source: sourcePage,
        type: type,
        message: message
      },
      extra || {}
    );
  }

  function post(win, sourcePage, type, message, extra) {
    win.postMessage(createMessage(sourcePage, type, message, extra), "*");
  }

  function sleep(win, ms) {
    return new Promise(function (resolve) {
      win.setTimeout(resolve, ms);
    });
  }

  function randomDelay(config, randomFn) {
    const random = randomFn || Math.random;
    return config.baseDelayMs + Math.floor(random() * config.randomDelayMaxMs);
  }

  function getWebapp(storage) {
    const raw = String((storage && storage.getItem("webapp")) || "/jxpmo").trim();
    if (!raw || raw === "/") {
      return "";
    }
    return raw.charAt(0) === "/" ? raw.replace(/\/+$/, "") : "/" + raw.replace(/\/+$/, "");
  }

  function getBaseUrl(location, storage) {
    return location.origin + getWebapp(storage);
  }

  async function assertOk(response, label) {
    if (response.ok) {
      return response;
    }
    const text = await response.text().catch(function () {
      return "";
    });
    throw new Error(label + " failed: HTTP " + response.status + " " + response.statusText + " " + text);
  }

  function getJsonFetchOptions() {
    return {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: JSON_ACCEPT,
        "X-Requested-With": "XMLHttpRequest"
      },
      cache: "no-store"
    };
  }

  async function fetchJson(fetchFn, url, label) {
    let response;
    try {
      response = await fetchFn(url, getJsonFetchOptions());
    } catch (error) {
      throw new Error(label + " failed: " + (error && error.message ? error.message : String(error)) + " url=" + url);
    }
    await assertOk(response, label);
    return response.json();
  }

  return {
    createMessage: createMessage,
    post: post,
    sleep: sleep,
    randomDelay: randomDelay,
    getWebapp: getWebapp,
    getBaseUrl: getBaseUrl,
    assertOk: assertOk,
    getJsonFetchOptions: getJsonFetchOptions,
    fetchJson: fetchJson
  };
});
