import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT_DIR, "test", "fixtures");
const HOST = "127.0.0.1";
const PORT = Number(process.env.FIXTURE_PORT || 4173);
const analyticsAttempts = new Map();

const PAGE_ROUTES = new Map([
  ["/jxpmo/fixtures/daily", "daily.html"],
  ["/jxpmo/fixtures/weekly", "weekly.html"],
  ["/jxpmo/fixtures/project", "project.html"]
]);

function analyticsMode(request) {
  try {
    return new URL(request.headers.referer || "http://fixture/").searchParams.get("mode") || "full";
  } catch {
    return "full";
  }
}

function analyticsProject(index, departmentId) {
  return {
    projectId: "P" + index,
    projectNo: "JX-P" + index,
    projectName: index === 1 ? "Fixture Project One" : index === 2 ? "Fixture Project Two" : "Fixture Project " + index,
    contractNo: "HT-" + index,
    attribute: "C",
    classification: "J",
    currStatus: "20",
    currStatusDesc: "执行",
    outsourcing: "01",
    projectDept: departmentId,
    projectDeptName: departmentId === "D1" ? "交付一部" : "交付二部",
    projectManager: "PM-" + index,
    projectManagerName: "Fixture PM " + index,
    isCreateWkReport: "1",
    contractAmount: 1200000,
    subcontractAmount: index === 1 ? null : 1000000,
    estiExeuCost: 500000,
    realExeuCost: index === 1 ? null : 200000,
    realWorkload: index === 1 ? null : 261,
    planCompleteSchedule: 50,
    estiTravelCost: 0,
    realTravelCost: 0,
    purchaseCost: 0,
    purchaseAmount: 0
  };
}

