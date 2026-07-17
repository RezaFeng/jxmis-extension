export function createConfigStore(chrome, defaultConfig) {
  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(data) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(data, resolve);
    });
  }

  async function getConfig() {
    const data = await storageGet(defaultConfig);
    return Object.assign({}, defaultConfig, data || {});
  }

  function getCacheKey(key) {
    return "weeklySummaryCache:" + String(key || "");
  }

  async function getWeeklySummaryCache(key) {
    if (!key) {
      return null;
    }
    const storageKey = getCacheKey(key);
    const data = await storageGet([storageKey]);
    return (data && data[storageKey]) || null;
  }

  async function setWeeklySummaryCache(key, value) {
    if (!key) {
      return;
    }
    const storageKey = getCacheKey(key);
    await storageSet({ [storageKey]: value });
  }

  return {
    getConfig,
    getWeeklySummaryCache,
    setWeeklySummaryCache
  };
}
