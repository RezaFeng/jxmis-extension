import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT_DIR, "test", "fixtures");
const HOST = "127.0.0.1";
const PORT = Number(process.env.FIXTURE_PORT || 4173);

const PAGE_ROUTES = new Map([
  ["/jxpmo/fixtures/daily", "daily.html"],
  ["/jxpmo/fixtures/weekly", "weekly.html"]
]);

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
