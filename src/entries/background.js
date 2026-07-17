import { registerBackgroundRuntime } from "../background/runtime.js";

registerBackgroundRuntime({
  chrome: globalThis.chrome,
  fetch: globalThis.fetch,
  AbortController: globalThis.AbortController,
  TextDecoder: globalThis.TextDecoder,
  logger: console
});
