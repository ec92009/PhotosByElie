#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (!item.startsWith("--")) continue;
  const [key, inlineValue] = item.slice(2).split("=", 2);
  const value = inlineValue ?? (process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[++index] : "true");
  args.set(key, value);
}

const wranglerToml = fs.existsSync("wrangler.toml") ? fs.readFileSync("wrangler.toml", "utf8") : "";
const workerUrl = String(args.get("worker-url") || process.env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
const offline = args.has("offline");
const results = [];
const activeTomlVar = (name) => new RegExp(`^\\s*${name}\\s*=`, "m").test(wranglerToml);

const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  const marker = ok ? "OK" : "!!";
  console.log(`${marker} ${label}${detail ? ` - ${detail}` : ""}`);
};

const run = (command, commandArgs) => spawnSync(command, commandArgs, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

record(Boolean(wranglerToml), "wrangler.toml present");
record(/ACCESS_ADMIN_EMAIL\s*=\s*"ec92009@gmail\.com"/.test(wranglerToml), "Admin email pinned", "ec92009@gmail.com");
record(activeTomlVar("ACCESS_TEAM_NAME") || process.env.ACCESS_TEAM_NAME || /ACCESS_TEAM_NAME\s*=/.test(wranglerToml), "ACCESS_TEAM_NAME setup noted", activeTomlVar("ACCESS_TEAM_NAME") || process.env.ACCESS_TEAM_NAME ? "active local value" : "documented; set the Cloudflare Access team name before live auth");
record(/npx wrangler secret put ACCESS_AUD/.test(wranglerToml) || process.env.ACCESS_AUD, "ACCESS_AUD setup noted", process.env.ACCESS_AUD ? "env present" : "secret value stays outside git");
record(/pbe:access-users:<email>/.test(wranglerToml), "Access user KV key documented");
record(/pbe:owner-actions:<id>/.test(wranglerToml), "Owner action KV key documented");

if (!offline) {
  const version = run("npx", ["wrangler", "--version"]);
  record(version.status === 0, "Wrangler executable", (version.stdout || version.stderr || "").trim().split(/\n/)[0] || "not found");

  const whoami = run("npx", ["wrangler", "whoami"]);
  record(whoami.status === 0, "Wrangler login", whoami.status === 0 ? "account visible" : (whoami.stderr || whoami.stdout || "").trim().slice(0, 220));

  const secrets = run("npx", ["wrangler", "secret", "list"]);
  const secretText = `${secrets.stdout || ""}\n${secrets.stderr || ""}`;
  record(secrets.status === 0, "Secret list readable", secrets.status === 0 ? "names only" : secretText.trim().slice(0, 220));
  if (secrets.status === 0) {
    record(/\bACCESS_AUD\b/.test(secretText), "ACCESS_AUD secret present");
  }

  if (workerUrl) {
    const health = run("node", ["-e", `
      fetch(${JSON.stringify(`${workerUrl}/health`)})
        .then(async (response) => ({ status: response.status, body: await response.text() }))
        .then((result) => { console.log(JSON.stringify(result)); process.exit(result.status < 500 ? 0 : 1); })
        .catch((error) => { console.error(error.message); process.exit(1); });
    `]);
    record(health.status === 0, "Worker health reachable", workerUrl);
  } else {
    record(true, "Worker health skipped", "pass --worker-url to probe deployed auth host");
  }
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  console.error(`\n${failed.length} access-auth preflight check(s) need attention.`);
  process.exit(1);
}
console.log("\nAccess auth preflight passed.");
