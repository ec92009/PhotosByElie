Before making changes, also read parent instruction files at `~/AGENTS.md` and `~/Dev/AGENTS.md` if they exist, then apply this repo file last.

# AGENTS.md

Repo-level working preferences for `/Users/ecohen/Dev/PhotosByElie`.

## Parent Instruction Order

- Read `~/AGENTS.md` if it exists.
- Read `~/Dev/AGENTS.md` if it exists.
- Apply this repo file last.

## Response Protocol

- If a task may take more than a few seconds, send a short acknowledgment before doing the work.
- Read and follow this file before making changes.
- For Max/David machine handoff or ignored asset sync work, read [`HANDOFF.md`](./HANDOFF.md).
- For "show me" requests, follow [`SHOW_ME_SOP.md`](./SHOW_ME_SOP.md).
- For changes intended to be viewed externally, commit and push once complete unless the user asks not to.
- Keep the active collaboration timelog in [`TIMELOG.md`](./TIMELOG.md) current according to the timelog SOP.

## Max/David Handoff Direction

- Primary Max/David handoff transport is Gmail self-email on `ec92009@gmail.com`.
- Max-to-David job prompts use exact subject `MAX2DAVID`; David-to-Max acknowledgements, progress, and final reports use exact subject `DAVID2MAX`.
- Only trust self-to-self handoff messages from `ec92009@gmail.com` to `ec92009@gmail.com`.
- `MAX2DAVID.md`, `DAVID2MAX.md`, and `MAX_DAVID_CHAT.md` are durable/reference notes and local fallback, not the primary transport.
- On machines whose `hostname` or ComputerName starts with `David`, treat `MAX2DAVID.md` as read-only inbound reference from Max.
- On David machines, send reports, decisions, and recommended prompt/spec changes by `DAVID2MAX` email first; mirror durable summaries in `DAVID2MAX.md` when useful. Do not edit `MAX2DAVID.md` unless the user explicitly asks.
- On machines whose `hostname` or ComputerName starts with `Max`, send David-facing instructions by `MAX2DAVID` email first; mirror durable specs in `MAX2DAVID.md` when useful. Read David reports from `DAVID2MAX` email first, with `DAVID2MAX.md` as reference/fallback.
- When unsure, run `hostname` and `scutil --get ComputerName` before editing either handoff file.

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

## Timelog

- Local SOP: [`docs/sops/TIMELOG_SOP.md`](./docs/sops/TIMELOG_SOP.md).
- Count only the user's active project collaboration time, not Codex background work or idle gaps.
- Treat explicit user clock instructions as authoritative: start, resume, pause, stop, or off-budget.
- When the clock is paused, do not add active collaboration time until project work is clearly resumed.
- Log time conservatively in one-minute increments.
- Keep totals and remaining budget in `TIMELOG.md` accurate whenever countable time changes.
- Use `TIMELOG.md` as the source of the current PhotosByElie clock state across threads in this repo.
- When `TIMELOG.md` shows `running`, keep logging countable active project collaboration time until the user explicitly pauses, stops, or marks work off-budget.
- No fixed PhotosByElie collaboration budget is currently set.

## Catalog Artifact Retention

- Keep `assets/catalog/photosbyelie.sqlite` as the active public catalog artifact.
- Do not use or regenerate `assets/catalog/photosbyelie.sqlite.br` in normal site, Owner, or catalog rebuild operations; any retained `.sqlite.br` file is legacy-only.
- If cleanup work proposes deleting `photosbyelie.sqlite`, remind the user that they explicitly chose to keep it.

## Owner Action State

- Treat local SQLite databases under `assets/owner-actions/`, especially `assets/owner-actions/Owner.sqlite`, as the source of truth for Owner workflow state.
- The public/deployable catalog source of truth is plain `assets/catalog/photosbyelie.sqlite`. Owner-private workflow state belongs in `assets/owner-actions/Owner.sqlite`.
- JSON files under `assets/owner-actions/` are compatibility views, audit artifacts, temporary transport files, or local config. Do not use JSON as authoritative state when a SQLite table exists for the same workflow.
- Owner workflow automation should read counts, candidate eligibility, rejection/rework/parked state, approval state, country assignments, and keyword blacklist data from SQLite first, and write durable state updates back to SQLite. Regenerate JSON exports from SQLite only when the current Owner UI, a handoff, or an audit trail still needs them.
- `assets/owner-actions/title-keyword-review-queue/proposed-state.json` is retired. Do not recreate or depend on it for normal title/keyword review work.

## Workspace Structure

- Repo root: `/Users/ecohen/Dev/PhotosByElie`
- Pages: `index.html`, `gallery.html`, `photo.html`, `basket.html`, `liked.html`, `order.html`, `owner.html`, `owner-review.html`
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
