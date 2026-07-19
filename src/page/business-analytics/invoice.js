import { normalizeApiDate } from "./normalizers.js";

export function normalizeContractNo(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[－–—]/g, "-")
    .replace(/\s+/g, "");
}

export function splitContractNumbers(value) {
  return [...new Set(String(value || "")
    .split(/[,，;；]/)
    .map(normalizeContractNo)
    .filter(Boolean))];
}

function requiredIdentifier(value, field, errors) {
  const normalized = String(value ?? "").trim();
  if (!normalized) errors.push(field);
  return normalized || null;
}

function requiredNumber(value, field, errors) {
  if (value === null || value === undefined || value === "") {
    errors.push(field);
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    errors.push(field);
    return null;
  }
  return normalized;
}

function requiredDate(value, field, errors) {
  try {
    return normalizeApiDate(value, "receivable." + field, { required: true });
  } catch (_error) {
    errors.push(field);
    return null;
  }
}

function optionalDate(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return normalizeApiDate(value, "receivable.realRecDate");
  } catch (_error) {
    return null;
  }
}

function projectReference(project) {
  return {
    projectId: String(project.projectId),
    projectNo: project.projectNo || null,
    projectName: project.projectName || null,
    projectManagerName: project.projectManagerName || null
  };
}

function buildProjectContractIndex(projects) {
  const index = new Map();
  (projects || []).forEach(function (project) {
    splitContractNumbers(project.contractNo).forEach(function (contractNo) {
      const matches = index.get(contractNo) || [];
      if (!matches.some(function (item) { return String(item.projectId) === String(project.projectId); })) {
        matches.push(project);
        index.set(contractNo, matches);
      }
    });
  });
  return index;
}

function normalizeReceivableRow(raw) {
  const errors = [];
  const detailId = requiredIdentifier(raw && (raw.detailId ?? raw.invoiceId ?? raw.id), "detailId", errors);
  const planId = requiredIdentifier(raw && raw.planId, "planId", errors);
  const recFlag = String((raw && raw.recFlag) ?? "").trim();
  if (!["0", "1"].includes(recFlag)) errors.push("recFlag");
  const planDate = requiredDate(raw && raw.planRecDate, "planRecDate", errors);
  const planAmount = requiredNumber(raw && raw.invoiceAmount, "invoiceAmount", errors);
  const receivedAmount = recFlag === "1"
    ? requiredNumber(raw && raw.recAmount, "recAmount", errors)
    : 0;
  const pendingAmount = recFlag === "0" ? planAmount : recFlag === "1" ? 0 : null;
  const contractNo = String((raw && raw.contractNum) ?? "").trim() || null;
  return {
    invoiceId: detailId,
    detailId,
    planId,
    projectId: null,
    projectNo: null,
    projectName: null,
    projectManagerName: String((raw && raw.projectManager) ?? "").trim() || null,
    contractNo,
    contractName: String((raw && raw.contractName) ?? "").trim() || null,
    customerName: String((raw && raw.customName) ?? "").trim() || null,
    paymentNature: String((raw && (raw.recProperty ?? raw.natureOfMoney)) ?? "").trim() || null,
    salesDepartmentName: String((raw && raw.salesDeptName) ?? "").trim() || null,
    planDate,
    realReceivedDate: optionalDate(raw && raw.realRecDate),
    planAmount,
    receivedFlag: recFlag,
    receivedAmount,
    pendingAmount,
    redReversal: String((raw && raw.redReversal) ?? "").trim() || null,
    invoiceBatch: String((raw && raw.invoiceBatch) ?? "").trim() || null,
    valid: errors.length === 0,
    validationErrors: [...new Set(errors)],
    source: "invoicePlanDetail"
  };
}

export function associateReceivableRows(rows, projects) {
  const projectsByContract = buildProjectContractIndex(projects);
  const diagnostics = {
    unmappedCount: 0,
    unmappedAmount: 0,
    ambiguousCount: 0,
    ambiguousAmount: 0,
    invalidCount: 0,
    unmapped: [],
    ambiguous: [],
    invalid: []
  };
  const normalizedRows = (rows || []).filter(function (raw) {
    return raw && typeof raw === "object" && !Array.isArray(raw);
  }).map(function (raw) {
    const row = normalizeReceivableRow(raw);
    const contractKey = normalizeContractNo(row.contractNo);
    const matches = projectsByContract.get(contractKey) || [];
    if (matches.length === 1) {
      const project = matches[0];
      row.projectId = String(project.projectId);
      row.projectNo = project.projectNo || null;
      row.projectName = project.projectName || null;
      row.projectManagerName = project.projectManagerName || row.projectManagerName;
    } else if (matches.length === 0) {
      diagnostics.unmappedCount += 1;
      diagnostics.unmappedAmount += Number.isFinite(row.planAmount) ? row.planAmount : 0;
      diagnostics.unmapped.push({ detailId: row.detailId, contractNo: row.contractNo });
    } else {
      diagnostics.ambiguousCount += 1;
      diagnostics.ambiguousAmount += Number.isFinite(row.planAmount) ? row.planAmount : 0;
      diagnostics.ambiguous.push({
        detailId: row.detailId,
        contractNo: row.contractNo,
        candidates: matches.map(projectReference)
      });
    }
    if (!row.valid) {
      diagnostics.invalidCount += 1;
      diagnostics.invalid.push({
        detailId: row.detailId,
        contractNo: row.contractNo,
        fields: row.validationErrors
      });
    }
    return row;
  });
  return { rows: normalizedRows, diagnostics };
}
