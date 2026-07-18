import { normalizeFiniteNumber, normalizeIdentifier } from "../../analytics/domain.js";
import { normalizeApiDate } from "./normalizers.js";

export function normalizeContractNo(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replaceAll("－", "-")
    .replaceAll("—", "-")
    .replace(/\s+/g, "");
}

function isReversal(raw) {
  return [true, 1, "1", "Y", "y", "是"].includes(
    raw.redFlag ?? raw.isRed ?? raw.redFlush ?? raw.reversalFlag
  ) || Number(raw.invoiceAmount ?? raw.planAmount ?? 0) < 0;
}

export function normalizeInvoiceRows(rows, projectId) {
  return (rows || []).filter(function (raw) { return raw && !isReversal(raw); }).map(function (raw) {
    const planAmount = normalizeFiniteNumber(
      raw.invoiceAmount ?? raw.planAmount ?? raw.estimateReceivedAmount,
      "invoice.planAmount",
      { required: true }
    );
    const receivedFlag = String(raw.recFlag ?? raw.receivedFlag ?? "") === "1";
    const receivedAmount = receivedFlag
      ? normalizeFiniteNumber(raw.recAmount ?? raw.receivedAmount, "invoice.receivedAmount", { required: true })
      : 0;
    return {
      invoiceId: normalizeIdentifier(raw.invoiceId ?? raw.planId ?? raw.id, "invoice.id"),
      projectId: normalizeIdentifier(projectId ?? raw.projectId, "invoice.projectId", { required: true }),
      contractNo: normalizeContractNo(raw.contractNo ?? raw.contractCode) || null,
      planDate: normalizeApiDate(
        raw.estimateReceivedDate ?? raw.planDate ?? raw.invoiceDate,
        "invoice.planDate",
        { required: true }
      ),
      planAmount,
      receivedAmount,
      pendingAmount: Math.max(planAmount - receivedAmount, 0),
      source: "project"
    };
  });
}

export function associateMonthlyInvoiceRows(rows, projects) {
  const projectsByContract = new Map();
  (projects || []).forEach(function (project) {
    const contractNo = normalizeContractNo(project.contractNo);
    if (!contractNo) return;
    const matches = projectsByContract.get(contractNo) || [];
    matches.push(project);
    projectsByContract.set(contractNo, matches);
  });
  const mapped = [];
  const diagnostics = { unmappedCount: 0, unmappedAmount: 0, ambiguousCount: 0, ambiguousAmount: 0 };
  (rows || []).filter(function (raw) { return raw && !isReversal(raw); }).forEach(function (raw) {
    const contractNo = normalizeContractNo(raw.contractNo ?? raw.contractCode);
    const planAmount = normalizeFiniteNumber(
      raw.planAmount ?? raw.estimateReceivedAmount ?? raw.invoiceAmount,
      "invoiceSupplement.planAmount",
      { required: true }
    );
    const matches = projectsByContract.get(contractNo) || [];
    if (matches.length !== 1) {
      const prefix = matches.length === 0 ? "unmapped" : "ambiguous";
      diagnostics[prefix + "Count"] += 1;
      diagnostics[prefix + "Amount"] += planAmount;
      return;
    }
    const receivedFlag = String(raw.recFlag ?? raw.receivedFlag ?? "") === "1";
    const receivedAmount = receivedFlag
      ? normalizeFiniteNumber(raw.recAmount ?? raw.receivedAmount, "invoiceSupplement.receivedAmount", { required: true })
      : 0;
    mapped.push({
      invoiceId: normalizeIdentifier(raw.invoiceId ?? raw.planId ?? raw.id, "invoiceSupplement.id"),
      projectId: String(matches[0].projectId),
      contractNo,
      planDate: normalizeApiDate(
        raw.estimateReceivedDate ?? raw.planDate,
        "invoiceSupplement.planDate",
        { required: true }
      ),
      planAmount,
      receivedAmount,
      pendingAmount: Math.max(planAmount - receivedAmount, 0),
      source: "monthlySupplement"
    });
  });
  return { rows: mapped, diagnostics };
}
