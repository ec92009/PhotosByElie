# Etsy API SOP

Use this SOP for Photos By Elie Etsy API setup and listing-publisher work.

## Current Status

- Etsy approved the `photosbyelie-listing-publisher` API integration by email on 2026-06-01 at 20:54 UTC.
- Keep the Etsy app keystring, shared secret, OAuth codes, and OAuth tokens outside git.
- Local token files live under `~/.config/photosbyelie/` with `0600` permissions.
- The first-party OAuth redirect page is `https://photos-by-elie.com/etsy-callback.html`.

## References

- Etsy OAuth guide: `https://developers.etsy.com/documentation/essentials/oauth2`
- Etsy authentication guide: `https://developers.etsy.com/documentation/essentials/authentication`
- Etsy API reference: `https://developers.etsy.com/documentation/reference`

## OAuth Setup

1. In Etsy developer settings, add this redirect URI:
   `https://photos-by-elie.com/etsy-callback.html`
2. Collect the approved app keystring and shared secret locally:
   `npm run etsy:collect-keys`
3. Source the generated local env file:
   `source ~/.config/photosbyelie/etsy-env.sh`
4. Generate the authorization URL:
   `npm run etsy:oauth -- --auth-url`
5. Open the returned URL, approve access, and copy the returned `code` from `etsy-callback.html`.
6. Exchange the code locally:
   `npm run etsy:oauth -- --exchange-code '<code>'`
7. Check redacted token status:
   `npm run etsy:oauth -- --token-status`

The collection helper writes `~/.config/photosbyelie/etsy-env.sh` with `0600` permissions and prints only the first three characters of each value for verification. The OAuth helper uses PKCE and saves the verifier/state outside the repo. It never prints tokens.

## API Smoke Check

Source the local env file before live checks:

```sh
source ~/.config/photosbyelie/etsy-env.sh
npm run etsy:api-check -- --me
```

The API checker sends `Authorization: Bearer <token>` and `x-api-key: <keystring>:<shared_secret>`.
It never prints either credential.

## Listing Publisher Guardrails

- Use public Photos By Elie catalog data, public R2 watermarked previews, and first-party campaign/gallery URLs only.
- Do not use private masters, unwatermarked renders, buyer downloads, Owner-only metadata, ignored Owner review JSON, or secrets in Etsy listing content.
- Start with draft listing creation or dry-run payload generation before live publishing.
- Prefer finished wall-art candidates with clear place, atmosphere, visual quality, and material/size confidence.
- Record listing IDs, URLs, image counts, destination URLs, and any Etsy-visible validation errors in local package notes.
