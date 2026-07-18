import assert from "node:assert/strict";
import test from "node:test";
import { filterProjectRows } from "../../src/content/business-analytics/report-view.js";

const projects = [{ projectId: "P1", projectNo: "JX-1", projectName: "项目一", currStatus: "20", projectManagerName: "经理甲", inputMd: 1, risks: [{ type: "lowCpi" }] },
  { projectId: "P2", projectNo: "JX-2", projectName: "项目二", currStatus: "50", projectManagerName: "经理乙", inputMd: 0, risks: [] }];

test("analytics overview project selection combines filters", function () {
  assert.deepEqual(filterProjectRows(projects, {
    search: "JX-1",
    status: "20",
    pm: "经理甲",
    activity: "yes",
    risk: "lowCpi"
  }).map(function (item) { return item.projectId; }), ["P1"]);
  assert.deepEqual(filterProjectRows(projects, {
    search: "项目",
    status: "",
    pm: "",
    activity: "no",
    risk: ""
  }).map(function (item) { return item.projectId; }), ["P2"]);
});
