import { registerBackgroundRuntime } from "../background/runtime.js";
import { install as installProjectManagerOverride } from "../page/shared/project-manager-override.js";

// Chromium deduplicates one file declared in both MAIN and ISOLATED worlds.
if (typeof globalThis.window === "object" && globalThis.window === globalThis) {
  installProjectManagerOverride(globalThis.window);
} else {
  registerBackgroundRuntime({
    chrome: globalThis.chrome,
    fetch: globalThis.fetch,
    AbortController: globalThis.AbortController,
    TextDecoder: globalThis.TextDecoder,
    logger: console
  });
}
