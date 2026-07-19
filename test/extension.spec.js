import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = path.join(ROOT_DIR, "dist-test");
const FIXTURE_ORIGIN = "http://127.0.0.1:4173";

let context;
let serviceWorker;
let userDataDir;
let realJxmisRequests;

async function getFixtureMessages(page) {
  return page.evaluate(function () {
    return window.__fixtureMessages || [];
  });
}

async function expectMessage(page, type, requestId) {
  await expect.poll(async function () {
    const messages = await getFixtureMessages(page);
    return messages.some(function (message) {
      return message.type === type && (!requestId || message.requestId === requestId);
    });
  }).toBe(true);
}

async function expectOnlyPageBundle(page, scriptId, fileName) {
  const scripts = page.locator("script[data-cw-loaded='true']");
  await expect(page.locator("#" + scriptId)).toHaveAttribute("data-cw-loaded", "true");
  await expect(scripts).toHaveCount(1);
  await expect(scripts.first()).toHaveAttribute("src", new RegExp("/" + fileName.replace(".", "\\.") + "$"));
}

async function openFixture(url) {
  const page = await context.newPage();
  await page.goto(FIXTURE_ORIGIN + url);
  await expect.poll(function () {
    return page.evaluate(function () {
      return window.__cwProjectManagerOverrideInstalled === true;
    });
  }).toBe(true);
  return page;
}

async function setAiConfig(basePath) {
  await serviceWorker.evaluate(async function (config) {
    await chrome.storage.local.set(config);
  }, {
    baseUrl: FIXTURE_ORIGIN + basePath,
    apiKey: "",
    model: "fixture-model",
    provider: "deepseek",
    enableThinking: false,
    systemPrompt: "fixture system prompt"
  });
}

test.beforeAll(async function () {
  userDataDir = await mkdtemp(path.join(tmpdir(), "jxmis-extension-"));
  realJxmisRequests = [];
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      "--disable-extensions-except=" + EXTENSION_DIR,
      "--load-extension=" + EXTENSION_DIR
    ]
  });
  context.on("request", function (request) {
    const url = new URL(request.url());
    if (url.hostname === "jxmis.cyberwing.cn") {
      realJxmisRequests.push(request.url());
    }
  });
  serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-z]+\/background\.js$/);
});

test.afterEach(function () {
  expect(realJxmisRequests).toEqual([]);
  realJxmisRequests.length = 0;
});

