#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Install the Photos By Elie Resend API key as the Cloudflare Worker secret.

Usage:
  scripts/install_resend_api_key.sh [options]

Options:
  --from-clipboard       Read the key from the macOS clipboard instead of prompting.
  --test-to EMAIL        Send a Resend smoke-test email before installing the secret.
  --dry-run              Validate and show the prefix, but do not install the secret.
  -h, --help             Show this help.

Input fallback order:
  1. RESEND_API_KEY environment variable, when set.
  2. macOS clipboard, when --from-clipboard is passed.
  3. Hidden terminal prompt.
  4. stdin, when not running interactively.

The key is never written to the repo or printed in full. The script only prints
the first three characters so you can confirm the right key was captured.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

command -v npx >/dev/null 2>&1 || die "npx is required to run wrangler."

from_clipboard=0
dry_run=0
test_to=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-clipboard)
      from_clipboard=1
      shift
      ;;
    --test-to)
      [[ $# -ge 2 ]] || die "--test-to requires an email address."
      test_to="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

trim_secret() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

resend_key="$(trim_secret "${RESEND_API_KEY:-}")"

if [[ -z "$resend_key" ]]; then
  if [[ "$from_clipboard" -eq 1 ]]; then
    command -v pbpaste >/dev/null 2>&1 || die "pbpaste is required for --from-clipboard."
    resend_key="$(trim_secret "$(pbpaste)")"
  elif [[ -t 0 ]]; then
    printf 'Paste RESEND_API_KEY (input hidden): ' >&2
    IFS= read -r -s resend_key
    printf '\n' >&2
    resend_key="$(trim_secret "$resend_key")"
  else
    IFS= read -r resend_key || true
    resend_key="$(trim_secret "$resend_key")"
  fi
fi

[[ -n "$resend_key" ]] || die "No RESEND_API_KEY was provided."
[[ "${#resend_key}" -ge 8 ]] || die "The captured key is too short."
if [[ "${resend_key:0:3}" != "re_" ]]; then
  printf 'Warning: Resend API keys usually start with "re_"; captured prefix is "%s".\n' "${resend_key:0:3}" >&2
fi

if [[ -n "$test_to" ]]; then
  valid_email "$test_to" || die "Invalid --test-to email address: $test_to"
  command -v node >/dev/null 2>&1 || die "node is required for --test-to."
fi

printf 'Captured key prefix: %s***\n' "${resend_key:0:3}"

if [[ -n "$test_to" ]]; then
  printf 'Sending Resend smoke-test email to %s...\n' "$test_to"
  printf '%s' "$resend_key" | RESEND_TEST_TO="$test_to" node --input-type=module -e '
import fs from "node:fs";
import { createResendEmailClient } from "./worker/resend-email-client.mjs";

const apiKey = fs.readFileSync(0, "utf8").trim();
const to = process.env.RESEND_TEST_TO;
const client = createResendEmailClient({
  apiKey,
  from: "Photos By Elie <orders@photos-by-elie.com>",
  replyTo: "orders@photos-by-elie.com",
});
const result = await client.send({
  to,
  subject: "Photos By Elie Resend delivery test",
  text: "Test email from the Photos By Elie Resend delivery path.",
  html: "<p>Test email from the Photos By Elie Resend delivery path.</p>",
  idempotencyKey: `photosbyelie-resend-test-${Date.now()}`,
});
console.log(`Resend test sent: ${result.messageId || "message id unavailable"}`);
'
fi

if [[ "$dry_run" -eq 1 ]]; then
  printf 'Dry run only; Cloudflare secret was not changed.\n'
  unset resend_key
  exit 0
fi

printf 'Installing Cloudflare Worker secret RESEND_API_KEY...\n'
printf '%s' "$resend_key" | npx wrangler secret put RESEND_API_KEY

if npx wrangler secret list | grep -q '"name": "RESEND_API_KEY"'; then
  printf 'Cloudflare secret RESEND_API_KEY is installed.\n'
else
  die "Wrangler completed, but RESEND_API_KEY was not found in the secret list."
fi

unset resend_key
