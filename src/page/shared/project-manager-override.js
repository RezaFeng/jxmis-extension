  const CONFIG_SOURCE = "cw-project-manager-config";
  const CONFIG_TYPE = "CW_PROJECT_MANAGER_OVERRIDE_CONFIG";
  const PARAM_NAME = "projectManager";

  function normalizeProjectManager(value) {
    return String(value || "").trim();
  }

  function getLocation(win) {
    return (win && win.location) || (typeof location !== "undefined" ? location : null);
  }

  function getTargetUrl(value, win) {
    const currentLocation = getLocation(win);
    if (!currentLocation || !currentLocation.href) {
      return null;
    }

    try {
      return new URL(String(value), currentLocation.href);
    } catch (error) {
      return null;
    }
  }

  function isJxmisUrl(url, win) {
    const currentLocation = getLocation(win);
    if (!url || !currentLocation) {
      return false;
    }
    return url.origin === currentLocation.origin && /^\/jxpmo(?:\/|$)/.test(url.pathname);
  }

  function rewriteUrlValue(value, projectManager, win) {
    const overrideValue = normalizeProjectManager(projectManager);
    if (!overrideValue) {
      return value;
    }

    const url = getTargetUrl(value, win);
    if (!isJxmisUrl(url, win) || !url.searchParams.has(PARAM_NAME)) {
      return value;
    }

    url.searchParams.set(PARAM_NAME, overrideValue);
    if (/^[a-z][a-z0-9+.-]*:/i.test(String(value))) {
      return url.toString();
    }
    return url.pathname + url.search + url.hash;
  }

  function hasOwnProjectManager(value) {
    return Object.prototype.hasOwnProperty.call(value, PARAM_NAME);
  }

  function rewriteJsonValue(value, projectManager) {
    if (Array.isArray(value)) {
      let changed = false;
      const nextArray = value.map(function (item) {
        if (item && typeof item === "object" && !Array.isArray(item) && hasOwnProjectManager(item)) {
          changed = true;
          return Object.assign({}, item, {
            projectManager: projectManager
          });
        }
        return item;
      });
      return changed ? nextArray : value;
    }

    if (value && typeof value === "object" && hasOwnProjectManager(value)) {
      return Object.assign({}, value, {
        projectManager: projectManager
      });
    }

    return value;
  }

  function rewriteStringBody(body, projectManager) {
    if (body.indexOf(PARAM_NAME) < 0) {
      return body;
    }

    const trimmed = body.trim();
    if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
      try {
        const json = JSON.parse(body);
        const rewrittenJson = rewriteJsonValue(json, projectManager);
        return rewrittenJson === json ? body : JSON.stringify(rewrittenJson);
      } catch (error) {
        return body;
      }
    }

    try {
      const params = new URLSearchParams(body);
      if (!params.has(PARAM_NAME)) {
        return body;
      }
      params.set(PARAM_NAME, projectManager);
      return params.toString();
    } catch (error) {
      return body;
    }
  }

  function rewriteBody(body, projectManager) {
    const overrideValue = normalizeProjectManager(projectManager);
    if (!overrideValue || body == null) {
      return body;
    }

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      if (!body.has(PARAM_NAME)) {
        return body;
      }
      const params = new URLSearchParams(body);
      params.set(PARAM_NAME, overrideValue);
      return params;
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      if (!body.has(PARAM_NAME)) {
        return body;
      }
      const formData = new FormData();
      body.forEach(function (value, key) {
        formData.append(key, key === PARAM_NAME ? overrideValue : value);
      });
      return formData;
    }

    if (typeof body === "string") {
      return rewriteStringBody(body, overrideValue);
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return body;
    }

    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      return body;
    }

    if (body && typeof body === "object") {
      const rewrittenJson = rewriteJsonValue(body, overrideValue);
      return rewrittenJson === body ? body : JSON.stringify(rewrittenJson);
    }

    return body;
  }

  function getFetchUrl(input) {
    return input && typeof input === "object" && typeof input.url === "string" ? input.url : input;
  }

  function cloneRequestInit(request) {
    return {
      method: request.method,
      headers: request.headers,
      mode: request.mode,
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
      signal: request.signal
    };
  }

  function rewriteFetchArgs(input, init, projectManager, win) {
    const overrideValue = normalizeProjectManager(projectManager);
    if (!overrideValue) {
      return [input, init];
    }

    const originalUrl = getFetchUrl(input);
    const rewrittenUrl = rewriteUrlValue(originalUrl, overrideValue, win);
    const method = String(
      (init && init.method) ||
        (input && typeof input === "object" && input.method) ||
        "GET"
    ).toUpperCase();

    let nextInput = input;
    let nextInit = init;
    if (rewrittenUrl !== originalUrl) {
      if (input && typeof Request !== "undefined" && input instanceof Request) {
        nextInput = rewrittenUrl;
        nextInit = Object.assign(cloneRequestInit(input), init || {});
      } else {
        nextInput = rewrittenUrl;
      }
    }

    if (method === "POST" && init && Object.prototype.hasOwnProperty.call(init, "body")) {
      const nextBody = rewriteBody(init.body, overrideValue);
      if (nextBody !== init.body) {
        nextInit = Object.assign({}, init, {
          body: nextBody
        });
      }
    }

    return [nextInput, nextInit];
  }

  function install(win) {
    if (!win || win.__cwProjectManagerOverrideInstalled) {
      return;
    }
    win.__cwProjectManagerOverrideInstalled = true;

    let projectManager = "";

    function updateConfig(value) {
      projectManager = normalizeProjectManager(value);
    }

    win.addEventListener("message", function (event) {
      if (event.source !== win) {
        return;
      }
      const data = event.data || {};
      if (data.source === CONFIG_SOURCE && data.type === CONFIG_TYPE) {
        updateConfig(data.projectManager);
      }
    });

    if (typeof win.fetch === "function") {
      const nativeFetch = win.fetch.bind(win);
      win.fetch = function (input, init) {
        const args = rewriteFetchArgs(input, init, projectManager, win);
        return nativeFetch(args[0], args[1]);
      };
    }

    if (win.XMLHttpRequest && win.XMLHttpRequest.prototype) {
      const xhrPrototype = win.XMLHttpRequest.prototype;
      const nativeOpen = xhrPrototype.open;
      const nativeSend = xhrPrototype.send;

      xhrPrototype.open = function (method, url) {
        this.__cwProjectManagerMethod = String(method || "GET").toUpperCase();
        const rewrittenUrl = rewriteUrlValue(url, projectManager, win);
        const args = Array.prototype.slice.call(arguments);
        args[1] = rewrittenUrl;
        return nativeOpen.apply(this, args);
      };

      xhrPrototype.send = function (body) {
        if (this.__cwProjectManagerMethod === "POST") {
          const args = Array.prototype.slice.call(arguments);
          args[0] = rewriteBody(body, projectManager);
          return nativeSend.apply(this, args);
        }
        return nativeSend.apply(this, arguments);
      };
    }
  }

  export {
    CONFIG_SOURCE,
    CONFIG_TYPE,
    rewriteUrlValue,
    rewriteBody,
    rewriteFetchArgs,
    install
  };
