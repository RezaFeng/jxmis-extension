import { AI_PORT_TYPES, MESSAGE_TYPES, parseAiPortEvent } from "../shared/protocol.js";

export function createAiBridge(adapters) {
  const chrome = adapters.chrome;
  const postToPage = adapters.postToPage;
  const logger = adapters.logger || console;
  let active = null;

  function closeActive() {
    if (!active) {
      return;
    }
    const current = active;
    active = null;
    try {
      current.port.disconnect();
    } catch (error) {
      logger.warn("[cw-weekly-summary-ai] stale port disconnect failed", error);
    }
  }

  function start(data) {
    closeActive();
    const requestId = data.requestId;
    const port = chrome.runtime.connect({ name: "cw-ai-summary" });
    active = { requestId: requestId, port: port };
    postToPage({
      type: MESSAGE_TYPES.AI_STATUS,
      requestId: requestId,
      message: "已连接扩展后台，准备请求模型"
    });

    port.onMessage.addListener(function (message) {
      const parsed = parseAiPortEvent(message);
      if (!parsed.ok || !active || active.requestId !== requestId) {
        return;
      }
      const event = parsed.value;
      if (event.type === AI_PORT_TYPES.STATUS || event.type === AI_PORT_TYPES.WARNING) {
        postToPage({
          type: MESSAGE_TYPES.AI_STATUS,
          requestId: requestId,
          message: event.message || "模型请求处理中"
        });
      } else if (event.type === AI_PORT_TYPES.REASONING) {
        postToPage({
          type: MESSAGE_TYPES.AI_REASONING,
          requestId: requestId,
          index: event.index,
          text: event.text || ""
        });
      } else if (event.type === AI_PORT_TYPES.CHUNK) {
        postToPage({
          type: MESSAGE_TYPES.AI_CHUNK,
          requestId: requestId,
          text: event.text || ""
        });
      } else if (event.type === AI_PORT_TYPES.DONE) {
        postToPage({ type: MESSAGE_TYPES.AI_DONE, requestId: requestId });
        closeActive();
      } else if (event.type === AI_PORT_TYPES.ERROR) {
        postToPage({
          type: MESSAGE_TYPES.AI_ERROR,
          requestId: requestId,
          message: event.message || "模型请求失败"
        });
        closeActive();
      }
    });
    port.onDisconnect.addListener(function () {
      if (active && active.requestId === requestId) {
        postToPage({
          type: MESSAGE_TYPES.AI_ERROR,
          requestId: requestId,
          message: "模型连接已断开"
        });
        active = null;
      }
    });
    port.postMessage({
      type: AI_PORT_TYPES.START,
      requestId: requestId,
      userPrompt: data.userPrompt || ""
    });
  }

  return { closeActive, start };
}
