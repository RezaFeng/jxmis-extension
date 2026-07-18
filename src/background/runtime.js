import { DEFAULT_SYSTEM_PROMPT } from "../shared/defaults.js";
import { DEFAULT_PROVIDER } from "../shared/ai-request-body.js";
import { AI_PORT_TYPES, MESSAGE_TYPES, parseAiPortEvent } from "../shared/protocol.js";
import { createAiClient } from "./ai-client.js";
import { createConfigStore } from "./config-store.js";
import { cleanupLegacyAnalyticsDatabase } from "./business-analytics/legacy-cleanup.js";

export function registerBackgroundRuntime(adapters) {
  const chrome = adapters.chrome;
  const AbortControllerCtor = adapters.AbortController || globalThis.AbortController;
  const defaultConfig = {
    baseUrl: "",
    apiKey: "",
    model: "",
    provider: DEFAULT_PROVIDER,
    enableThinking: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  };
  const configStore = createConfigStore(chrome, defaultConfig);
  const legacyCleanup = cleanupLegacyAnalyticsDatabase(
    adapters.indexedDB || globalThis.indexedDB,
    adapters.logger
  );
  const aiClient = createAiClient({
    fetch: adapters.fetch,
    configStore: configStore,
    TextDecoder: adapters.TextDecoder,
    logger: adapters.logger
  });

  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(function () {
      chrome.runtime.openOptionsPage();
    });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message) {
      return false;
    }
    let operation = null;
    if (message.type === MESSAGE_TYPES.AI_FETCH_MODELS) {
      operation = aiClient.fetchModels().then(function (models) {
        return { ok: true, models: models };
      });
    } else if (message.type === MESSAGE_TYPES.CACHE_GET) {
      operation = configStore.getWeeklySummaryCache(message.key).then(function (cache) {
        return { ok: true, cache: cache };
      });
    } else if (message.type === MESSAGE_TYPES.CACHE_SET) {
      operation = configStore.setWeeklySummaryCache(message.key, message.value).then(function () {
        return { ok: true };
      });
    }
    if (!operation) {
      return false;
    }
    operation.catch(function (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }).then(sendResponse);
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
      const parsed = parseAiPortEvent(message);
      if (!parsed.ok || parsed.value.type !== AI_PORT_TYPES.START) {
        return;
      }
      if (controller) {
        controller.abort();
      }
      controller = new AbortControllerCtor();
      aiClient.streamChat(port, parsed.value, controller.signal)
        .then(function () {
          port.postMessage({ type: AI_PORT_TYPES.DONE });
        })
        .catch(function (error) {
          port.postMessage({
            type: AI_PORT_TYPES.ERROR,
            message: error && error.message ? error.message : String(error)
          });
        });
    });
  });

  return { aiClient, configStore, legacyCleanup };
}
