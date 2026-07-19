import assert from "node:assert/strict";
import test from "node:test";
import {
  associateReceivableRows,
  normalizeContractNo,
  splitContractNumbers
} from "../../src/page/business-analytics/invoice.js";

test("analytics receivables split project contract lists and match exact normalized tokens", function () {
  const projects = [{
    projectId: "P1",
    projectNo: "JX-1",
    projectName: "框架项目",
    projectManagerName: "经理甲",
    projectDept: "OTHER",
    contractNo: "BASE-01， ab－01 ; NEXT—02"
  }];
  const result = associateReceivableRows([{
    detailId: "D1",
    planId: "PLAN-1",
    contractNum: " AB-01 ",
    contractName: "订单一",
    projectManager: "接口经理",
    customName: "客户甲",
    recProperty: "进度款",
    salesDeptName: "销售一部",
    planRecDate: "2026-07-31",
    realRecDate: "2026-07-20",
    invoiceAmount: 1000,
    recFlag: "1",
    recAmount: 400,
    redReversal: "是"
  }], projects);

  assert.equal(normalizeContractNo(" ab－01 "), "AB-01");
  assert.deepEqual(splitContractNumbers(projects[0].contractNo), ["BASE-01", "AB-01", "NEXT-02"]);
  assert.equal(result.rows[0].projectId, "P1");
  assert.equal(result.rows[0].projectName, "框架项目");
  assert.equal(result.rows[0].projectManagerName, "经理甲");
  assert.equal(result.rows[0].contractName, "订单一");
  assert.equal(result.rows[0].receivedAmount, 400);
  assert.equal(result.rows[0].pendingAmount, 0);
  assert.equal(result.rows[0].realReceivedDate, "2026-07-20");
  assert.equal(result.rows[0].redReversal, "是");
  assert.equal(result.rows[0].valid, true);
});

test("analytics receivables retain signed red reversals and unmatched rows in statistics", function () {
  const result = associateReceivableRows([{
    detailId: "D1",
    planId: "PLAN-1",
    contractNum: "NONE",
    planRecDate: "2025-03-31",
    invoiceAmount: -1459200,
    recFlag: "0",
    redReversal: "是"
  }], []);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].projectId, null);
  assert.equal(result.rows[0].planAmount, -1459200);
  assert.equal(result.rows[0].pendingAmount, -1459200);
  assert.equal(result.rows[0].valid, true);
  assert.equal(result.diagnostics.unmappedCount, 1);
  assert.equal(result.diagnostics.unmappedAmount, -1459200);
  assert.deepEqual(result.diagnostics.unmapped, [{ detailId: "D1", contractNo: "NONE" }]);
});

test("analytics receivables diagnose duplicate project contracts without choosing a project", function () {
  const result = associateReceivableRows([{
    detailId: "D1",
    planId: "PLAN-1",
    contractNum: "DUP",
    planRecDate: "2026-07-31",
    invoiceAmount: 300,
    recFlag: "0"
  }], [
    { projectId: "P1", projectNo: "JX-1", projectName: "项目一", contractNo: "DUP" },
    { projectId: "P2", projectNo: "JX-2", projectName: "项目二", contractNo: "DUP" }
  ]);

  assert.equal(result.rows[0].projectId, null);
  assert.equal(result.rows[0].pendingAmount, 300);
  assert.equal(result.diagnostics.ambiguousCount, 1);
  assert.equal(result.diagnostics.ambiguousAmount, 300);
  assert.deepEqual(
    result.diagnostics.ambiguous[0].candidates.map(function (item) { return item.projectId; }),
    ["P1", "P2"]
  );
});

test("analytics receivables keep invalid rows but exclude silent zero coercion", function () {
  const result = associateReceivableRows([{
    detailId: "D1",
    planId: "PLAN-1",
    contractNum: "HT-1",
    planRecDate: "bad-date",
    invoiceAmount: null,
    recFlag: "2"
  }], []);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].valid, false);
  assert.equal(result.rows[0].planAmount, null);
  assert.equal(result.rows[0].pendingAmount, null);
  assert.deepEqual(result.rows[0].validationErrors, ["recFlag", "planRecDate", "invoiceAmount"]);
  assert.equal(result.diagnostics.invalidCount, 1);
  assert.deepEqual(result.diagnostics.invalid[0].fields, ["recFlag", "planRecDate", "invoiceAmount"]);
});
