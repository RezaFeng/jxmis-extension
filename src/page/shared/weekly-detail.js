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

  export { normalizeWeeklyDetail };
