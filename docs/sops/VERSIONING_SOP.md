# Versioning SOP

- This project follows the canonical versioning procedure from `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`.
- Apply it when the public Photos By Elie site, gallery pages, carousel behavior, viewer UX, or any other user-visible surface changes.
- Do not treat local experiment runs, mock-content drafts, one-off generated files, or repo-only documentation changes as automatic version bumps by themselves.
- Use visible app versions in the form `vX.Y`.
- Use bare `X.Y` in repo metadata such as the top-level `VERSION` file.
- `X` is the number of days since `2026-02-28`.
- `Y` increments with each user-visible build on that same day.
- The site badges and cache-bust query strings should read from the same intended version source.
- At the end of each viewer-facing cycle, report:
- localhost URL only if a local server is actually running
- LAN URL only when available
- GitHub Pages URL only if a live viewer is actually active
- the exact new version to expect on those active surfaces
