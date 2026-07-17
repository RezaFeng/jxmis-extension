import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { runBuild } from "./build.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_DIR = path.join(ROOT_DIR, "release");
const ARCHIVE_PATH = path.join(RELEASE_DIR, "jxmis-extension.zip");

await runBuild({ mode: "production" });
await mkdir(RELEASE_DIR, { recursive: true });
await rm(ARCHIVE_PATH, { force: true });

await new Promise(function (resolve, reject) {
  const output = createWriteStream(ARCHIVE_PATH);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on("close", resolve);
  output.on("error", reject);
  archive.on("warning", function (error) {
    if (error.code === "ENOENT") {
      console.warn(error.message);
      return;
    }
    reject(error);
  });
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(path.join(ROOT_DIR, "dist"), false);
  archive.finalize();
});

console.log("packaged " + path.relative(ROOT_DIR, ARCHIVE_PATH));
