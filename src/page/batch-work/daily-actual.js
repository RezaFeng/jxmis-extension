  function normalizeMatchText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseDate(value) {
    const match = String(value || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) {
      return null;
    }
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function dateInRange(value, startDate, endDate) {
    const date = parseDate(value);
    if (!date) {
      return false;
    }
    return date >= startDate && date <= endDate;
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function getDailyStatus(row) {
    return normalizeMatchText(row && (row.newstauts || row.newStatus || row.status));
  }

  function getDailyDateSource(row) {
    return (row && (row.submissionTime || row.realEndTime || row.createTime)) || "";
  }

  function parseDateTime(value) {
    const match = String(value || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (!match) {
      return null;
    }
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
  }

  function getDailySortTime(row) {
    const source = getDailyDateSource(row);
    const date = parseDateTime(source);
    return date ? date.getTime() : 0;
  }

  function formatRateValue(value) {
    const text = String(value == null ? "" : value).replace("%", "").trim();
    if (!text) {
      return "";
    }
    const number = Number(text);
    if (!Number.isFinite(number)) {
      return "";
    }
    const rounded = Math.round(number * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }

  function getWeeklyPersonKey(rowData) {
    const personId = normalizeMatchText(rowData && rowData.majorPerson);
    if (personId) {
      return "id:" + personId;
    }
    const personName = normalizeMatchText(rowData && rowData.majorPersonName);
    return personName ? "name:" + personName : "";
  }

  function dailyPersonMatches(row, rowData) {
    const dailyOwner = normalizeMatchText(row && row.taskOwner);
    const weeklyOwner = normalizeMatchText(rowData && rowData.majorPerson);
    if (dailyOwner && weeklyOwner && dailyOwner === weeklyOwner) {
      return true;
    }

    const dailyName = normalizeMatchText(row && (row.userFullname || row.taskcreateperson));
    const weeklyName = normalizeMatchText(rowData && rowData.majorPersonName);
    return Boolean(dailyName && weeklyName && dailyName === weeklyName);
  }

  function getWeeklyWbsId(rowData) {
    return normalizeMatchText(rowData && rowData.wbsId);
  }

  function getDailyWbsId(row) {
    return normalizeMatchText(row && row.wbsId);
  }

  function getWeeklyTaskId(rowData) {
    return normalizeMatchText(rowData && (rowData.extId || rowData.taskId));
  }

  function getDailyTaskId(row) {
    return normalizeMatchText(row && row.taskId);
  }

  function getWeeklyTaskName(rowData) {
    return normalizeMatchText(rowData && (rowData.extName || rowData.taskName || rowData.wbsName));
  }

  function getDailyTaskName(row) {
    return normalizeMatchText(row && row.taskName);
  }

  function getWeeklyTaskNames(rowData) {
    const seen = new Set();
    return [
      rowData && rowData.wbsName,
      rowData && rowData.extName,
      rowData && rowData.taskName
    ].map(normalizeMatchText).filter(function (name) {
      if (!name || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    });
  }

  function getDailyTaskNames(row) {
    const seen = new Set();
    return [
      row && row.taskName,
      row && row.wbsName
    ].map(normalizeMatchText).filter(function (name) {
      if (!name || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    });
  }

  function appendDailyActualRows(rows, context, seen, result, stats) {
    rows.forEach(function (row) {
      stats.scanned += 1;
      const dateSource = getDailyDateSource(row);
      if (!dateInRange(dateSource, context.startDate, context.endDate)) {
        stats.outsideWeek += 1;
        return;
      }

      const status = getDailyStatus(row);
      if (status && status !== "审核通过") {
        stats.skippedNotApproved += 1;
        return;
      }

      const rawRealHour = row && row.realHour;
      const realHour = toNumber(rawRealHour);
      if (realHour <= 0) {
        stats.skippedNoRealHour += 1;
      }

      const date = formatDate(parseDate(dateSource));
      const key = [
        date,
        normalizeMatchText(row && row.taskOwner),
        normalizeMatchText(row && row.userFullname),
        getDailyWbsId(row),
        getDailyTaskNames(row).join("|"),
        normalizeMatchText(row && row.taskId),
        String(realHour)
      ].join("\n");
      if (seen.has(key)) {
        stats.duplicate += 1;
        return;
      }
      seen.add(key);

      const item = {
        key: key,
        raw: row,
        date: date,
        wbsId: getDailyWbsId(row),
        taskId: getDailyTaskId(row),
        taskName: getDailyTaskName(row),
        taskOwner: normalizeMatchText(row && row.taskOwner),
        userFullname: normalizeMatchText(row && row.userFullname),
        taskNames: getDailyTaskNames(row),
        realHour: realHour,
        hasRealHour: realHour > 0,
        realFinishRate: formatRateValue(row && row.realFinishRate),
        dailyEndTime: normalizeMatchText(row && (row.submissionTime || row.realEndTime || row.createTime)),
        sortTime: getDailySortTime(row),
        status: status || "未返回状态"
      };
      if (!item.wbsId) {
        stats.noWbsId += 1;
      }
      stats.usable += 1;
      result.push(item);
    });
  }

  function createDailyActualStats() {
    return {
      scanned: 0,
      usable: 0,
      outsideWeek: 0,
      skippedNotApproved: 0,
      skippedNoRealHour: 0,
      duplicate: 0,
      noWbsId: 0
    };
  }

  function buildWeeklyWbsPersonCounts(weeklyRows) {
    const counts = {};
    weeklyRows.forEach(function (rowData) {
      const personKey = getWeeklyPersonKey(rowData);
      const wbsId = getWeeklyWbsId(rowData);
      if (!personKey || !wbsId) {
        return;
      }
      const key = personKey + "|wbs:" + wbsId;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function buildWeeklyNameMatchCounts(weeklyRows) {
    const counts = {};
    weeklyRows.forEach(function (rowData) {
      const personKey = getWeeklyPersonKey(rowData);
      if (!personKey) {
        return;
      }
      getWeeklyTaskNames(rowData).forEach(function (name) {
        const key = personKey + "|name:" + name;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function formatHourValue(value) {
    const rounded = Math.round(toNumber(value) * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }

  function createDailyActualResolver(dailyRows, weeklyRows) {
    return {
      available: true,
      dailyRows: dailyRows,
      wbsPersonCounts: buildWeeklyWbsPersonCounts(weeklyRows),
      nameCounts: buildWeeklyNameMatchCounts(weeklyRows),
      usedHourWeeklyKeys: new Set(),
      usedFinishRateWeeklyKeys: new Set(),
      usedEndTimeWeeklyKeys: new Set(),
      usedDailyKeys: new Set()
    };
  }

  function findDailyMatchesByWbs(rowData, resolver) {
    const wbsId = getWeeklyWbsId(rowData);
    if (!wbsId) {
      return [];
    }
    return resolver.dailyRows.filter(function (row) {
      return row.wbsId === wbsId && dailyPersonMatches(row.raw, rowData);
    });
  }

  function resolveDailyWbsMatch(rowData, resolver, personKey) {
    const wbsId = getWeeklyWbsId(rowData);
    if (!wbsId) {
      return {
        key: "",
        matches: [],
        reason: "noWeeklyWbsId"
      };
    }

    const wbsKey = personKey + "|wbs:" + wbsId;
    const isSplitWeeklyWbs = ((resolver.wbsPersonCounts && resolver.wbsPersonCounts[wbsKey]) || 0) > 1;
    if (!isSplitWeeklyWbs) {
      return {
        key: wbsKey,
        matches: findDailyMatchesByWbs(rowData, resolver),
        reason: "noDailyMatch"
      };
    }

    const taskId = getWeeklyTaskId(rowData);
    if (taskId) {
      const taskIdMatches = resolver.dailyRows.filter(function (row) {
        return row.wbsId === wbsId &&
          row.taskId === taskId &&
          dailyPersonMatches(row.raw, rowData);
      });
      if (taskIdMatches.length) {
        return {
          key: wbsKey + "|taskId:" + taskId,
          matches: taskIdMatches,
          reason: ""
        };
      }
    }

    const taskName = getWeeklyTaskName(rowData);
    if (!taskId && !taskName) {
      return {
        key: wbsKey + "|task:",
        matches: [],
        reason: "missingWeeklyTaskIdentityForSplitWbs"
      };
    }

    const matches = taskName
      ? resolver.dailyRows.filter(function (row) {
        return row.wbsId === wbsId &&
          row.taskName === taskName &&
          dailyPersonMatches(row.raw, rowData);
      })
      : [];
    return {
      key: wbsKey + "|taskName:" + taskName,
      matches: matches,
      reason: matches.length ? "" : "noDailyTaskIdentityMatch"
    };
  }

  function findDailyMatchesByName(rowData, resolver) {
    const personKey = getWeeklyPersonKey(rowData);
    const names = getWeeklyTaskNames(rowData);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const weeklyNameKey = personKey + "|name:" + name;
      if ((resolver.nameCounts[weeklyNameKey] || 0) > 1) {
        return {
          key: weeklyNameKey,
          matches: [],
          reason: "ambiguousNameMatch"
        };
      }

      const matches = resolver.dailyRows.filter(function (row) {
        return !row.wbsId &&
          row.taskNames.indexOf(name) >= 0 &&
          dailyPersonMatches(row.raw, rowData);
      });
      if (matches.length) {
        return {
          key: weeklyNameKey,
          matches: matches,
          reason: ""
        };
      }
    }
    return {
      key: "",
      matches: [],
      reason: "noDailyMatch"
    };
  }

  function resolveDailyActualHours(rowData, planDate, resolver) {
    if (!resolver || !resolver.available) {
      return {
        value: planDate,
        source: "planFallback",
        reason: resolver && resolver.error ? "dailyFetchFailed" : "dailyResolverUnavailable"
      };
    }

    const personKey = getWeeklyPersonKey(rowData);
    if (!personKey) {
      return {
        value: planDate,
        source: "planFallback",
        reason: "weeklyPersonMissing"
      };
    }

    const wbsId = getWeeklyWbsId(rowData);
    if (wbsId) {
      const wbsMatch = resolveDailyWbsMatch(rowData, resolver, personKey);
      const weeklyKey = wbsMatch.key;
      if (resolver.usedHourWeeklyKeys.has(weeklyKey)) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "duplicateWeeklyWbsPerson"
        };
      }

      const matches = wbsMatch.matches;
      const total = matches.reduce(function (sum, row) {
        return sum + row.realHour;
      }, 0);
      if (total > 0) {
        resolver.usedHourWeeklyKeys.add(weeklyKey);
        matches.forEach(function (row) {
          resolver.usedDailyKeys.add(row.key);
        });
        return {
          value: formatHourValue(total),
          source: "dailyExact",
          dailyRealHour: total,
          matchedDailyRows: matches.length
        };
      }
      if (matches.length) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "matchedButNoRealHour",
          matchedDailyRows: matches.length
        };
      }
      if (wbsMatch.reason && wbsMatch.reason !== "noDailyMatch") {
        return {
          value: planDate,
          source: "planFallback",
          reason: wbsMatch.reason
        };
      }
    }

    const nameMatch = findDailyMatchesByName(rowData, resolver);
    if (nameMatch.key) {
      if (resolver.usedHourWeeklyKeys.has(nameMatch.key)) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "duplicateWeeklyNamePerson"
        };
      }
      const total = nameMatch.matches.reduce(function (sum, row) {
        return sum + row.realHour;
      }, 0);
      if (total > 0) {
        resolver.usedHourWeeklyKeys.add(nameMatch.key);
        nameMatch.matches.forEach(function (row) {
          resolver.usedDailyKeys.add(row.key);
        });
        return {
          value: formatHourValue(total),
          source: "dailyNameFallback",
          dailyRealHour: total,
          matchedDailyRows: nameMatch.matches.length
        };
      }
      if (nameMatch.matches.length) {
        return {
          value: planDate,
          source: "planFallback",
          reason: "matchedButNoRealHour",
          matchedDailyRows: nameMatch.matches.length
        };
      }
    }

    return {
      value: planDate,
      source: "planFallback",
      reason: nameMatch.reason || "noDailyMatch"
    };
  }

  function resolveDailyFinishRate(rowData, resolver) {
    if (!resolver || !resolver.available) {
      return {
        value: "100",
        source: "defaultFallback",
        reason: resolver && resolver.error ? "dailyFetchFailed" : "dailyResolverUnavailable"
      };
    }

    const personKey = getWeeklyPersonKey(rowData);
    if (!personKey) {
      return {
        value: "100",
        source: "defaultFallback",
        reason: "weeklyPersonMissing"
      };
    }

    const wbsId = getWeeklyWbsId(rowData);
    let weeklyKey = "";
    let matches = [];
    let fallbackReason = "noApprovedDailyMatch";
    let source = "dailyExact";
    if (wbsId) {
      const wbsMatch = resolveDailyWbsMatch(rowData, resolver, personKey);
      weeklyKey = wbsMatch.key;
      if (resolver.usedFinishRateWeeklyKeys.has(weeklyKey)) {
        return {
          value: "100",
          source: "defaultFallback",
          reason: "duplicateWeeklyWbsPerson"
        };
      }
      matches = wbsMatch.matches;
      fallbackReason = wbsMatch.reason || fallbackReason;
    }

    if (!matches.length && fallbackReason !== "missingWeeklyTaskIdentityForSplitWbs" && fallbackReason !== "noDailyTaskIdentityMatch") {
      const nameMatch = findDailyMatchesByName(rowData, resolver);
      weeklyKey = nameMatch.key;
      matches = nameMatch.matches;
      fallbackReason = nameMatch.reason || "noApprovedDailyMatch";
      source = "dailyNameFallback";
      if (weeklyKey && resolver.usedFinishRateWeeklyKeys.has(weeklyKey)) {
        return {
          value: "100",
          source: "defaultFallback",
          reason: "duplicateWeeklyNamePerson"
        };
      }
    }

    const validMatches = matches.filter(function (row) {
      return row.realFinishRate !== "";
    });
    if (!validMatches.length) {
      return {
        value: "100",
        source: "defaultFallback",
        reason: matches.length ? "invalidDailyFinishRate" : fallbackReason
      };
    }

    validMatches.sort(function (a, b) {
      return b.sortTime - a.sortTime;
    });
    const latest = validMatches[0];
    if (weeklyKey) {
      resolver.usedFinishRateWeeklyKeys.add(weeklyKey);
    }
    resolver.usedDailyKeys.add(latest.key);
    return {
      value: latest.realFinishRate,
      source: source,
      dailyFinishRate: latest.realFinishRate,
      matchedDailyRows: matches.length,
      latestDailyDate: latest.date
    };
  }

  function resolveDailyRealEndTime(rowData, fallbackValue, resolver) {
    const fallback = normalizeMatchText(fallbackValue);
    if (!resolver || !resolver.available) {
      return {
        value: fallback,
        source: "planEndTimeFallback",
        reason: resolver && resolver.error ? "dailyFetchFailed" : "dailyResolverUnavailable"
      };
    }

    const personKey = getWeeklyPersonKey(rowData);
    if (!personKey) {
      return {
        value: fallback,
        source: "planEndTimeFallback",
        reason: "weeklyPersonMissing"
      };
    }

    const wbsId = getWeeklyWbsId(rowData);
    let weeklyKey = "";
    let matches = [];
    let fallbackReason = "noDailyMatch";
    let source = "dailyExact";
    if (wbsId) {
      const wbsMatch = resolveDailyWbsMatch(rowData, resolver, personKey);
      weeklyKey = wbsMatch.key;
      if (resolver.usedEndTimeWeeklyKeys.has(weeklyKey)) {
        return {
          value: fallback,
          source: "planEndTimeFallback",
          reason: "duplicateWeeklyWbsPerson"
        };
      }
      matches = wbsMatch.matches;
      fallbackReason = wbsMatch.reason || fallbackReason;
    }

    if (!matches.length && fallbackReason !== "missingWeeklyTaskIdentityForSplitWbs" && fallbackReason !== "noDailyTaskIdentityMatch") {
      const nameMatch = findDailyMatchesByName(rowData, resolver);
      weeklyKey = nameMatch.key;
      matches = nameMatch.matches;
      fallbackReason = nameMatch.reason || "noDailyMatch";
      source = "dailyNameFallback";
      if (weeklyKey && resolver.usedEndTimeWeeklyKeys.has(weeklyKey)) {
        return {
          value: fallback,
          source: "planEndTimeFallback",
          reason: "duplicateWeeklyNamePerson"
        };
      }
    }

    const validMatches = matches.filter(function (row) {
      return Boolean(row.dailyEndTime);
    });
    if (!validMatches.length) {
      return {
        value: fallback,
        source: "planEndTimeFallback",
        reason: matches.length ? "invalidDailyEndTime" : fallbackReason
      };
    }

    validMatches.sort(function (a, b) {
      return b.sortTime - a.sortTime;
    });
    const latest = validMatches[0];
    if (weeklyKey) {
      resolver.usedEndTimeWeeklyKeys.add(weeklyKey);
    }
    resolver.usedDailyKeys.add(latest.key);
    return {
      value: latest.dailyEndTime,
      source: source,
      dailyEndTime: latest.dailyEndTime,
      matchedDailyRows: matches.length,
      latestDailyDate: latest.date
    };
  }

  export {
    normalizeMatchText,
    parseDate,
    formatDate,
    dateInRange,
    toNumber,
    getDailyStatus,
    getDailyDateSource,
    parseDateTime,
    getDailySortTime,
    formatRateValue,
    getWeeklyPersonKey,
    dailyPersonMatches,
    getWeeklyWbsId,
    getDailyWbsId,
    getWeeklyTaskId,
    getDailyTaskId,
    getWeeklyTaskName,
    getDailyTaskName,
    getWeeklyTaskNames,
    getDailyTaskNames,
    appendDailyActualRows,
    createDailyActualStats,
    buildWeeklyWbsPersonCounts,
    buildWeeklyNameMatchCounts,
    formatHourValue,
    createDailyActualResolver,
    findDailyMatchesByWbs,
    resolveDailyWbsMatch,
    findDailyMatchesByName,
    resolveDailyActualHours,
    resolveDailyFinishRate,
    resolveDailyRealEndTime
  };
