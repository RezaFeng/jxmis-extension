const test = require("node:test");
const assert = require("node:assert/strict");
const override = require("../project-manager-override");

const pageWindow = {
  location: {
    href: "https://jxmis.cyberwing.cn/jxpmo/index/frame",
    origin: "https://jxmis.cyberwing.cn"
  }
};

test("rewrites projectManager in absolute JXMIS query URL", function () {
  const url =
    "https://jxmis.cyberwing.cn/jxpmo/rest/project/queryDailyApprovalService/query?queryName=queryList&projectManager=old&page=1";

  assert.equal(
    override.rewriteUrlValue(url, "new-manager", pageWindow),
    "https://jxmis.cyberwing.cn/jxpmo/rest/project/queryDailyApprovalService/query?queryName=queryList&projectManager=new-manager&page=1"
  );
});

test("rewrites projectManager in relative JXMIS query URL", function () {
  assert.equal(
    override.rewriteUrlValue(
      "/jxpmo/rest/project/queryDailyApprovalService/query?projectManager=old&rows=50",
      "new-manager",
      pageWindow
    ),
    "/jxpmo/rest/project/queryDailyApprovalService/query?projectManager=new-manager&rows=50"
  );
});

test("does not add missing projectManager or rewrite external URLs", function () {
  assert.equal(
    override.rewriteUrlValue("/jxpmo/rest/project/test?rows=50", "new-manager", pageWindow),
    "/jxpmo/rest/project/test?rows=50"
  );
  assert.equal(
    override.rewriteUrlValue(
      "https://api.example.com/v1/test?projectManager=old",
      "new-manager",
      pageWindow
    ),
    "https://api.example.com/v1/test?projectManager=old"
  );
});

test("empty projectManager leaves URL and body unchanged", function () {
  const url = "/jxpmo/rest/project/test?projectManager=old";
  const body = "projectManager=old&rows=50";

  assert.equal(override.rewriteUrlValue(url, "  ", pageWindow), url);
  assert.equal(override.rewriteBody(body, ""), body);
});

test("rewrites URL-encoded body projectManager", function () {
  assert.equal(
    override.rewriteBody("queryName=queryList&projectManager=old&rows=50", "new-manager"),
    "queryName=queryList&projectManager=new-manager&rows=50"
  );
});

test("rewrites URLSearchParams body without mutating original", function () {
  const body = new URLSearchParams("projectManager=old&rows=50");
  const nextBody = override.rewriteBody(body, "new-manager");

  assert.equal(body.get("projectManager"), "old");
  assert.equal(nextBody.get("projectManager"), "new-manager");
  assert.equal(nextBody.get("rows"), "50");
});

test("rewrites direct projectManager fields in JSON bodies", function () {
  assert.equal(
    override.rewriteBody('{"projectManager":"old","rows":50}', "new-manager"),
    '{"projectManager":"new-manager","rows":50}'
  );
  assert.equal(
    override.rewriteBody('[{"projectManager":"old","id":"1"},{"id":"2"}]', "new-manager"),
    '[{"projectManager":"new-manager","id":"1"},{"id":"2"}]'
  );
});

test("does not recursively rewrite nested JSON projectManager fields", function () {
  const body = '{"filter":{"projectManager":"old"},"rows":50}';
  assert.equal(override.rewriteBody(body, "new-manager"), body);
});

test("rewrites fetch URL and POST body together", function () {
  const args = override.rewriteFetchArgs(
    "/jxpmo/rest/project/test?projectManager=old",
    {
      method: "POST",
      body: "projectManager=old&rows=50"
    },
    "new-manager",
    pageWindow
  );

  assert.equal(args[0], "/jxpmo/rest/project/test?projectManager=new-manager");
  assert.deepEqual(args[1], {
    method: "POST",
    body: "projectManager=new-manager&rows=50"
  });
});
