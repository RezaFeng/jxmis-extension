import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectScope,
  normalizeDepartments,
  selectDepartmentProjects
} from "../../src/page/business-analytics/scope.js";

test("analytics scope excludes privLevel 1 and keeps nested current departments", function () {
  assert.deepEqual(normalizeDepartments([{
    id: "10000",
    text: "总部",
    attributes: { privLevel: "1" },
    children: [{ id: 2, text: "交付二部", attributes: { privLevel: 2 } }]
  }, { id: 3, text: "咨询部", attributes: {} }]), [
    { id: "2", name: "交付二部", privLevel: "2" },
    { id: "3", name: "咨询部", privLevel: "" }
  ]);
});

test("analytics scope filters locally and groups by exact department id", function () {
  const projects = [{ projectId: "P1", classification: "J", currStatus: "20", projectDept: "2", projectDeptName: "同名部门" },
    { projectId: "P2", classification: "Z", currStatus: "50", projectDept: "3", projectDeptName: "同名部门" },
    { projectId: "P3", classification: "R", currStatus: "20", projectDept: "2", projectDeptName: "交付二部" },
    { projectId: "P4", classification: "J", currStatus: "20", projectDept: "old", projectDeptName: "历史部门" }];
  const scope = buildProjectScope({
    departments: [{ id: "2", text: "交付二部", attributes: { privLevel: "2" } }, { id: "3", text: "咨询部", attributes: { privLevel: "2" } }],
    projects,
    filters: { attribute: null, classification: ["J", "Z"], currStatus: ["20", "50"], outsourcing: null },
    recentDepartmentIds: ["3"]
  });
  assert.deepEqual(scope.departments.map(function (item) { return item.id; }), ["3", "2"]);
  assert.deepEqual(selectDepartmentProjects(scope, "2").map(function (item) { return item.projectId; }), ["P1"]);
  assert.deepEqual(selectDepartmentProjects(scope, "all").map(function (item) { return item.projectId; }).sort(), ["P1", "P2"]);
  assert.equal(scope.diagnostics.historicalProjectCount, 1);
  assert.deepEqual(scope.diagnostics.historicalDepartments[0], {
    projectDept: "old",
    projectDeptName: "历史部门",
    projectCount: 1
  });
});
