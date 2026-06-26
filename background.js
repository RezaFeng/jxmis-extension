(function () {
  const DEFAULT_SYSTEM_PROMPT = [
    "你是项目周报助手。请根据用户提供的本周日报 JSON，总结“本周执行情况”。要求：",
    "1. 只基于 JSON 中的 taskDetail，不编造事实。",
    "2. 按项目交付视角合并同类工作，突出完成事项、推进事项、联调/优化/问题处理。",
    "3. 输出中文自然段，可用分号分隔重点。",
    "4. 不要逐人逐日罗列，不要输出 Markdown 标题，不要提到“JSON”或“日报”。",
    "5. 控制在 300-600 字。"
  ].join("\n");

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

  function readStreamLine(line, port) {
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
      const delta = choice && choice.delta;
      const text =
        (delta && delta.content) ||
        (choice && choice.message && choice.message.content) ||
        "";
      if (text) {
        port.postMessage({
          type: "chunk",
          text: text
        });
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

    if (!response.ok) {
      const text = await response.text().catch(function () {
        return "";
      });
      throw new Error("模型请求失败: HTTP " + response.status + " " + text);
    }

    if (!response.body || !response.body.getReader) {
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

    while (!doneByServer) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, {
        stream: true
      });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (let i = 0; i < lines.length; i += 1) {
        if (readStreamLine(lines[i], port)) {
          doneByServer = true;
          break;
        }
      }
    }

    if (buffer && !doneByServer) {
      readStreamLine(buffer, port);
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "CW_AI_FETCH_MODELS") {
      return false;
    }

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
