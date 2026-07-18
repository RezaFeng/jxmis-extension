import assert from "node:assert/strict";
import test from "node:test";
import {
  associateMonthlyInvoiceRows,
  normalizeContractNo,
  normalizeInvoiceRows
} from "../../src/page/business-analytics/invoice.js";

test("analytics invoice normalizes project receipts and filters reversals", function () {
  const rows = normalizeInvoiceRows([{ id: "I1", invoiceAmount: "1000", recFlag: "1", recAmount: "400", estimateReceivedDate: "2026-07-01" },
    { id: "I2", invoiceAmount: "-100", recFlag: "1", recAmount: "-100", estimateReceivedDate: "2026-07-02" },
    { id: "I3", invoiceAmount: "500", recFlag: "0", estimateReceivedDate: "2026-07-03" }], "P1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].receivedAmount, 400);
  assert.equal(rows[0].pendingAmount, 600);
  assert.equal(rows[1].receivedAmount, 0);
  assert.equal(rows[1].pendingAmount, 500);
});

test("analytics invoice associates monthly rows only by unique normalized contract", function () {
  const result = associateMonthlyInvoiceRows([{ id: "I1", contractNo: " ab－01 ", planAmount: 100, recFlag: "1", recAmount: 20, estimateReceivedDate: "2026-07-01" },
    { id: "I2", contractNo: "NONE", planAmount: 200, estimateReceivedDate: "2026-07-02" },
    { id: "I3", contractNo: "DUP", planAmount: 300, estimateReceivedDate: "2026-07-03" }], [
    { projectId: "P1", contractNo: "AB-01" },
    { projectId: "P2", contractNo: "DUP" },
    { projectId: "P3", contractNo: "DUP" }
  ]);
  assert.equal(normalizeContractNo(" ab－01 "), "AB-01");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].projectId, "P1");
  assert.deepEqual(result.diagnostics, {
    unmappedCount: 1,
    unmappedAmount: 200,
    ambiguousCount: 1,
    ambiguousAmount: 300
  });
});

test("analytics invoice treats blank business amounts as zero", function () {
  const rows = normalizeInvoiceRows([
    { invoiceAmount: null, recFlag: "1", recAmount: "", estimateReceivedDate: "2026-07-01" }
  ], "P1");
  assert.equal(rows[0].planAmount, 0);
  assert.equal(rows[0].receivedAmount, 0);
  assert.equal(rows[0].pendingAmount, 0);
});
