# AGENTS.md

Repo-level working preferences for `/Users/ecohen/Dev/PhotosByElie`.

## Response Protocol

- If a task may take more than a few seconds, send a short acknowledgment before doing the work.
- Read and follow this file before making changes.
- For "show me" requests, follow [`SHOW_ME_SOP.md`](./SHOW_ME_SOP.md).
- For changes intended to be viewed externally, commit and push once complete unless the user asks not to.

## Defaults

- Prefer `rg` and `rg --files` for search.
- Prefer small, direct edits over broad refactors.
- Prefer Python for one-off scripts and automation tasks.
- If Python dependencies are introduced, prefer `uv` for environment and package management.

## Repo Workflow

- Run commands from the repo root: `/Users/ecohen/Dev/PhotosByElie`.
- Make small, clear commits with the prefix `photosbyelie:`.
- Default to keeping `main` pushable.
- Use branches for larger changes; preferred branch prefix: `codex/`.
- After modifying the site, update documentation when needed.

## Versioning

- Canonical procedure lives in `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`.
- Local copy/adaptation lives in [`docs/sops/VERSIONING_SOP.md`](./docs/sops/VERSIONING_SOP.md).
- Apply the versioning SOP when the public site, gallery pages, carousel behavior, viewer UX, or another user-visible surface changes.
- Do not treat repo-only documentation changes as automatic visible-version bumps by themselves.
- Update the version badge in the topbar for every user-visible build.
- Also bump CSS and JS cache-bust query strings (`?v=X.Y`) on `shared.css`, `styles.css`, `photos.css`, and `photos.js` in every HTML file.
- Keep `VERSION` as the source of the current visible version number without the leading `v`.

## Workspace Structure

- Repo root: `/Users/ecohen/Dev/PhotosByElie`
- Pages: `index.html`, `france.html`, `usa.html`, `spain.html`, `ai.html`, `photo.html`, `basket.html`
- Styles: `shared.css`, `styles.css`, `photos.css`
- Scripts: `photos.js`, `photos-data.js`, `photo-gallery.js`, `photo-detail.js`, `basket.js`
- Assets: `assets/`

## Local Preview

- Start a local server from the repo root: `python3 -m http.server 8000`
- Home: `http://localhost:8000/`
- For "show me" flows, serve the repo root and report the localhost URL, LAN URL, public GitHub Pages URL, and exact visible UI version called for by `SHOW_ME_SOP.md`.
- Per the canonical versioning SOP, report only URLs for viewer surfaces that are actually active.
- GitHub Pages serves from `main` at `/`; do not recreate a `docs/` mirror.

## Execution Discipline

- Prefer deterministic tooling over manual repetition.
- Before adding new scripts, check whether the repo already contains a file or workflow that solves the task.
- If a task fails, read the full error, fix the cause, and retest.
- Keep secrets out of source files.

## Python Hygiene

- Do not commit virtual environments such as `.venv/`.
- Do not commit Python cache artifacts such as `__pycache__/` or `*.pyc`.

## Safety

- Do not delete or overwrite user files without explicit confirmation.
- Do not rewrite Git history unless explicitly requested.
