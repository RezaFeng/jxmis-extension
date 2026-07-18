import {
  MESSAGE_TYPES,
  SOURCES,
  createRequestMessage,
  parseWindowMessage
} from "../../shared/protocol.js";

export function installBusinessAnalyticsPage(adapters) {
  const window = adapters.window;
  const collector = adapters.collector;
  let activeRequestId = null;
  function post(type, requestId, payload = {}) {
    window.postMessage(createRequestMessage(
      SOURCES.ANALYTICS_PAGE,
      type,
      requestId,
      payload
    ), "*");
  }
  function handleMessage(event) {
    const parsed = parseWindowMessage(event, {
      windowRef: window,
      source: SOURCES.ANALYTICS_CONTENT,
      types: [MESSAGE_TYPES.ANALYTICS_REQUEST, MESSAGE_TYPES.ANALYTICS_CANCEL]
    });
    if (!parsed.ok) return;
    const message = parsed.value;
    if (message.type === MESSAGE_TYPES.ANALYTICS_CANCEL) {
      collector.cancel(message.requestId);
      return;
    }
    activeRequestId = message.requestId;
    collector.collect(message, function (progress) {
      if (activeRequestId === message.requestId) {
        post(MESSAGE_TYPES.ANALYTICS_PROGRESS, message.requestId, { progress });
      }
    }).then(function (result) {
      if (activeRequestId === message.requestId) {
        post(MESSAGE_TYPES.ANALYTICS_RESULT, message.requestId, { result });
      }
    }).catch(function (error) {
      if (activeRequestId === message.requestId) {
        post(MESSAGE_TYPES.ANALYTICS_ERROR, message.requestId, {
          code: error && error.code || "COLLECTION_FAILED",
          error: error && error.message || String(error)
        });
      }
    });
  }
  window.addEventListener("message", handleMessage);
  return { handleMessage, uninstall: function () { window.removeEventListener("message", handleMessage); } };
}
