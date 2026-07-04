(function () {
  importScripts("defaults.js");
  const DEFAULT_SYSTEM_PROMPT = (globalThis.CW_DEFAULTS && globalThis.CW_DEFAULTS.systemPrompt) || "";

  const DEFAULT_CONFIG = {
    baseUrl: "",
    apiKey: "",
    model: "",
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  };

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, resolve);
    });
  }

  async function getConfig() {
    const data = await storageGet(DEFAULT_CONFIG);
    return Object.assign({}, DEFAULT_CONFIG, data || {});
  }

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").trim().replace(/\/+$/, "");
  }

  function authHeaders(config) {
    const headers = {};
    if (config.apiKey) {
      headers.Authorization = "Bearer " + config.apiKey;
    }
    return headers;
  }

  async function fetchModels() {
    const config = await getConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      throw new Error("请先配置模型 URL");
    }

    const response = await fetch(baseUrl + "/models", {
      method: "GET",
      headers: Object.assign(
        {
          Accept: "application/json"
        },
        authHeaders(config)
      )
    });

    if (!response.ok) {
      const text = await response.text().catch(function () {
        return "";
      });
      throw new Error("获取模型失败: HTTP " + response.status + " " + text);
    }

    const data = await response.json();
    const models = Array.isArray(data && data.data)
      ? data.data.map(function (item) {
          return String((item && (item.id || item.name)) || "").trim();
        }).filter(Boolean)
      : [];
    return Array.from(new Set(models)).sort();
  }

  function getWeeklySummaryCacheKey(key) {
    return "weeklySummaryCache:" + String(key || "");
  }

  async function getWeeklySummaryCache(key) {
    if (!key) {
      return null;
    }
    const storageKey = getWeeklySummaryCacheKey(key);
    const data = await storageGet([storageKey]);
    return (data && data[storageKey]) || null;
  }

  function storageSet(data) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(data, resolve);
    });
  }

  async function setWeeklySummaryCache(key, value) {
    if (!key) {
      return;
    }
    const storageKey = getWeeklySummaryCacheKey(key);
    await storageSet(
      Object.assign({}, {
        [storageKey]: value
      })
    );
  }

  function getChoiceText(choice) {
    const delta = choice && choice.delta;
    const message = choice && choice.message;
    return String(
      (delta && delta.content) ||
        (delta && delta.text) ||
        (choice && choice.text) ||
        (message && message.content) ||
        ""
    );
  }

  function getChoiceReasoningText(choice) {
    const delta = choice && choice.delta;
    const message = choice && choice.message;
    return String(
      (delta && (delta.reasoning_content || delta.reasoning)) ||
        (message && (message.reasoning_content || message.reasoning)) ||
        ""
    );
  }

  function getChoiceShape(choice) {
    const delta = choice && choice.delta;
    const message = choice && choice.message;
    return {
      choiceKeys: choice ? Object.keys(choice) : [],
      deltaKeys: delta ? Object.keys(delta) : [],
      messageKeys: message ? Object.keys(message) : []
    };
  }

  function previewText(value, maxLength) {
    const text = String(value || "");
    const limit = maxLength || 1000;
    return text.length > limit ? text.slice(0, limit) + "...[truncated " + text.length + "]" : text;
  }

  function readStreamLine(line, port, streamState) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) {
      return false;
    }

    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      return true;
    }

    try {
      const json = JSON.parse(payload);
      const choice = json && json.choices && json.choices[0];
      const text = getChoiceText(choice);
      if (text) {
        streamState.textChunkCount += 1;
        console.info("[cw-weekly-summary-ai] text chunk content", {
          requestId: streamState.requestId,
          index: streamState.textChunkCount,
          length: text.length,
          text: text
        });
        if (streamState.textChunkCount === 1) {
          console.info("[cw-weekly-summary-ai] first text chunk", {
            requestId: streamState.requestId,
            length: text.length
          });
          port.postMessage({
            type: "status",
            message: "已解析到模型正文，开始写入周报总结"
          });
        }
        port.postMessage({
          type: "chunk",
          text: text
        });
        return false;
      }

      const reasoningText = getChoiceReasoningText(choice);
      if (reasoningText) {
        streamState.reasoningChunkCount += 1;
        console.info("[cw-weekly-summary-ai] reasoning chunk content", {
          requestId: streamState.requestId,
          index: streamState.reasoningChunkCount,
          length: reasoningText.length,
          text: reasoningText
        });
        if (streamState.reasoningChunkCount === 1) {
          console.info("[cw-weekly-summary-ai] reasoning chunk without content", {
            requestId: streamState.requestId,
            length: reasoningText.length
          });
          port.postMessage({
            type: "status",
            message: "模型正在输出推理内容，等待周报正文片段"
          });
        }
        return false;
      }

      streamState.emptyChunkCount += 1;
      if (streamState.emptyChunkCount <= 3) {
        console.info("[cw-weekly-summary-ai] stream line without text", Object.assign(
          {
            requestId: streamState.requestId,
            payloadPreview: previewText(payload, 1000)
          },
          getChoiceShape(choice)
        ));
      }
    } catch (error) {
      port.postMessage({
        type: "warning",
        message: "忽略无法解析的模型流片段"
      });
    }

    return false;
  }

  async function streamChat(port, request, signal) {
    const requestId = request.requestId || "";
    console.info("[cw-weekly-summary-ai] stream start", {
      requestId: requestId
    });
    port.postMessage({
      type: "status",
      message: "扩展后台已开始处理模型请求"
    });

    const config = await getConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const model = String(config.model || "").trim();
    if (!baseUrl) {
      throw new Error("请先配置模型 URL");
    }
    if (!model) {
      throw new Error("请先选择模型");
    }

    const systemPrompt = String(request.systemPrompt || config.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    const userPrompt = String(request.userPrompt || "");
    if (!userPrompt) {
      throw new Error("周报总结输入为空");
    }

    console.info("[cw-weekly-summary-ai] fetch model", {
      requestId: requestId,
      baseUrl: baseUrl,
      model: model,
      promptLength: userPrompt.length
    });
    port.postMessage({
      type: "status",
      message: "正在请求模型接口：" + model
    });

    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      signal: signal,
      headers: Object.assign(
        {
          Accept: "text/event-stream",
          "Content-Type": "application/json"
        },
        authHeaders(config)
      ),
      body: JSON.stringify({
        model: model,
        stream: true,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    });

    console.info("[cw-weekly-summary-ai] response received", {
      requestId: requestId,
      ok: response.ok,
      status: response.status
    });
    port.postMessage({
      type: "status",
      message: "模型接口已响应，HTTP " + response.status + "，等待流式内容"
    });

    if (!response.ok) {
      const text = await response.text().catch(function () {
        return "";
      });
      throw new Error("模型请求失败: HTTP " + response.status + " " + text);
    }

    if (!response.body || !response.body.getReader) {
      port.postMessage({
        type: "status",
        message: "模型返回非流式响应，正在解析内容"
      });
      const json = await response.json();
      const content =
        json &&
        json.choices &&
        json.choices[0] &&
        json.choices[0].message &&
        json.choices[0].message.content;
      if (content) {
        port.postMessage({
          type: "chunk",
          text: content
        });
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let doneByServer = false;
    let hasFirstChunk = false;
    const streamState = {
      requestId: requestId,
      textChunkCount: 0,
      reasoningChunkCount: 0,
      emptyChunkCount: 0
    };

    while (!doneByServer) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, {
        stream: true
      });
      if (!hasFirstChunk) {
        hasFirstChunk = true;
        console.info("[cw-weekly-summary-ai] first stream bytes", {
          requestId: requestId
        });
        port.postMessage({
          type: "status",
          message: "已收到模型流式响应，等待正文片段"
        });
      }

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (let i = 0; i < lines.length; i += 1) {
        if (readStreamLine(lines[i], port, streamState)) {
          doneByServer = true;
          break;
        }
      }
    }

    if (buffer && !doneByServer) {
      readStreamLine(buffer, port, streamState);
    }

    console.info("[cw-weekly-summary-ai] stream parsed", {
      requestId: requestId,
      textChunkCount: streamState.textChunkCount,
      reasoningChunkCount: streamState.reasoningChunkCount,
      emptyChunkCount: streamState.emptyChunkCount
    });
    if (streamState.textChunkCount <= 0) {
      if (streamState.reasoningChunkCount > 0) {
        throw new Error("模型流结束但没有返回正文内容，仅收到推理字段 reasoning_content");
      }
      throw new Error("模型流结束但没有解析到正文内容，请检查模型流式响应字段");
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message) {
      return false;
    }

    if (message.type === "CW_AI_FETCH_MODELS") {
      fetchModels()
        .then(function (models) {
          sendResponse({
            ok: true,
            models: models
          });
        })
        .catch(function (error) {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error)
          });
        });

      return true;
    }

    if (message.type === "CW_WEEKLY_SUMMARY_CACHE_GET") {
      getWeeklySummaryCache(message.key)
        .then(function (cache) {
          sendResponse({
            ok: true,
            cache: cache
          });
        })
        .catch(function (error) {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error)
          });
        });

      return true;
    }

    if (message.type === "CW_WEEKLY_SUMMARY_CACHE_SET") {
      setWeeklySummaryCache(message.key, message.value)
        .then(function () {
          sendResponse({
            ok: true
          });
        })
        .catch(function (error) {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error)
          });
        });

      return true;
    }

    return false;
  });

  chrome.runtime.onConnect.addListener(function (port) {
    if (!port || port.name !== "cw-ai-summary") {
      return;
    }

    let controller = null;

    port.onDisconnect.addListener(function () {
      if (controller) {
        controller.abort();
      }
    });

    port.onMessage.addListener(function (message) {
      if (!message || message.type !== "start") {
        return;
      }

      controller = new AbortController();
      streamChat(port, message, controller.signal)
        .then(function () {
          port.postMessage({
            type: "done"
          });
        })
        .catch(function (error) {
          port.postMessage({
            type: "error",
            message: error && error.message ? error.message : String(error)
          });
        });
    });
  });
})();
