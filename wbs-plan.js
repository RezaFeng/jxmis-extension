(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.CwWbsPlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const HOLIDAY_WORKDAY_OVERRIDES = {
    "2026": {
      holidays: [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-02-15",
        "2026-02-16",
        "2026-02-17",
        "2026-02-18",
        "2026-02-19",
        "2026-02-20",
        "2026-02-21",
        "2026-02-22",
        "2026-02-23",
        "2026-04-04",
        "2026-04-05",
        "2026-04-06",
        "2026-05-01",
        "2026-05-02",
        "2026-05-03",
        "2026-05-04",
        "2026-05-05",
        "2026-06-19",
        "2026-06-20",
        "2026-06-21",
        "2026-09-25",
        "2026-09-26",
        "2026-09-27",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07"
      ],
      workdays: [
        "2026-01-04",
        "2026-02-14",
        "2026-02-28",
        "2026-05-09",
        "2026-09-20",
        "2026-10-10"
      ]
    }
  };

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

  function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function hasHolidayTable(year) {
    return Boolean(HOLIDAY_WORKDAY_OVERRIDES[String(year)]);
  }

  function isChinaWorkday(date) {
    const key = formatDate(date);
    const config = HOLIDAY_WORKDAY_OVERRIDES[String(date.getFullYear())];
    if (config) {
      if (config.workdays.indexOf(key) >= 0) {
        return true;
      }
      if (config.holidays.indexOf(key) >= 0) {
        return false;
      }
    }
    const day = date.getDay();
    return day !== 0 && day !== 6;
  }

  function getNextWeekInfo(context) {
    const start = addDays(context.startDate, 7);
    const end = addDays(start, 6);
    const workdays = [];
    let cursor = start;
    while (cursor <= end) {
      if (isChinaWorkday(cursor)) {
        workdays.push(new Date(cursor.getTime()));
      }
      cursor = addDays(cursor, 1);
    }
    return {
      start: start,
      end: end,
      startText: formatDate(start),
      endText: formatDate(end),
      workdays: workdays,
      hasHolidayTable: hasHolidayTable(start.getFullYear()) && hasHolidayTable(end.getFullYear())
    };
  }

  function countWorkdaysInRange(startDate, endDate) {
    if (!startDate || !endDate || startDate > endDate) {
      return 0;
    }
    let count = 0;
    let cursor = new Date(startDate.getTime());
    while (cursor <= endDate) {
      if (isChinaWorkday(cursor)) {
        count += 1;
      }
      cursor = addDays(cursor, 1);
    }
    return count;
  }

  function intervalsIntersect(startA, endA, startB, endB) {
    return startA && endA && startB && endB && startA <= endB && endA >= startB;
  }

  function createDedupKey(row) {
    return [
      String((row && row.majorPerson) || ""),
      String((row && (row.wbsId || row.detailId)) || ""),
      String((row && (row.extName || row.detailName || row.wbsName)) || "")
    ].join("|");
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isTentativeOwner(row) {
    return String((row && (row.roleName || row.majorPersonName || row.majorPerson)) || "").trim() === "待定";
  }

  function getWbsOwnerId(row) {
    return String((row && (row.roleId || row.majorPerson)) || "").trim();
  }

  function getWbsOwnerName(row) {
    return String((row && (row.roleName || row.majorPersonName)) || "").trim();
  }

  function hasWbsDuration(row) {
    return toNumber(row && row.duration) > 0;
  }

  function splitHours(totalHours) {
    const chunks = [];
    let remaining = Math.max(0, Math.floor(totalHours));
    while (remaining > 0) {
      const chunk = Math.min(24, remaining);
      chunks.push(chunk);
      remaining -= chunk;
    }
    return chunks;
  }

  function createNextExecutionRow(wbs, hours, context, options) {
    const manualPerson = Boolean(options && options.manualPerson);
    const tentative = isTentativeOwner(wbs);
    const ownerId = tentative || manualPerson ? "" : getWbsOwnerId(wbs);
    const ownerName = tentative || manualPerson ? "" : getWbsOwnerName(wbs);
    const detailName = String((wbs && wbs.detailName) || "").trim();
    const creator = context.prodPerson || context.projectManager || "";
    const creatorName = context.prodPersonName || context.projectManagerName || "";
    const planEndTime = String((options && options.planEndTime) || (wbs && wbs.planEndTime) || "");

    return {
      isProjectType: "",
      isLaskTask: "1",
      memo: "",
      confrontId: "",
      nextWkId: context.wkId,
      wbsName: detailName,
      workItemId: String((wbs && wbs.workItemId) || ""),
      majorPersonName: ownerName,
      modifyPerson: "",
      orgId: String((wbs && wbs.orgId) || ""),
      wageLevelCost: "",
      taskResouce: "2",
      modifyTime: "",
      majorPerson: ownerId,
      dingTaskId: "",
      subOrgId: String((wbs && wbs.subOrgId) || ""),
      taskField: "WBS任务",
      taskNo: "",
      extId: "",
      createPersonName: "",
      isConfirmPmo: "",
      finishDesc: "",
      taskDetails: "",
      realEndTime: "",
      processInstanceId: "",
      wageLevelCosts: "",
      createPerson: creator,
      svn: "",
      isNeedDo: "",
      extName: detailName,
      planDate: manualPerson ? "" : String(hours),
      realTime: "",
      finishRate: "",
      actualHour: "",
      isState: "",
      createTime: "",
      grade: "",
      actualDate: "",
      wbsId: String((wbs && wbs.detailId) || ""),
      wkId: "",
      planEndTime: planEndTime,
      projectAttribute: "",
      isConfirmCompletion: "",
      projectName: context.projectName,
      projectId: context.projectId,
      taskId: "",
      createName: creatorName,
      wkStatus: "0",
      _add_: true,
      _id_: Date.now() + Math.floor(Math.random() * 1000000),
      _v_checkbox: "",
      "[object HTMLCollection]": "WBS任务"
    };
  }

  function buildNextExecutionRows(wbsRows, existingRows, context, nextWeek, options) {
    const logger = options && typeof options.logWbsStep === "function" ? options.logWbsStep : function () {};
    const dedup = new Set();
    const usedHoursByPerson = {};
    const generated = [];
    const stats = {
      total: wbsRows.length,
      existingRows: existingRows.length,
      noNameOrId: 0,
      outsideNextWeek: 0,
      duplicate: 0,
      tentative: 0,
      noOwnerAndNoDuration: 0,
      noPerson: 0,
      manualPerson: 0,
      zeroAssignable: 0,
      generatedTasks: 0,
      generatedRows: 0
    };
    const includedSamples = [];
    const skippedSamples = [];

    existingRows.forEach(function (row) {
      const key = createDedupKey(row);
      if (key !== "||") {
        dedup.add(key);
      }
      const person = String((row && row.majorPerson) || "");
      if (person) {
        usedHoursByPerson[person] = (usedHoursByPerson[person] || 0) + toNumber(row && row.planDate);
      }
    });

    wbsRows.forEach(function (wbs) {
      const planStart = parseDate(wbs && wbs.planStartTime);
      const planEnd = parseDate(wbs && wbs.planEndTime);
      const detailName = String((wbs && wbs.detailName) || "").trim();
      const detailId = String((wbs && wbs.detailId) || "").trim();
      if (!detailName || !detailId) {
        stats.noNameOrId += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "noNameOrId",
            detailId: detailId,
            detailName: detailName
          });
        }
        return;
      }
      if (!intervalsIntersect(planStart, planEnd, nextWeek.start, nextWeek.end)) {
        stats.outsideNextWeek += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "outsideNextWeek",
            detailId: detailId,
            detailName: detailName,
            planStartTime: wbs && wbs.planStartTime,
            planEndTime: wbs && wbs.planEndTime
          });
        }
        return;
      }

      const key = createDedupKey({
        majorPerson: isTentativeOwner(wbs) ? "" : getWbsOwnerId(wbs),
        wbsId: detailId,
        extName: detailName
      });
      if (dedup.has(key)) {
        stats.duplicate += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "duplicate",
            key: key,
            detailId: detailId,
            detailName: detailName
          });
        }
        return;
      }

      const tentative = isTentativeOwner(wbs);
      const person = getWbsOwnerId(wbs);
      if (tentative && !hasWbsDuration(wbs)) {
        stats.noOwnerAndNoDuration += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "tentativeNoDuration",
            detailId: detailId,
            detailName: detailName,
            roleName: wbs && wbs.roleName,
            roleId: wbs && wbs.roleId,
            majorPerson: wbs && wbs.majorPerson,
            duration: wbs && wbs.duration
          });
        }
        return;
      }

      if (!person && !tentative) {
        if (!hasWbsDuration(wbs)) {
          stats.noOwnerAndNoDuration += 1;
          if (skippedSamples.length < 5) {
            skippedSamples.push({
              reason: "noOwnerAndNoDuration",
              detailId: detailId,
              detailName: detailName,
              roleName: wbs && wbs.roleName,
              roleId: wbs && wbs.roleId,
              majorPerson: wbs && wbs.majorPerson,
              duration: wbs && wbs.duration
            });
          }
          return;
        }

        stats.noPerson += 1;
        generated.push(createNextExecutionRow(wbs, "", context, {
          manualPerson: true,
          planEndTime: nextWeek.endText + " 17:30:00"
        }));
        dedup.add(key);
        stats.manualPerson += 1;
        stats.generatedTasks += 1;
        stats.generatedRows += 1;
        if (includedSamples.length < 10) {
          includedSamples.push({
            detailId: detailId,
            detailName: detailName,
            owner: "manualPerson",
            roleName: wbs && wbs.roleName,
            roleId: wbs && wbs.roleId,
            majorPerson: wbs && wbs.majorPerson,
            planDate: "",
            chunks: [""],
            note: "majorPerson 为空，按手工补人员/工时插入"
          });
        }
        return;
      }

      const intersectionStart = planStart > nextWeek.start ? planStart : nextWeek.start;
      const intersectionEnd = planEnd < nextWeek.end ? planEnd : nextWeek.end;
      const intersectionWorkdays = countWorkdaysInRange(intersectionStart, intersectionEnd);
      const capacity = nextWeek.workdays.length * 8;
      const capacityKey = tentative ? "tentative:" + detailId : person;
      const remaining = Math.max(0, capacity - (usedHoursByPerson[capacityKey] || 0));
      const durationHours = Math.max(0, Math.floor(toNumber(wbs && wbs.duration) * 8));
      const assignableHours = Math.min(intersectionWorkdays * 8, durationHours || intersectionWorkdays * 8, remaining);
      const chunks = splitHours(assignableHours);

      if (!chunks.length) {
        stats.zeroAssignable += 1;
        if (skippedSamples.length < 5) {
          skippedSamples.push({
            reason: "zeroAssignable",
            detailId: detailId,
            detailName: detailName,
            person: tentative ? "待定" : person,
            roleName: wbs && wbs.roleName,
            intersectionWorkdays: intersectionWorkdays,
            duration: wbs && wbs.duration,
            durationHours: durationHours,
            remaining: remaining
          });
        }
      }

      chunks.forEach(function (hours) {
        generated.push(createNextExecutionRow(wbs, hours, context, {
          planEndTime: nextWeek.endText + " 17:30:00"
        }));
      });
      if (assignableHours > 0) {
        usedHoursByPerson[capacityKey] = (usedHoursByPerson[capacityKey] || 0) + assignableHours;
        dedup.add(key);
        if (tentative) {
          stats.tentative += 1;
        }
        stats.generatedTasks += 1;
        stats.generatedRows += chunks.length;
        if (includedSamples.length < 10) {
          includedSamples.push({
            detailId: detailId,
            detailName: detailName,
            person: tentative ? "" : person,
            owner: tentative ? "待定" : "",
            roleName: wbs && wbs.roleName,
            roleId: wbs && wbs.roleId,
            intersectionWorkdays: intersectionWorkdays,
            capacity: capacity,
            usedBefore: capacity - remaining,
            remainingBefore: remaining,
            duration: wbs && wbs.duration,
            durationHours: durationHours,
            assignableHours: assignableHours,
            chunks: chunks
          });
        }
      }
    });

    logger("build next execution rows result", {
      nextWeek: {
        start: nextWeek.startText,
        end: nextWeek.endText,
        workdays: nextWeek.workdays.map(formatDate)
      },
      stats: stats,
      usedHoursByPerson: usedHoursByPerson,
      includedSamples: includedSamples,
      skippedSamples: skippedSamples
    });

    return generated;
  }

  return {
    parseDate: parseDate,
    formatDate: formatDate,
    addDays: addDays,
    hasHolidayTable: hasHolidayTable,
    isChinaWorkday: isChinaWorkday,
    getNextWeekInfo: getNextWeekInfo,
    countWorkdaysInRange: countWorkdaysInRange,
    intervalsIntersect: intervalsIntersect,
    createDedupKey: createDedupKey,
    toNumber: toNumber,
    isTentativeOwner: isTentativeOwner,
    getWbsOwnerId: getWbsOwnerId,
    getWbsOwnerName: getWbsOwnerName,
    hasWbsDuration: hasWbsDuration,
    splitHours: splitHours,
    createNextExecutionRow: createNextExecutionRow,
    buildNextExecutionRows: buildNextExecutionRows
  };
});
