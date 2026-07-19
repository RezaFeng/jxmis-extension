import { AnalyticsSchemaError, normalizeCalendarDate, normalizeDateRange } from "./domain.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLIDAY_WORKDAY_OVERRIDES = Object.freeze({
  "2026": Object.freeze({
    holidays: Object.freeze([
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
    ]),
    workdays: Object.freeze([
      "2026-01-04",
      "2026-02-14",
      "2026-02-28",
      "2026-05-09",
      "2026-09-20",
      "2026-10-10"
    ])
  })
});

function dateToUtc(value) {
  const normalized = normalizeCalendarDate(value);
  return new Date(normalized + "T00:00:00.000Z");
}

function dateFromUtc(value) {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value, amount) {
  if (!Number.isInteger(amount)) {
    throw new AnalyticsSchemaError("amount", "must be an integer", amount);
  }
  const date = dateToUtc(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateFromUtc(date);
}

export function getChinaCalendarDate(now) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new AnalyticsSchemaError("now", "must be a valid instant", now);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(function (part) {
    return [part.type, part.value];
  }));
  return values.year + "-" + values.month + "-" + values.day;
}

export function getWeekRange(value) {
  const date = dateToUtc(value);
  const day = date.getUTCDay() || 7;
  const startDate = addCalendarDays(value, 1 - day);
  return { startDate, endDate: addCalendarDays(startDate, 6) };
}

export function getDefaultDateRange(now) {
  const today = getChinaCalendarDate(now);
  const currentWeek = getWeekRange(today);
  return {
    startDate: addCalendarDays(currentWeek.startDate, -7),
    endDate: addCalendarDays(currentWeek.startDate, -1)
  };
}

export function getRangeLength(range) {
  const normalized = normalizeDateRange(range);
  return Math.round((dateToUtc(normalized.endDate) - dateToUtc(normalized.startDate)) / DAY_MS) + 1;
}

export function getPreviousDateRange(range) {
  const normalized = normalizeDateRange(range);
  const days = getRangeLength(normalized);
  return {
    startDate: addCalendarDays(normalized.startDate, -days),
    endDate: addCalendarDays(normalized.startDate, -1)
  };
}

export function getNextDateRange(range) {
  const normalized = normalizeDateRange(range);
  const days = getRangeLength(normalized);
  return {
    startDate: addCalendarDays(normalized.endDate, 1),
    endDate: addCalendarDays(normalized.endDate, days)
  };
}

export function getEndMonthRange(range) {
  const normalized = normalizeDateRange(range);
  const [year, month] = normalized.endDate.split("-").map(Number);
  const startDate = year + "-" + String(month).padStart(2, "0") + "-01";
  const nextMonth = new Date(Date.UTC(year, month, 1));
  nextMonth.setUTCDate(0);
  return { startDate, endDate: dateFromUtc(nextMonth) };
}

export function isNaturalWeek(range) {
  const normalized = normalizeDateRange(range);
  return getRangeLength(normalized) === 7 && getWeekRange(normalized.startDate).endDate === normalized.endDate;
}

export function rangesIntersect(first, second) {
  const a = normalizeDateRange(first);
  const b = normalizeDateRange(second);
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function intersectDateRanges(first, second) {
  const a = normalizeDateRange(first);
  const b = normalizeDateRange(second);
  const startDate = a.startDate > b.startDate ? a.startDate : b.startDate;
  const endDate = a.endDate < b.endDate ? a.endDate : b.endDate;
  return startDate <= endDate ? { startDate, endDate } : null;
}

export function hasHolidayTable(year) {
  return Boolean(HOLIDAY_WORKDAY_OVERRIDES[String(year)]);
}

export function isChinaWorkday(value) {
  const normalized = normalizeCalendarDate(value);
  const config = HOLIDAY_WORKDAY_OVERRIDES[normalized.slice(0, 4)];
  if (config) {
    if (config.workdays.includes(normalized)) return true;
    if (config.holidays.includes(normalized)) return false;
  }
  const day = dateToUtc(normalized).getUTCDay();
  return day !== 0 && day !== 6;
}

export function countChinaWorkdays(range) {
  const normalized = normalizeDateRange(range);
  const missing = new Set();
  let count = 0;
  let cursor = normalized.startDate;
  while (cursor <= normalized.endDate) {
    const year = cursor.slice(0, 4);
    if (!hasHolidayTable(year)) {
      missing.add(year);
    }
    if (isChinaWorkday(cursor)) {
      count += 1;
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return {
    count,
    missingHolidayTableYears: [...missing].sort()
  };
}
