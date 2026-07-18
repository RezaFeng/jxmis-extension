const DATABASE_NAME = "cw-business-analytics";
const DATABASE_VERSION = 1;
const STORE_NAMES = Object.freeze([
  "queryCache",
  "reportSnapshots",
  "metricHistory",
  "failedRequests",
  "metadata"
]);

const SCHEMA = Object.freeze({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: Object.freeze({
    queryCache: Object.freeze({ keyPath: "id", indexes: [["reportKey", "reportKey"], ["capturedAt", "capturedAt"]] }),
    reportSnapshots: Object.freeze({ keyPath: "id", indexes: [["reportKey", "reportKey"], ["capturedAt", "capturedAt"]] }),
    metricHistory: Object.freeze({ keyPath: "id", indexes: [["scopeKey", "scopeKey"], ["endDate", "endDate"]] }),
    failedRequests: Object.freeze({ keyPath: "id", indexes: [["reportKey", "reportKey"]] }),
    metadata: Object.freeze({ keyPath: "id", indexes: [] })
  })
});

function requestResult(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error || new Error("IndexedDB request failed")); };
  });
}

export function createIndexedDbAdapter(indexedDB, options = {}) {
  if (!indexedDB || typeof indexedDB.open !== "function") {
    throw new TypeError("IndexedDB is unavailable");
  }
  let databasePromise;
  function open(schema = SCHEMA) {
    if (!databasePromise) {
      databasePromise = new Promise(function (resolve, reject) {
        const request = indexedDB.open(options.databaseName || schema.name, schema.version);
        request.onupgradeneeded = function () {
          const database = request.result;
          Object.entries(schema.stores).forEach(function ([name, definition]) {
            const store = database.objectStoreNames.contains(name)
              ? request.transaction.objectStore(name)
              : database.createObjectStore(name, { keyPath: definition.keyPath });
            definition.indexes.forEach(function ([indexName, keyPath]) {
              if (!store.indexNames.contains(indexName)) {
                store.createIndex(indexName, keyPath, { unique: false });
              }
            });
          });
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error("Unable to open IndexedDB")); };
      });
    }
    return databasePromise;
  }
  async function storeOperation(storeName, mode, operation) {
    const database = await open();
    const transaction = database.transaction(storeName, mode);
    return operation(transaction.objectStore(storeName));
  }
  return {
    open,
    get: function (storeName, key) {
      return storeOperation(storeName, "readonly", function (store) { return requestResult(store.get(key)); });
    },
    getAll: function (storeName) {
      return storeOperation(storeName, "readonly", function (store) { return requestResult(store.getAll()); });
    },
    put: function (storeName, value) {
      return storeOperation(storeName, "readwrite", function (store) { return requestResult(store.put(value)); });
    },
    delete: function (storeName, key) {
      return storeOperation(storeName, "readwrite", function (store) { return requestResult(store.delete(key)); });
    },
    clear: function (storeName) {
      return storeOperation(storeName, "readwrite", function (store) { return requestResult(store.clear()); });
    }
  };
}

export function createMemoryAnalyticsAdapter(initial = {}) {
  const stores = new Map();
  let version = Number(initial.version || 0);
  function ensure(name) {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }
    return stores.get(name);
  }
  Object.entries(initial.stores || {}).forEach(function ([name, records]) {
    const store = ensure(name);
    records.forEach(function (record) { store.set(record.id, structuredClone(record)); });
  });
  return {
    open: async function (schema = SCHEMA) {
      Object.keys(schema.stores).forEach(ensure);
      version = Math.max(version, schema.version);
      return { version };
    },
    get: async function (storeName, key) {
      const value = ensure(storeName).get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    getAll: async function (storeName) {
      return [...ensure(storeName).values()].map(function (value) { return structuredClone(value); });
    },
    put: async function (storeName, value) {
      ensure(storeName).set(value.id, structuredClone(value));
      return value.id;
    },
    delete: async function (storeName, key) { ensure(storeName).delete(key); },
    clear: async function (storeName) { ensure(storeName).clear(); },
    inspect: function () { return { version, stores }; }
  };
}

function requireText(value, field) {
  const result = String(value || "").trim();
  if (!result) {
    throw new Error(field + " is required");
  }
  return result;
}

function timestamp(value, field) {
  const time = Date.parse(requireText(value, field));
  if (!Number.isFinite(time)) {
    throw new Error(field + " must be an ISO timestamp");
  }
  return time;
}

function assertRetryDescriptorSafe(value, path = "descriptor") {
  if (!value || typeof value !== "object") {
    return;
  }
  Object.entries(value).forEach(function ([key, child]) {
    if (/cookie|jsession|api.?key|authorization/i.test(key)) {
      throw new Error(path + "." + key + " contains forbidden authentication data");
    }
    assertRetryDescriptorSafe(child, path + "." + key);
  });
}

