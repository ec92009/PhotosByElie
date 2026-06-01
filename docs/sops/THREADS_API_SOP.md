# Threads API SOP

Use this SOP when moving PhotosByElie Threads publishing from browser/manual posting toward the official Threads API.

## Current Status

- The repo has a dry-run-first Threads publisher at `scripts/threads_api_publish.mjs`.
- The repo has a Threads OAuth helper at `scripts/threads_oauth.mjs`.
- Live API publishing is disabled unless `--publish` is passed.
- Secrets are never stored in the repo. OAuth tokens are stored outside the repo at `~/.config/photosbyelie/threads-token.json` with `0600` permissions.
- Threads is treated as a separate API path from Facebook Page and Instagram publishing, even though it is under Meta.

## Threads App Setup

1. In Meta for Developers, create or open the Photos By Elie social publishing app.
2. Add the Threads API product or the current Meta UI equivalent.
3. Add a redirect URI. For local OAuth testing, use:

```text
http://localhost/
```

4. Keep the app id and app secret outside the repo. For a one-session setup:

```bash
export THREADS_APP_ID='...'
export THREADS_APP_SECRET='...'
export THREADS_REDIRECT_URI='http://localhost/'
```

## Permission Targets

Start with the smallest set needed for profile lookup and publishing:

- `threads_basic`
- `threads_content_publish`

Meta may rename or split permissions as products change. Use the current names shown in the Meta app dashboard if they differ.

## OAuth

Generate the Threads authorization URL:

```bash
npm run social:threads-oauth -- --auth-url
```

Open the URL, approve access, and copy the returned `code` from the redirect URL. Then exchange it:

```bash
npm run social:threads-oauth -- --exchange-code '<returned-code>'
```

The helper exchanges the code and attempts to convert the token to a long-lived token. It prints only redacted token metadata.

Check local token metadata:

```bash
npm run social:threads-oauth -- --token-status
```

## Discover Threads User ID

After a token exists:

```bash
npm run social:threads-api -- --profile
```

Record the returned Threads user id locally, not in public copy:

```bash
export THREADS_USER_ID='...'
```

Some Threads API calls may accept `me`; use the explicit id if `me` is rejected.

## Dry Run

Threads package:

```bash
npm run social:threads-api -- \
  --manifest socials/Threads/2026-05-27/setenil-rock-streets/manifest.json \
  --threads-user-id "$THREADS_USER_ID"
```

Confirm:

- all media URLs are public watermarked R2 URLs
- the destination/caption is first-party PhotosByElie copy
- the post is a single image or carousel with no more than 10 images
- the link preview note is respected before live posting

## Publish

Only publish after dry-run output is correct:

```bash
npm run social:threads-api -- \
  --manifest socials/Threads/2026-05-27/setenil-rock-streets/manifest.json \
  --threads-user-id "$THREADS_USER_ID" \
  --publish
```

After publishing, verify the live result in a browser and update the Threads package manifest/README with published status and URL.

## Source Docs

- Threads API: https://developers.facebook.com/docs/threads/
- Threads publishing reference: https://developers.facebook.com/docs/threads/reference/publishing/
