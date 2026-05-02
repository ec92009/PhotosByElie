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

- Use visible app versions in the form `vX.Y`.
- `X` is the number of days since `2026-02-28`.
- `Y` increments with each build/change on that same day.
- Example: on `2026-04-18` (day 49), start at `v49.0`, then `v49.1`, `v49.2`, and so on.
- Always bump `Y` for each new build on the same day.
- Update the version badge in the topbar.
- Also bump CSS and JS cache-bust query strings (`?v=X.Y`) on `shared.css`, `styles.css`, `photos.css`, and `photos.js` in every HTML file.
- Keep `VERSION` as the source of the current visible version number without the leading `v`.

## Workspace Structure

- Repo root: `/Users/ecohen/Dev/PhotosByElie`
- Pages: `index.html`, `france.html`, `usa.html`, `spain.html`, `ai.html`
- Styles: `shared.css`, `styles.css`, `photos.css`
- Scripts: `photos.js`
- Assets: `assets/`

## Local Preview

- Start a local server from the repo root: `python3 -m http.server 8000`
- Home: `http://localhost:8000/`
- For "show me" flows, serve the repo root and report the localhost URL, LAN URL, public GitHub Pages URL, and exact visible UI version called for by `SHOW_ME_SOP.md`.
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