export function createAnalyticsRepository(indexedDB, options = {}) {
  const database = options.adapter || createIndexedDbAdapter(indexedDB, options);
  const now = options.now || function () { return new Date(); };
  let ready;
  function initialize() {
    if (!ready) {
      ready = database.open(SCHEMA).then(async function () {
        const metadata = await database.get("metadata", "schema");
        await database.put("metadata", {
          id: "schema",
          version: DATABASE_VERSION,
          migratedAt: metadata && metadata.migratedAt || now().toISOString()
        });
      });
    }
    return ready;
  }
  async function all(storeName) {
    await initialize();
    return database.getAll(storeName);
  }
  async function getLatest(reportKey) {
    const key = requireText(reportKey, "reportKey");
    return (await all("reportSnapshots"))
      .filter(function (item) { return item.reportKey === key && item.complete === true; })
      .sort(function (a, b) { return timestamp(b.capturedAt, "capturedAt") - timestamp(a.capturedAt, "capturedAt"); })[0] || null;
  }
  async function saveComplete(snapshot) {
    await initialize();
    if (!snapshot || snapshot.complete !== true) {
      throw new Error("complete snapshot required");
    }
    const reportKey = requireText(snapshot.reportKey, "reportKey");
    const capturedAt = requireText(snapshot.capturedAt, "capturedAt");
    timestamp(capturedAt, "capturedAt");
    const record = Object.assign({}, structuredClone(snapshot), {
      id: reportKey + "::" + capturedAt,
      reportKey,
      capturedAt,
      complete: true
    });
    await database.put("reportSnapshots", record);
    if (snapshot.departmentId && snapshot.configVersion && snapshot.policyVersion && snapshot.endDate) {
      const scopeKey = [snapshot.departmentId, snapshot.configVersion, snapshot.policyVersion].join("::");
      await database.put("metricHistory", {
        id: scopeKey + "::" + snapshot.startDate + "::" + snapshot.endDate + "::" + capturedAt,
        scopeKey,
        departmentId: snapshot.departmentId,
        configVersion: snapshot.configVersion,
        policyVersion: snapshot.policyVersion,
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        capturedAt,
        metrics: structuredClone(snapshot.metrics || snapshot.report && snapshot.report.metrics || {})
      });
    }
    return record;
  }
  async function saveQueryCache(entry) {
    await initialize();
    const reportKey = requireText(entry && entry.reportKey, "reportKey");
    const capturedAt = requireText(entry && entry.capturedAt, "capturedAt");
    const record = Object.assign({}, structuredClone(entry), {
      id: entry.id || reportKey + "::" + capturedAt,
      reportKey,
      capturedAt,
      queryKey: entry.queryKey || reportKey
    });
    await database.put("queryCache", record);
    return record;
  }
  async function saveFailedRequests(reportKey, descriptors) {
    await initialize();
    const key = requireText(reportKey, "reportKey");
    const values = Array.isArray(descriptors) ? structuredClone(descriptors) : [];
    assertRetryDescriptorSafe(values);
    await database.put("failedRequests", {
      id: key,
      reportKey: key,
      capturedAt: now().toISOString(),
      descriptors: values
    });
  }
  async function retryDescriptor(reportKey) {
    await initialize();
    const result = await database.get("failedRequests", requireText(reportKey, "reportKey"));
    return result ? result.descriptors : [];
  }
  async function cleanup() {
    await initialize();
    const current = now();
    const cutoff = current.getTime() - 30 * 24 * 60 * 60 * 1000;
    const cache = await database.getAll("queryCache");
    const newestByQuery = new Map();
    cache.forEach(function (item) {
      const time = timestamp(item.capturedAt, "capturedAt");
      newestByQuery.set(item.queryKey, Math.max(newestByQuery.get(item.queryKey) || 0, time));
    });
    const retainedQueries = new Set([...newestByQuery.entries()]
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 20)
      .map(function (entry) { return entry[0]; }));
    await Promise.all(cache.filter(function (item) {
      return timestamp(item.capturedAt, "capturedAt") < cutoff || !retainedQueries.has(item.queryKey);
    }).map(function (item) { return database.delete("queryCache", item.id); }));

    const history = await database.getAll("metricHistory");
    const byScope = new Map();
    history.forEach(function (item) {
      const items = byScope.get(item.scopeKey) || [];
      items.push(item);
      byScope.set(item.scopeKey, items);
    });
    const historyDeletes = [];
    byScope.forEach(function (items) {
      items.sort(function (a, b) {
        return b.endDate.localeCompare(a.endDate) || b.capturedAt.localeCompare(a.capturedAt);
      }).slice(104).forEach(function (item) { historyDeletes.push(database.delete("metricHistory", item.id)); });
    });
    await Promise.all(historyDeletes);
    await database.put("metadata", { id: "cleanup", lastCleanupAt: current.toISOString() });
    return { removedCache: cache.length - (await database.getAll("queryCache")).length, removedHistory: historyDeletes.length };
  }
  async function clearQueryCache() {
    await initialize();
    await Promise.all([database.clear("queryCache"), database.clear("failedRequests")]);
  }
  async function clearHistory() {
    await initialize();
    await Promise.all([database.clear("reportSnapshots"), database.clear("metricHistory")]);
  }
  async function getStats() {
    await initialize();
    const entries = await Promise.all(STORE_NAMES.map(async function (name) {
      const records = await database.getAll(name);
      return [name, { count: records.length, bytes: new Blob([JSON.stringify(records)]).size }];
    }));
    return Object.fromEntries(entries);
  }
  return {
    initialize,
    getLatest,
    saveComplete,
    saveQueryCache,
    saveFailedRequests,
    retryDescriptor,
    cleanup,
    clearQueryCache,
    clearHistory,
    getStats
  };
}
