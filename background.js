(function () {
  const DEFAULT_SYSTEM_PROMPT = [
    "你是项目周报助手。请根据用户提供的本周日报 JSON，总结“本周执行情况”。要求：",
    "1. 只基于 JSON 中的 taskDetail，不编造事实。",
    "2. 按项目交付视角合并同类工作项，突出完成事项、推进事项、联调/优化/问题处理，不同人的工作内容分开罗列，完成项必须分开罗列，不要一行罗列多个完成项。",
    "3. 输出中文自然段，可用分号分隔重点。",
    "4. 不要逐人逐日罗列，不要输出 Markdown 标题，不要提到“JSON”或“日报”，不要提及人名，不要在同一行的任务描述中罗列多个完成项。",
    "5. 严格按照模板的文字风格和排版风格， 有序号，有换行",
    "# 模板",
    "1. 完成施工方案内容完整性督查能力建设，覆盖专项施工方案文档结构完整性、工程概况和特点及施工难点要点完整性、人员架构完整性、倒杆风险防控措施、触电应急措施、跨越措施、危大工程验收要求等规则；",
    "2. 完成施工方案内容合规性督查能力建设，覆盖吊装作业风险评估错误、起重机与带电体最小安全距离校验、钢丝绳强度计算与机具清单一致性校验等规则；",
    "3. 完成施工方案内容逻辑性督查能力建设，新增专项施工方案报审时间与勘察单现场勘察时间前后关系校验规则；",
    "4. 完成带电作业未退出重合闸或自愈功能规则开发；",
    "5. 完成应合接地刀闸或应装接地线装设地点填写不规范规则开发；",
    "6. 完成OMS作业计划（调度）场景下C09、D10违章不输出规则调整。"
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
