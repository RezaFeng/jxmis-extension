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
