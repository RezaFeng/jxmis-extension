export function createPageScriptLoader(document, chrome) {
  return function injectPageScript(id, fileName) {
    return new Promise(function (resolve, reject) {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.cwLoading === "true") {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.id = id;
      script.src = chrome.runtime.getURL(fileName);
      script.async = false;
      script.dataset.cwLoading = "true";
      script.addEventListener("load", function () {
        script.dataset.cwLoading = "false";
        script.dataset.cwLoaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", function () {
        script.dataset.cwLoading = "false";
        reject(new Error("load page script failed: " + fileName));
      }, { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
  };
}
