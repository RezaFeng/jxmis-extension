export const LEGACY_ANALYTICS_DATABASE = "cw-business-analytics";

export function cleanupLegacyAnalyticsDatabase(indexedDB, logger = console) {
  if (!indexedDB || typeof indexedDB.deleteDatabase !== "function") {
    return Promise.resolve({ status: "unavailable" });
  }
  return new Promise(function (resolve) {
    let settled = false;
    function finish(status) {
      if (settled) return;
      settled = true;
      resolve({ status });
    }
    function warn(message, error) {
      if (logger && typeof logger.warn === "function") {
        logger.warn(message, error || "");
      }
    }
    try {
      const request = indexedDB.deleteDatabase(LEGACY_ANALYTICS_DATABASE);
      request.onsuccess = function () { finish("deleted"); };
      request.onblocked = function () {
        warn("Legacy analytics database deletion is blocked");
        finish("blocked");
      };
      request.onerror = function () {
        warn("Legacy analytics database deletion failed", request.error);
        finish("failed");
      };
    } catch (error) {
      warn("Legacy analytics database deletion failed", error);
      finish("failed");
    }
  });
}
