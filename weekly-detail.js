(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.CwWeeklyDetail = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function normalizeWeeklyDetail(data) {
    if (Array.isArray(data)) {
      return data[0] || null;
    }
    if (data && Array.isArray(data.rows)) {
      return data.rows[0] || null;
    }
    if (data && Array.isArray(data.data)) {
      return data.data[0] || null;
    }
    if (data && data.data && typeof data.data === "object") {
      return data.data;
    }
    if (data && data.result && typeof data.result === "object") {
      return data.result;
    }
    return data || null;
  }

  return {
    normalizeWeeklyDetail: normalizeWeeklyDetail
  };
});
