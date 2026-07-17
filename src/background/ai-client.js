import {
  DEFAULT_PROVIDER,
  createChatRequestBody,
  normalizeProvider
} from "../shared/ai-request-body.js";
import { AI_PORT_TYPES } from "../shared/protocol.js";
import { createStreamState, readStreamLine } from "./ai-stream.js";

export function createAiClient(adapters) {
  const fetch = adapters.fetch;
  const configStore = adapters.configStore;
  const TextDecoderCtor = adapters.TextDecoder || globalThis.TextDecoder;
  const logger = adapters.logger || console;

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").trim().replace(/\/+$/, "");
  }

  function authHeaders(config) {
    return config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {};
  }

  async function fetchModels() {
    const config = await configStore.getConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      throw new Error("请先配置模型 URL");
    }
    const response = await fetch(baseUrl + "/models", {
      method: "GET",
      headers: Object.assign({ Accept: "application/json" }, authHeaders(config))
    });
    if (!response.ok) {
      const text = await response.text().catch(function () { return ""; });
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

  async function streamChat(port, request, signal) {
    const requestId = request.requestId || "";
    port.postMessage({ type: AI_PORT_TYPES.STATUS, message: "扩展后台已开始处理模型请求" });
    const config = await configStore.getConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const model = String(config.model || "").trim();
    const provider = normalizeProvider(config.provider || DEFAULT_PROVIDER);
    if (!baseUrl) {
      throw new Error("请先配置模型 URL");
    }
    if (!model) {
      throw new Error("请先选择模型");
    }
    const userPrompt = String(request.userPrompt || "");
    if (!userPrompt) {
      throw new Error("周报总结输入为空");
    }

    port.postMessage({ type: AI_PORT_TYPES.STATUS, message: "正在请求模型接口：" + model });
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      signal: signal,
      headers: Object.assign(
        { Accept: "text/event-stream", "Content-Type": "application/json" },
        authHeaders(config)
      ),
      body: JSON.stringify(createChatRequestBody({
        provider: provider,
        model: model,
        enableThinking: config.enableThinking === true,
        systemPrompt: String(request.systemPrompt || config.systemPrompt || ""),
        userPrompt: userPrompt
      }))
    });
    port.postMessage({
      type: AI_PORT_TYPES.STATUS,
      message: "模型接口已响应，HTTP " + response.status + "，等待流式内容"
    });
    if (!response.ok) {
      const text = await response.text().catch(function () { return ""; });
      throw new Error("模型请求失败: HTTP " + response.status + " " + text);
    }
    if (!response.body || !response.body.getReader) {
      const json = await response.json();
      const content = json && json.choices && json.choices[0] &&
        json.choices[0].message && json.choices[0].message.content;
      if (!content) {
        throw new Error("模型返回内容为空");
      }
      port.postMessage({ type: AI_PORT_TYPES.CHUNK, text: content });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoderCtor("utf-8");
    const streamState = createStreamState(requestId);
    let buffer = "";
    let doneByServer = false;
    let hasFirstChunk = false;
    while (!doneByServer) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      if (!hasFirstChunk) {
        hasFirstChunk = true;
        port.postMessage({
          type: AI_PORT_TYPES.STATUS,
          message: "已收到模型流式响应，等待正文片段"
        });
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (let index = 0; index < lines.length; index += 1) {
        if (readStreamLine(lines[index], port, streamState, logger)) {
          doneByServer = true;
          break;
        }
      }
    }
    if (buffer && !doneByServer) {
      readStreamLine(buffer, port, streamState, logger);
    }
    if (streamState.textChunkCount <= 0) {
      if (streamState.reasoningChunkCount > 0) {
        throw new Error("模型流结束但没有返回正文内容，仅收到推理字段 reasoning_content");
      }
      throw new Error("模型流结束但没有解析到正文内容，请检查模型流式响应字段");
    }
  }

  return { fetchModels, streamChat };
}
