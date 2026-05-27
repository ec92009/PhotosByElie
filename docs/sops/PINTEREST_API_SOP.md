# Pinterest API SOP

Use this SOP when moving a prepared PhotosByElie Pinterest package from browser publishing toward the official Pinterest API.

## Current Status

- The repo has a dry-run-first API publisher at `scripts/pinterest_api_publish.mjs`.
- Live API publishing is disabled unless `--publish` is passed.
- Secrets are never stored in the repo. Provide tokens through the shell environment only.
- The current API model creates one standard image Pin per staged image. The Pinterest UI can present a multi-image builder flow, but the documented organic API path centers on image/video Pins saved to boards.

## Pinterest App Setup

1. Log in to the Photos By Elie Pinterest business account.
2. Open Pinterest Developers > My apps and connect/register an app.
3. Request access and wait for approval when Pinterest requires review.
4. Configure an OAuth redirect URI exactly as registered in Pinterest.
5. Generate an access token with at least:
   - `boards:read`
   - `pins:read`
   - `pins:write`
   - `user_accounts:read`
6. Keep the app id, app secret, redirect URI, and token outside the repo. For a one-session setup:

```bash
export PINTEREST_CLIENT_ID='...'
export PINTEREST_CLIENT_SECRET='...'
export PINTEREST_REDIRECT_URI='http://localhost/'
```

Generate the Pinterest authorization URL:

```bash
npm run social:pinterest-oauth -- --auth-url
```

Open the returned URL, approve access, and copy the returned `code` from the redirect URL. Then exchange it:

```bash
npm run social:pinterest-oauth -- --exchange-code '<returned-code>'
```

The token JSON is saved outside the repo at `~/.config/photosbyelie/pinterest-token.json` with `0600` permissions. The script prints only redacted token metadata, never the token itself.

Check the local token metadata:

```bash
npm run social:pinterest-oauth -- --token-status
```

Refresh the token when needed:

```bash
npm run social:pinterest-oauth -- --refresh
```

## Board Mapping

List boards after a token is available:

```bash
npm run social:pinterest-api -- --list-boards
```

Use the returned board id for the intended board:

```bash
export PINTEREST_BOARD_ID='1234567890'
```

For today's Gibraltar package, the intended board label is `Spain Travel Photography`.

## Dry Run

Always inspect the generated request bodies before publishing:

```bash
npm run social:pinterest-api -- \
  --manifest socials/Pinterest/2026-05-27/gibraltar-rock-and-bay-views/manifest.json \
  --board-id "$PINTEREST_BOARD_ID"
```

Confirm:

- the account is `@photosbyelie`
- the board label matches the chosen board id
- each `media_source.url` is a public watermarked R2 URL
- each `link` points to the first-party PhotosByElie campaign or gallery destination
- the generated pin count matches the package image count

## Publish

Only publish after the dry-run output is correct:

```bash
npm run social:pinterest-api -- \
  --manifest socials/Pinterest/2026-05-27/gibraltar-rock-and-bay-views/manifest.json \
  --board-id "$PINTEREST_BOARD_ID" \
  --publish
```

After publishing, verify the returned Pinterest Pin URLs in a browser and update the package manifest/README with the published status and URLs.

## Source Docs

- Pinterest app connection and OAuth setup: https://developers.pinterest.com/docs/getting-started/connect-app/
- Pinterest boards and Pins guide: https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/
