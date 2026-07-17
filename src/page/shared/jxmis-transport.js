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
    return getSameOriginFetchOptions({ cache: "no-store" });
  }

  function getSameOriginFetchOptions(options = {}) {
    const headers = {
      Accept: JSON_ACCEPT,
      "X-Requested-With": "XMLHttpRequest"
    };
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }
    const result = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: headers
    };
    if (options.cache) {
      result.cache = options.cache;
    }
    if (options.body != null) {
      result.body = options.body;
    }
    return result;
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

  async function fetchText(fetchFn, url, label, options) {
    let response;
    try {
      response = await fetchFn(url, getSameOriginFetchOptions(options));
    } catch (error) {
      throw new Error(label + " failed: " + (error && error.message ? error.message : String(error)) + " url=" + url);
    }
    await assertOk(response, label);
    return response.text();
  }

  export {
    createMessage,
    post,
    sleep,
    randomDelay,
    getWebapp,
    getBaseUrl,
    assertOk,
    getSameOriginFetchOptions,
    getJsonFetchOptions,
    fetchJson,
    fetchText
  };
