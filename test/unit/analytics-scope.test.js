import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCurrentPeriodInputScope,
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

test("analytics scope applies current input without changing the comparison candidate set", function () {
  const projects = [
    { projectId: "P1", projectNo: "001", projectName: "项目一" },
    { projectId: "P2", projectNo: "002", projectName: "项目二" },
    { projectId: "P3", projectNo: "003", projectName: "项目三" }
  ];
  const result = applyCurrentPeriodInputScope({
    projects,
    currentDailyRows: [{ projectId: "P1", realHour: 8 }],
    previousDailyRows: [{ projectId: "P2", realHour: 16 }],
    onlyCurrentPeriodInput: true
  });
  assert.deepEqual(result.projects, [projects[0]]);
  assert.deepEqual(result.enteredProjectIds, ["P1"]);
  assert.deepEqual(result.exitedProjectIds, ["P2"]);
  assert.deepEqual(result.rangeChangeProjects.map(function (item) {
    return [item.projectId, item.currentInputMd, item.previousInputMd];
  }), [["P1", 1, 0], ["P2", 0, 2]]);
});

test("analytics scope preserves candidates when current input is unavailable", function () {
  const projects = [{ projectId: "P1", projectName: "项目一" }];
  const result = applyCurrentPeriodInputScope({
    projects,
    currentDailyRows: [],
    previousDailyRows: [],
    currentAvailable: false,
    onlyCurrentPeriodInput: true
  });
  assert.deepEqual(result.projects, projects);
  assert.equal(result.formalProjectCount, null);
  assert.equal(result.status, "failed");
  assert.equal(result.enteredProjectIds, null);
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
