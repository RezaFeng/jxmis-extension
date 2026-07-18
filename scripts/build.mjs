import { readFile, rm, mkdir, writeFile, copyFile, watch } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuildBuild } from "esbuild";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_ENTRIES = {
  background: path.join(ROOT_DIR, "src", "entries", "background.js"),
  content: path.join(ROOT_DIR, "src", "entries", "content.js"),
  "page-batch-work": path.join(ROOT_DIR, "src", "entries", "page-batch-work.js"),
  "page-daily-approval": path.join(ROOT_DIR, "src", "entries", "page-daily-approval.js"),
  "page-weekly-approval": path.join(ROOT_DIR, "src", "entries", "page-weekly-approval.js"),
  "page-business-analytics": path.join(ROOT_DIR, "src", "entries", "page-business-analytics.js"),
  options: path.join(ROOT_DIR, "src", "entries", "options.js")
};

function parseArgs(args) {
  const modeArg = args.find(function (arg) {
    return arg.startsWith("--mode=");
  });
  const mode = modeArg ? modeArg.slice("--mode=".length) : "development";
  if (!["development", "test", "production"].includes(mode)) {
    throw new Error("unknown build mode: " + mode);
  }
  return {
    mode: mode,
    watch: args.includes("--watch")
  };
}

function getOutputDir(mode) {
  return path.join(ROOT_DIR, mode === "test" ? "dist-test" : "dist");
}

function createManifest(source, mode) {
  const manifest = structuredClone(source);
  if (mode !== "test") {
    return manifest;
  }

  const fixtureMatch = "http://127.0.0.1/*";
  if (!manifest.host_permissions.includes(fixtureMatch)) {
    manifest.host_permissions.push(fixtureMatch);
  }
  manifest.content_scripts.forEach(function (contentScript) {
    if (!contentScript.matches.includes(fixtureMatch)) {
      contentScript.matches.push(fixtureMatch);
    }
  });
  manifest.web_accessible_resources.forEach(function (resource) {
    if (!resource.matches.includes(fixtureMatch)) {
      resource.matches.push(fixtureMatch);
    }
  });
  return manifest;
}

async function writeStaticFiles(outputDir, mode) {
  const manifestSource = JSON.parse(
    await readFile(path.join(ROOT_DIR, "src", "manifest.json"), "utf8")
  );
  const manifest = createManifest(manifestSource, mode);
  await writeFile(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  await copyFile(
    path.join(ROOT_DIR, "src", "options", "options.html"),
    path.join(outputDir, "options.html")
  );
  await copyFile(
    path.join(ROOT_DIR, "src", "options", "options.css"),
    path.join(outputDir, "options.css")
  );
}

async function bundleEntries(outputDir, mode) {
  await esbuildBuild({
    entryPoints: BUNDLED_ENTRIES,
    outdir: outputDir,
    bundle: true,
    entryNames: "[name]",
    format: "iife",
    legalComments: "none",
    minify: mode === "production",
    sourcemap: mode === "production" ? false : "inline",
    target: "chrome110"
  });
}

async function validateOutput(outputDir) {
  const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
  const referencedFiles = new Set([
    manifest.background.service_worker,
    manifest.options_ui.page
  ]);
  manifest.content_scripts.forEach(function (contentScript) {
    contentScript.js.forEach(function (fileName) {
      referencedFiles.add(fileName);
    });
  });
  manifest.web_accessible_resources.forEach(function (resource) {
    resource.resources.forEach(function (fileName) {
      referencedFiles.add(fileName);
    });
  });
  referencedFiles.add("options.css");

  await Promise.all(
    Array.from(referencedFiles).map(function (fileName) {
      return readFile(path.join(outputDir, fileName));
    })
  );
}

export async function runBuild(options = {}) {
  const mode = options.mode || "development";
  const outputDir = getOutputDir(mode);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await bundleEntries(outputDir, mode);
  await writeStaticFiles(outputDir, mode);
  await validateOutput(outputDir);
  return outputDir;
}

async function runWatch(mode) {
  let pending = Promise.resolve();
  const rebuild = function () {
    pending = pending
      .catch(function () {})
      .then(function () {
        return runBuild({ mode: mode });
      })
      .then(function (outputDir) {
        console.log("built " + path.relative(ROOT_DIR, outputDir));
      })
      .catch(function (error) {
        console.error(error);
      });
  };

  rebuild();
  const watcher = watch(ROOT_DIR, { recursive: true });
  for await (const event of watcher) {
    const fileName = String(event.filename || "").split(path.sep).join("/");
    if (fileName.startsWith("src/")) {
      rebuild();
    }
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.watch) {
    await runWatch(options.mode);
  } else {
    const outputDir = await runBuild(options);
    console.log("built " + path.relative(ROOT_DIR, outputDir));
  }
}
