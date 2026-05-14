# Pinterest Work Artifacts - 2026-05-14

## Post

- Account: `@photosbyelie`
- Board: `Paris and France Photography`
- Topic: `Eglise des Invalides, Paris`
- Status: Drafted in Pinterest, not published.

## Copy

Title:

```text
Eglise des Invalides, Paris
```

Description:

```text
Eglise des Invalides, Paris - France, 2022. Travel, architecture, and archive photography by Elie.
```

Alt text:

```text
Eglise des Invalides, Paris, France.
```

## Files

- `downloads.html`: first-party download page for all Pinterest-ready files. Use this instead of downloading files back from Pinterest's embedded browser UI.
- `download-manifest.tsv`: machine-readable list of the downloadable files, labels, and notes.
- `images/staged-single-pin-2x3.jpg`: the single-image Pin asset accepted by Pinterest.
- `images/01-nave.jpg` through `images/05-dome-wide.jpg`: Pinterest-safe `2:3` carousel candidates.
- `source-previews/`: original public preview images used to derive the carousel candidates.
- `contact-sheet.jpg`: generated sheet for the five carousel candidates.
- `source-family-contact-sheet.jpg`: broader Invalides family review sheet.
- `landing-page.html`: non-redirecting Pin landing page used so Pinterest can scrape the image and a page URL.
- Pin destination: `https://ec92009.github.io/PhotosByElie/campaign.html?c=pinterest-invalides-2026-05-14`, a first-party mini-collection with related photos and archive search.

Regenerate the local download page after changing `manifest.json` or staged files:

```bash
npm run social:pinterest-downloads -- --date 2026-05-14
```

## Notes

- Pinterest rejected the original `9:16` R2 preview because standard Pins must be between `2:3` and `1:1`.
- A valid `2:3` crop was generated and attached successfully.
- The carousel builder exposes a local multi-file upload input, but the in-app browser automation does not currently expose a supported file-upload method. Manual upload should use the files in `images/`.
- The current Pinterest browser draft may be in carousel-edit mode after testing; verify the fields before publishing.
- Pinterest should be treated as a publishing target, not the canonical asset store. Keep and reuse the local/published first-party files when a browser control does not expose reliable downloads.
- Buyer checkout and downloads should happen on Photos By Elie in Safari/Chrome. If Pinterest opens the site inside an embedded browser, the campaign/basket/order pages show an Open in browser / Copy link escape path.
