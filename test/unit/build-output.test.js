import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function runBuild(mode) {
  return new Promise(function (resolve, reject) {
    const args = ["scripts/build.mjs"];
    if (mode) {
      args.push("--mode=" + mode);
    }
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", function (code) {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error("build exited with code " + code));
    });
  });
}

async function readManifest(directory) {
  return JSON.parse(await readFile(path.join(rootDir, directory, "manifest.json"), "utf8"));
}

test("production and test manifests keep fixture permissions isolated", async function () {
  await runBuild();
  await runBuild("test");

  const production = await readManifest("dist");
  const fixture = await readManifest("dist-test");
  const fixtureMatch = "http://127.0.0.1/*";

  assert.equal(production.content_scripts[0].matches.includes(fixtureMatch), false);
  assert.equal(production.web_accessible_resources[0].matches.includes(fixtureMatch), false);
  assert.equal(fixture.content_scripts[0].matches.includes(fixtureMatch), true);
  assert.equal(fixture.web_accessible_resources[0].matches.includes(fixtureMatch), true);

  const referenced = [
    production.background.service_worker,
    production.action.default_popup,
    ...production.content_scripts[0].js,
    ...production.web_accessible_resources[0].resources
  ];
  await Promise.all(
    referenced.map(function (fileName) {
      return readFile(path.join(rootDir, "dist", fileName));
    })
  );
});