function analyticsAttempt(key) {
  const count = (analyticsAttempts.get(key) || 0) + 1;
  analyticsAttempts.set(key, count);
  return count;
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(response, value, statusCode = 200) {
  setCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response, value, statusCode = 200, contentType = "text/plain; charset=utf-8") {
  setCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(value);
}

async function sendFixture(response, fileName, contentType) {
  const content = await readFile(path.join(FIXTURE_DIR, fileName));
  response.writeHead(200, { "Content-Type": contentType });
  response.end(content);
}

function handleApi(url, request, response) {
  if (request.method === "OPTIONS") {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return true;
  }

  if (url.pathname === "/jxpmo/rest/org/user") {
    sendJson(response, { userId: "USER-1", userFullName: "Fixture User" });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/org/tree/unitTree") {
    sendJson(response, [
      { id: "D1", text: "交付一部", attributes: { privLevel: "2" } },
      { id: "D2", text: "交付二部", attributes: { privLevel: "2" } }
    ]);
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/ProjectInfoService/query") {
    const mode = analyticsMode(request);
    const start = Number(url.searchParams.get("start") || 0);
    const total = mode === "paginated" ? 201 : 3;
    const allRows = mode === "paginated"
      ? Array.from({ length: total }, function (_, index) {
          return analyticsProject(index + 1, index === 0 ? "D1" : "D2");
        })
      : [analyticsProject(1, "D1"), analyticsProject(2, "D2"), analyticsProject(3, "D1")];
    const length = Number(url.searchParams.get("length") || 200);
    sendJson(response, { rows: allRows.slice(start, start + length), recordsTotal: total });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/taskDetailService/query") {
    const mode = analyticsMode(request);
    if (mode === "session") {
      sendJson(response, { message: "login required" }, 401);
      return true;
    }
    const previous = url.searchParams.get("firstTaskDate") === "2026-06-29";
    const payload = {
      rows: (previous ? [1, 2, 3] : [1, 2]).map(function (index) {
        return {
          projectId: "P" + index,
          taskDate: previous ? "2026-07-03" : "2026-07-08",
          realHour: previous && index === 3 ? 8 : previous ? 4 : 8,
          cost: previous && index === 3 ? 800 : previous ? 400 : 800
        };
      }),
      recordsTotal: previous ? 3 : 2
    };
    if (mode === "slow") {
      setTimeout(function () { sendJson(response, payload); }, 750);
    } else {
      sendJson(response, payload);
    }
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/ProjectPlanDetailService/query") {
    const queryName = url.searchParams.get("queryName");
    const projectId = url.searchParams.get("max1") || url.searchParams.get("projectId");
    const failureKey = analyticsMode(request) + ":" + queryName + ":" + projectId;
    if (analyticsMode(request) === "partial" && queryName === "queryVer" && projectId === "P1" &&
      analyticsAttempt(failureKey) <= 3) {
      sendText(response, "fixture WBS failure", 500);
      return true;
    }
    if (queryName === "queryVer") {
      sendJson(response, {
        rows: [{ detailId: "WBS-" + projectId, detailName: "Fixture WBS", costLevel: 10000, planEndTime: "2026-07-09", actualEndTime: "2026-07-10" }],
        recordsTotal: 1
      });
      return true;
    }
    sendJson(response, {
      rows: [{ milestoneId: "M-" + projectId, nodeName: "Fixture Milestone", planEndTime: "2026-07-15", actualEndTime: "", confirmStatus: "1" }],
      recordsTotal: 1
    });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/queryProjectPlanService/query") {
    const projectId = url.searchParams.get("projectId");
    sendJson(response, {
      rows: [{ invoiceId: "I-" + projectId, projectId, contractNo: projectId === "P1" ? "HT-1" : "HT-2", planDate: "2026-07-10", planAmount: 100000, receivedFlag: "1", receivedAmount: 50000 }],
      recordsTotal: 1
    });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/contract/queryReceivedPlanService/query") {
    sendJson(response, { rows: [], recordsTotal: 0 });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/queryDailyApprovalService/query") {
    sendJson(response, { rows: [], total: 0, pageCount: 1 });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/WkReportService/query") {
    sendJson(response, { rows: [], total: 0, pageCount: 1 });
    return true;
  }
  if (url.pathname === "/jxpmo/rest/project/queryByProjectInfosService/query") {
    sendJson(response, {
      wkId: "WK-FIXTURE",
      projectId: "PROJECT-1",
      projectName: "Fixture Project",
      prodPerson: "USER-1",
      prodPersonName: "Fixture User",
      status: "20",
      weekDate: "2026-07-13 - 2026-07-19"
    });
    return true;
  }
  if (url.pathname === "/v1/models") {
    sendJson(response, { data: [{ id: "fixture-model" }] });
    return true;
  }
  if (url.pathname === "/v1/chat/completions") {
    sendText(
      response,
      'data: {"choices":[{"delta":{"reasoning_content":"fixture reasoning"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"fixture summary"}}]}\n\n' +
        "data: [DONE]\n\n",
      200,
      "text/event-stream; charset=utf-8"
    );
    return true;
  }
  if (url.pathname === "/error-v1/chat/completions") {
    sendText(response, "fixture model failure", 500);
    return true;
  }
  return false;
}

const server = createServer(async function (request, response) {
  try {
    const url = new URL(request.url || "/", "http://" + HOST + ":" + PORT);
    if (handleApi(url, request, response)) {
      return;
    }
    if (url.pathname === "/health") {
      sendText(response, "ok");
      return;
    }
    if (url.pathname === "/fixture-runtime.js") {
      await sendFixture(response, "fixture-runtime.js", "text/javascript; charset=utf-8");
      return;
    }
    if (url.pathname.startsWith("/jxpmo/project/WkReportService/id/")) {
      await sendFixture(response, "batch-work.html", "text/html; charset=utf-8");
      return;
    }
    const fixtureFile = PAGE_ROUTES.get(url.pathname);
    if (fixtureFile) {
      await sendFixture(response, fixtureFile, "text/html; charset=utf-8");
      return;
    }
    sendText(response, "not found", 404);
  } catch (error) {
    sendText(response, error && error.message ? error.message : String(error), 500);
  }
});

server.listen(PORT, HOST, function () {
  console.log("fixture server listening on http://" + HOST + ":" + PORT);
});

function shutdown() {
  server.close(function () {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
