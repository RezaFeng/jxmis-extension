import { startContentRuntime } from "../content/runtime.js";
import { install as installProjectManagerOverride } from "../page/shared/project-manager-override.js";

const hasExtensionApi = Boolean(
  globalThis.chrome &&
  globalThis.chrome.runtime &&
  typeof globalThis.chrome.runtime.getURL === "function"
);

if (hasExtensionApi) {
  startContentRuntime({
    window: globalThis.window,
    document: globalThis.document,
    chrome: globalThis.chrome,
    MutationObserver: globalThis.MutationObserver
  });
} else {
  installProjectManagerOverride(globalThis.window);
}
