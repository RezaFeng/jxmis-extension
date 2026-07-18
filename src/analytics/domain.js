export class AnalyticsSchemaError extends Error {
  constructor(field, message, value) {
    super(field + ": " + message);
    this.name = "AnalyticsSchemaError";
    this.field = field;
    this.value = value;
  }
}

export const PROJECT_ENUMS = Object.freeze({
  attribute: Object.freeze({
    C: "合同项目(C)",
    P: "产品项目(P)",
    A: "提前执行(A)",
    S: "售前项目(S)"
  }),
  classification: Object.freeze({
    J: "软件项目（J）",
    R: "弱电项目（R）",
    X: "销售项目（X）",
    S: "智能设备（S）",
    Z: "咨询项目（Z）",
    W: "维护项目（W）",
    Y: "人力外包（Y）",
    Q: "其他（Q）"
  }),
  currStatus: Object.freeze({
    "10": "未立项",
    "20": "执行",
    "30": "延迟",
    "40": "暂停",
    "50": "质保",
    "0": "关闭",
    "60": "取消"
  }),
  outsourcing: Object.freeze({
    "01": "执行",
    "02": "外包执行"
  })
});

const PROJECT_NUMBER_FIELDS = Object.freeze([
  "contractAmount",
  "subcontractAmount",
  "estiExeuCost",
  "realExeuCost",
  "realWorkload",
  "planCompleteSchedule",
  "estiTravelCost",
  "realTravelCost",
  "purchaseCost",
  "purchaseAmount"
]);

function isBlank(value) {
  return value === null || value === undefined || value === "";
}

export function normalizeIdentifier(value, field, options = {}) {
  if (isBlank(value)) {
    if (options.required) {
      throw new AnalyticsSchemaError(field, "is required", value);
    }
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized && options.required) {
    throw new AnalyticsSchemaError(field, "is required", value);
  }
  return normalized || null;
}

export function normalizeFiniteNumber(value, field, options = {}) {
  if (isBlank(value)) {
    if (options.blankAsZero) {
      return 0;
    }
    if (options.required) {
      throw new AnalyticsSchemaError(field, "is required", value);
    }
    return null;
  }
  const normalized = typeof value === "string" ? value.trim().replaceAll(",", "") : value;
  const number = typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isFinite(number)) {
    throw new AnalyticsSchemaError(field, "must be a finite number", value);
  }
  return number;
}

export function normalizeCalendarDate(value, field = "date") {
  const normalized = normalizeIdentifier(value, field, { required: true });
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    throw new AnalyticsSchemaError(field, "must use YYYY-MM-DD", value);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AnalyticsSchemaError(field, "is not a valid calendar date", value);
  }
  return normalized;
}

export function normalizeDateRange(value) {
  if (!value || typeof value !== "object") {
    throw new AnalyticsSchemaError("dateRange", "must be an object", value);
  }
  const startDate = normalizeCalendarDate(value.startDate, "startDate");
  const endDate = normalizeCalendarDate(value.endDate, "endDate");
  if (startDate > endDate) {
    throw new AnalyticsSchemaError("dateRange", "startDate must not be after endDate", value);
  }
  return { startDate, endDate };
}

export function normalizeProject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AnalyticsSchemaError("project", "must be an object", raw);
  }
  const project = {
    projectId: normalizeIdentifier(raw.projectId, "projectId", { required: true }),
    projectNo: normalizeIdentifier(raw.projectNo, "projectNo"),
    projectName: normalizeIdentifier(raw.projectName, "projectName", { required: true }),
    contractNo: normalizeIdentifier(raw.contractNo ?? raw.contractCode, "contractNo"),
    attribute: normalizeIdentifier(raw.attribute, "attribute"),
    classification: normalizeIdentifier(raw.classification, "classification"),
    currStatus: normalizeIdentifier(raw.currStatus, "currStatus"),
    currStatusDesc: normalizeIdentifier(raw.currStatusDesc, "currStatusDesc"),
    outsourcing: normalizeIdentifier(raw.outsourcing, "outsourcing"),
    projectDept: normalizeIdentifier(raw.projectDept, "projectDept", { required: true }),
    projectDeptName: normalizeIdentifier(raw.projectDeptName, "projectDeptName"),
    projectManager: normalizeIdentifier(raw.projectManager, "projectManager"),
    projectManagerName: normalizeIdentifier(raw.projectManagerName, "projectManagerName"),
    isCreateWkReport: normalizeIdentifier(raw.isCreateWkReport, "isCreateWkReport")
  };
  PROJECT_NUMBER_FIELDS.forEach(function (field) {
    project[field] = normalizeFiniteNumber(raw[field], field, { blankAsZero: true });
  });
  return project;
}
