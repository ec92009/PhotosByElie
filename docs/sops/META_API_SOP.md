# Meta API SOP

Use this SOP when moving PhotosByElie Facebook Page and Instagram publishing toward the official Meta APIs.

## Current Status

- The repo has a dry-run-first Meta publisher at `scripts/meta_api_publish.mjs`.
- The repo has a Meta OAuth helper at `scripts/meta_oauth.mjs`.
- Live API publishing is disabled unless `--publish` is passed.
- Secrets are never stored in the repo. OAuth tokens are stored outside the repo at `~/.config/photosbyelie/meta-token.json` with `0600` permissions.
- The first target is two-platform coverage: Photos By Elie Facebook Page publishing and linked Instagram professional-account publishing.
- Personal Facebook profile reposting is not part of the normal public Pages/Instagram API path and should remain browser/manual.

## Meta App Setup

1. Open Meta for Developers > My Apps.
2. Create or select a Photos By Elie app.
3. Add/configure Facebook Login for Business or the current Meta login flow that exposes Page and Instagram publishing permissions.
4. Add a redirect URI. For local OAuth testing, use:

```text
http://localhost/
```

5. Keep the app id and app secret outside the repo. For a one-session setup:

```bash
export META_APP_ID='...'
export META_APP_SECRET='...'
export META_REDIRECT_URI='http://localhost/'
```

## Permission Targets

Start with the smallest set needed for Facebook Page and Instagram feed publishing:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

Meta may rename or split permissions as products change. Use the current names shown in the Meta app dashboard if they differ.

## OAuth

Generate the Meta authorization URL:

```bash
npm run social:meta-oauth -- --auth-url
```

Open the URL, approve access, and copy the returned `code` from the redirect URL. Then exchange it:

```bash
npm run social:meta-oauth -- --exchange-code '<returned-code>'
```

The helper exchanges the code and attempts to convert the token to a long-lived token. It prints only redacted token metadata.

Check local token metadata:

```bash
npm run social:meta-oauth -- --token-status
```

## Discover Page And Instagram IDs

After a token exists:

```bash
npm run social:meta-api -- --list-pages
```

Record locally, not in public copy:

- the Photos By Elie Page id
- whether a linked `instagram_business_account` id is returned
- whether the token has the expected Page access

## Dry Run

Facebook Page package:

```bash
npm run social:meta-api -- \
  --platform facebook \
  --manifest socials/Facebook/2026-05-27/paris-arts-metiers-mechanical-details/manifest.json \
  --page-id "$META_PAGE_ID"
```

Instagram package:

```bash
npm run social:meta-api -- \
  --platform instagram \
  --manifest socials/Instagram/2026-05-27/setenil-rock-streets/manifest.json \
  --ig-user-id "$META_IG_USER_ID"
```

Confirm:

- all media URLs are public watermarked R2 URLs
- the destination/caption is first-party PhotosByElie copy
- Facebook will create one Page post with attached media
- Instagram will create one feed carousel
- image counts match platform limits

## Publish

Only publish after dry-run output is correct:

```bash
npm run social:meta-api -- \
  --platform facebook \
  --manifest socials/Facebook/2026-05-27/paris-arts-metiers-mechanical-details/manifest.json \
  --page-id "$META_PAGE_ID" \
  --publish
```

```bash
npm run social:meta-api -- \
  --platform instagram \
  --manifest socials/Instagram/2026-05-27/setenil-rock-streets/manifest.json \
  --ig-user-id "$META_IG_USER_ID" \
  --publish
```

After publishing, verify the live result in a browser and update the relevant package manifest/README with published status and URLs.

## Source Docs

- Facebook Pages API posts: https://developers.facebook.com/docs/pages-api/posts/
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Meta long-lived access tokens: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