test.afterAll(async function () {
  if (context) {
    await context.close();
  }
  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("daily fixture loads only daily automation and completes empty run", async function () {
  const page = await openFixture("/jxpmo/fixtures/daily");
  const button = page.getByRole("button", { name: "批量审批未审批日报" });

  await expect(button).toBeVisible();
  await expectOnlyPageBundle(page, "cw-daily-approval-page-script", "page-daily-approval.js");
  await button.click();

  await expectMessage(page, "CW_DAILY_APPROVAL_START");
  await expectMessage(page, "CW_DAILY_APPROVAL_DONE");
  await expect(page.locator("#cw-daily-approval-status")).toHaveText("无未审批日报");
  await page.close();
});

test("batch work fixture routes save and AI success/error lifecycles", async function () {
  const page = await openFixture("/jxpmo/project/WkReportService/id/WK-FIXTURE");

  await expect(page.getByRole("button", { name: "一键报工", exact: true })).toBeVisible();
  await expectOnlyPageBundle(page, "cw-batch-work-page-script", "page-batch-work.js");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(function () {
    return page.evaluate(function () {
      return window.__fixtureSaveAllCalls;
    });
  }).toBe(1);
  await expectMessage(page, "CW_TOOLBAR_ACTION_DONE");

  await setAiConfig("/v1");
  await page.evaluate(function () {
    window.postMessage({
      source: "cw-batch-work-page",
      type: "CW_WEEKLY_SUMMARY_AI_REQUEST",
      requestId: "ai-success",
      userPrompt: "fixture tasks"
    }, "*");
  });
  await expectMessage(page, "CW_WEEKLY_SUMMARY_AI_CHUNK", "ai-success");
  await expectMessage(page, "CW_WEEKLY_SUMMARY_AI_DONE", "ai-success");

  await setAiConfig("/error-v1");
  await page.evaluate(function () {
    window.postMessage({
      source: "cw-batch-work-page",
      type: "CW_WEEKLY_SUMMARY_AI_REQUEST",
      requestId: "ai-error",
      userPrompt: "fixture tasks"
    }, "*");
  });
  await expectMessage(page, "CW_WEEKLY_SUMMARY_AI_ERROR", "ai-error");

  page.once("dialog", function (dialog) {
    dialog.accept();
  });
  await page.getByRole("button", { name: "一键报工", exact: true }).click();
  await expectMessage(page, "CW_BATCH_WORK_START");
  await page.close();
});

test("weekly fixture loads only weekly automation and completes empty run", async function () {
  const page = await openFixture(
    "/jxpmo/fixtures/weekly#/project/WkReportService/wkreportListPage"
  );
  const button = page.getByRole("button", { name: "批量审核", exact: true });

  await expect(button).toBeVisible();
  await expectOnlyPageBundle(page, "cw-weekly-approval-page-script", "page-weekly-approval.js");
  await button.click();

  await expectMessage(page, "CW_WEEKLY_APPROVAL_START");
  await expectMessage(page, "CW_WEEKLY_APPROVAL_DONE");
  await expect(page.locator("#cw-weekly-approval-status")).toHaveText("无待审核周报");
  await page.close();
});

async function openAnalytics(mode = "full", expectedOptionCount = 4) {
  const page = await openFixture(
    "/jxpmo/fixtures/project?mode=" + mode +
      "#!/jxpmo/project/ProjectInfoService/projectinDedaultHomePage"
  );
  const navigation = page.getByRole("link", { name: "经营分析", exact: true });
  await expect(navigation).toBeVisible();
  await expect(page.locator("#cw-business-analytics-navigation").locator("xpath=preceding-sibling::li[1]"))
    .toHaveAttribute("appid", "project:1201,jxoa");
  await navigation.click();
  await expect(page.locator("#cw-business-analytics-navigation")).toHaveClass(/active/);
  await expect(page.locator("#app-wrapper")).toBeHidden();
  const host = page.locator("#cw-business-analytics-host");
  await expect(host.locator(".report-title strong")).toHaveText("经营分析");
  await expect(host.locator('[data-field="department"] option')).toHaveCount(expectedOptionCount);
  await host.locator('[data-field="startDate"]').fill("2026-07-06");
  await host.locator('[data-field="endDate"]').fill("2026-07-12");
  return { page, host };
}

async function queryDepartment(host, departmentId, projectName) {
  await host.locator('[data-field="department"]').selectOption(departmentId);
  await host.getByRole("button", { name: "查询", exact: true }).click();
  await expect(host.locator('[data-role="data-status"]')).toHaveText("报告已生成");
  await expect(host.getByText(projectName, { exact: true }).first()).toBeVisible();
}

async function analyticsRequestCount(page, pathname) {
  return page.evaluate(function (expectedPathname) {
    return (window.__fixtureAnalyticsRequests || []).filter(function (request) {
      return request.pathname === expectedPathname;
    }).length;
  }, pathname);
}

async function analyticsRequests(page, pathname) {
  return page.evaluate(function (expectedPathname) {
    return (window.__fixtureAnalyticsRequests || []).filter(function (request) {
      return request.pathname === expectedPathname;
    });
  }, pathname);
}

test("business analytics fixture uses live formal scope, comparison and export", async function () {
  const { page, host } = await openAnalytics();
  await expectOnlyPageBundle(page, "cw-business-analytics-page-script", "page-business-analytics.js");
  await expect(host.locator('[data-field="department"] option[value="D1"]')).toContainText("1");
  await expect(host.locator('[data-field="department"] option[value="all"]')).toHaveText("全部部门（2）");
  await expect(host.getByRole("button", { name: "刷新", exact: true })).toHaveCount(0);

  const projectDetailsBefore = await analyticsRequestCount(page, "/jxpmo/rest/project/ProjectPlanDetailService/query");
  await host.locator('[data-field="department"]').selectOption("D1");
  expect(await analyticsRequestCount(page, "/jxpmo/rest/project/ProjectPlanDetailService/query"))
    .toBe(projectDetailsBefore);
  await queryDepartment(host, "D1", "Fixture Project One");
  const wbsRequests = (await analyticsRequests(page, "/jxpmo/rest/project/ProjectPlanDetailService/query"))
    .filter(function (request) { return request.params.queryName === "queryVer"; });
  expect(wbsRequests.length).toBeGreaterThan(0);
  expect(wbsRequests.every(function (request) {
    return request.params.startTime === "2026-07-06" &&
      request.params.endTime === "2026-07-12";
  })).toBe(true);
  await expect(host.locator('[data-role="report-status"]')).toContainText("正式范围 1/2");
  await expect(host.getByText("Fixture Project Three", { exact: true })).toHaveCount(0);
  await expect(host.getByRole("heading", { name: "本期经营与上期比较" })).toBeVisible();
  await expect(host.getByRole("row", { name: /投入人天 1 0\.5 0\.5 100%/ })).toBeVisible();
  const contractCard = host.locator('[data-role="overview-cards"] article').filter({ hasText: "软件与服务合同" });
  await expect(contractCard.locator("strong")).toHaveText("30 万元");
  const efficiencyCard = host.locator('[data-role="overview-cards"] article').filter({ hasText: "成本效率" });
  await expect(efficiencyCard.locator("strong")).toHaveText(["1.25", "0.75"]);
  await expect(host.getByRole("row", { name: /Fixture Milestone.*已完成/ }).first()).toBeVisible();
  await expect(host.locator('[data-role="executive-text"]')).toContainText("0 个逾期里程碑");
  await expect(host.getByRole("heading", { name: "数据完整性与诊断" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await host.getByRole("button", { name: "导出HTML", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^经营分析_交付一部_/);

  const hasAnalyticsDatabase = await serviceWorker.evaluate(async function () {
    const databases = await indexedDB.databases();
    return databases.some(function (item) { return item.name === "cw-business-analytics"; });
  });
  expect(hasAnalyticsDatabase).toBe(false);
  await page.close();
});

test("business analytics fixture aggregates all departments from one live collection", async function () {
  const { page, host } = await openAnalytics();
  const dailyBefore = await analyticsRequestCount(page, "/jxpmo/rest/project/taskDetailService/query");
  await host.locator('[data-field="department"]').selectOption("all");
  await host.getByRole("button", { name: "查询", exact: true }).click();
  await expect(host.locator('[data-role="data-status"]')).toHaveText("报告已生成");
  await expect(host.getByRole("heading", { name: "全部部门总览" })).toBeVisible();
  await expect(host.locator('[data-role="company-analytics"] .coverage-summary'))
    .toHaveText("部门覆盖 2/2");
  expect(await analyticsRequestCount(page, "/jxpmo/rest/project/taskDetailService/query"))
    .toBe(dailyBefore + 1);
  await page.close();
});

test("business analytics fixture completes project pagination before local scope", async function () {
  const { page, host } = await openAnalytics("paginated");
  await expect(host.locator('[data-field="department"] option[value="D2"]')).toContainText("1");
  expect(await analyticsRequestCount(page, "/jxpmo/rest/project/ProjectInfoService/query")).toBe(4);
  await queryDepartment(host, "D1", "Fixture Project One");
  await page.close();
});

test("business analytics fixture preserves partial results and session expiry", async function () {
  const partial = await openAnalytics("partial");
  await partial.host.locator('[data-field="department"]').selectOption("D1");
  await partial.host.getByRole("button", { name: "查询", exact: true }).click();
  await expect(partial.host.locator('[data-role="data-status"]')).toHaveText("报告部分可用");
  await expect(partial.host.getByText("未获取", { exact: true }).first()).toBeVisible();
  await expect(partial.host.getByRole("button", { name: "仅重试失败项" })).toBeVisible();
  const dailyBeforeRetry = await analyticsRequestCount(
    partial.page,
    "/jxpmo/rest/project/taskDetailService/query"
  );
  await partial.host.getByRole("button", { name: "仅重试失败项" }).click();
  await expect(partial.host.locator('[data-role="data-status"]')).toHaveText("报告已生成");
  expect(await analyticsRequestCount(partial.page, "/jxpmo/rest/project/taskDetailService/query"))
    .toBe(dailyBeforeRetry);
  await partial.page.close();

  const session = await openAnalytics("session", 1);
  await expect(session.host.locator('[data-role="data-status"]')).toHaveText("登录已失效");
  await expect(session.host.locator('[data-field="department"]')).toBeDisabled();
  await session.page.close();
});

test("business analytics fixture cancels an in-flight live query", async function () {
  const { page, host } = await openAnalytics("slow");
  await host.locator('[data-field="department"]').selectOption("D1");
  await host.getByRole("button", { name: "查询", exact: true }).click();
  const cancel = host.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(host.locator('[data-role="data-status"]')).toHaveText("已取消");
  await expect(host.locator('[data-role="summary"]')).toBeHidden();
  await page.close();
});

test("business analytics options page remains available", async function () {
  const extensionId = new URL(serviceWorker.url()).hostname;
  const page = await context.newPage();
  await page.goto("chrome-extension://" + extensionId + "/options.html");
  await expect(page.getByRole("heading", { name: "扩展设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清理原始缓存" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清理全部历史" })).toHaveCount(0);
  await page.close();
});
