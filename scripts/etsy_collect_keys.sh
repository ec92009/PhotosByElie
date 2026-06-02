#!/usr/bin/env bash
set -euo pipefail

config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/photosbyelie"
env_file="${ETSY_ENV_FILE:-$config_dir/etsy-env.sh}"

quote_for_shell() {
  local value="${1-}"
  printf "%q" "$value"
}

prefix3() {
  local value="${1-}"
  printf "%s" "${value:0:3}"
}

prompt_secret() {
  local prompt="$1"
  local value
  read -r -s -p "$prompt" value
  printf "\n" >&2
  printf "%s" "$value"
}

printf "PhotosByElie Etsy API credential setup\n"
printf "Values are written to %s with 0600 permissions.\n\n" "$env_file"

read -r -p "Etsy keystring: " etsy_keystring
etsy_shared_secret="$(prompt_secret "Etsy shared secret: ")"

if [[ -z "$etsy_keystring" ]]; then
  printf "Error: Etsy keystring cannot be empty.\n" >&2
  exit 1
fi

if [[ -z "$etsy_shared_secret" ]]; then
  printf "Error: Etsy shared secret cannot be empty.\n" >&2
  exit 1
fi

mkdir -p "$config_dir"
chmod 700 "$config_dir"
umask 077

{
  printf "# PhotosByElie Etsy API credentials. Source this file locally; do not commit it.\n"
  printf "export ETSY_KEYSTRING=%s\n" "$(quote_for_shell "$etsy_keystring")"
  printf "export ETSY_SHARED_SECRET=%s\n" "$(quote_for_shell "$etsy_shared_secret")"
} > "$env_file"
chmod 600 "$env_file"

printf "\nSaved Etsy credentials outside the repo.\n"
printf "ETSY_KEYSTRING first 3: %s\n" "$(prefix3 "$etsy_keystring")"
printf "ETSY_SHARED_SECRET first 3: %s\n" "$(prefix3 "$etsy_shared_secret")"
printf "\nNext local step:\n"
printf "  source %s\n" "$env_file"
printf "  npm run etsy:oauth -- --auth-url\n"
