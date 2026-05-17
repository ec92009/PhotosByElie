#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");

const usage = () => {
  console.error("Usage: node scripts/view_sqlite_br.cjs <file.sqlite.br> [--no-open]");
};

const args = process.argv.slice(2);
const noOpen = args.includes("--no-open");
const inputArg = args.find((arg) => arg !== "--no-open");

if (!inputArg) {
  usage();
  process.exit(2);
}

const inputPath = path.resolve(inputArg);
if (!inputPath.endsWith(".sqlite.br")) {
  console.error(`Expected a .sqlite.br file, got: ${inputPath}`);
  process.exit(2);
}

const compressed = fs.readFileSync(inputPath);
let sqliteBytes;
try {
  sqliteBytes = zlib.brotliDecompressSync(compressed);
} catch (error) {
  console.error(`Could not Brotli-decompress ${inputPath}: ${error.message}`);
  process.exit(1);
}

if (!sqliteBytes.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
  console.error(`Decoded file is not a SQLite 3 database: ${inputPath}`);
  process.exit(1);
}

const outputDir = path.resolve("tmp", "vscode-sqlite-br");
const outputName = path.basename(inputPath, ".br");
const outputPath = path.join(outputDir, outputName);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, sqliteBytes);

console.log(`Wrote ${path.relative(process.cwd(), outputPath)} (${sqliteBytes.length.toLocaleString()} bytes)`);

const sqliteCheck = spawnSync("sqlite3", [outputPath, "PRAGMA integrity_check;"], {
  encoding: "utf8",
});
if (sqliteCheck.status !== 0) {
  process.stderr.write(sqliteCheck.stderr || sqliteCheck.stdout);
  process.exit(sqliteCheck.status || 1);
}

const integrity = sqliteCheck.stdout.trim();
if (integrity !== "ok") {
  console.error(`SQLite integrity check failed: ${integrity}`);
  process.exit(1);
}

console.log("SQLite integrity_check: ok");

if (noOpen) process.exit(0);

const code = spawnSync("code", ["--reuse-window", outputPath], { stdio: "ignore" });
if (code.status === 0) process.exit(0);

if (process.platform === "darwin") {
  const opened = spawnSync("open", ["-a", "Visual Studio Code", outputPath], { stdio: "ignore" });
  if (opened.status === 0) process.exit(0);
}

console.log(`Open this file in VS Code: ${outputPath}`);
