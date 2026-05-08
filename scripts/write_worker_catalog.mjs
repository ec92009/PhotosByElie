#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const sandbox = { window: {}, console, Intl };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(repoRoot, "photos-data.js"), "utf8"), sandbox);

const lines = [
  `export const collections = ${JSON.stringify(sandbox.window.photosByElieData || {}, null, 2)};`,
  `export const resolutions = ${JSON.stringify(sandbox.window.photosByElieResolutions || [], null, 2)};`,
  `export const frameOptions = ${JSON.stringify(sandbox.window.photosByElieFrameOptions || [], null, 2)};`,
  "",
];

const output = path.join(repoRoot, "worker", "photos-catalog.generated.mjs");
fs.writeFileSync(output, lines.join("\n"));
console.log(path.relative(repoRoot, output));
