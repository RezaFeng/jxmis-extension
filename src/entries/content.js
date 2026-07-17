import { startContentRuntime } from "../content/runtime.js";

startContentRuntime({
  window: globalThis.window,
  document: globalThis.document,
  chrome: globalThis.chrome,
  MutationObserver: globalThis.MutationObserver
});
