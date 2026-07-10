Before starting work, also read parent instruction file `~/Dev/AGENTS.md` if it exists, then apply this repo file last.

# AGENTS.md

Repo-level working preferences for `/Users/ecohen/Dev/PhotosByElie`.

## Response Protocol

- For Max/David machine handoff or ignored asset sync work, read [`HANDOFF.md`](./HANDOFF.md).
- For "show me" requests, follow [`SHOW_ME_SOP.md`](./SHOW_ME_SOP.md).
- Use [`docs/architecture/north-star.md`](./docs/architecture/north-star.md) as the Photos By Elie project compass; warn when requested work appears to deviate from it unless the deviation is explicit and intentional.
- Keep the active collaboration timelog in [`TIMELOG.md`](./TIMELOG.md) current according to the timelog SOP.

## Max/David Handoff Direction

- Gmail self-email is retired for Max/David handoff instructions and reports; do not search, send, or treat Gmail as authoritative for this workflow unless the user explicitly asks about a specific message.
- Primary Max/David coordination is direct Tailscale/mesh: use the central Tickets API for ticket state, SSH/Codex Remote SSH for remote execution when available, and live mesh/remote channels for Codex-to-Codex delegation.
- `MAX2DAVID.md`, `DAVID2MAX.md`, and `MAX_DAVID_CHAT.md` are legacy/manual fallback records. Do not add new routine prompts there unless the direct Tailscale/mesh route is unavailable or the user explicitly asks for a file-based handoff.
- Commit and push durable fallback handoff-file updates only when the other machine needs to receive that file-based fallback.
- When unsure which machine you are on, run `hostname` and `scutil --get ComputerName` before using any machine-specific path.

## Defaults

- If Python dependencies are introduced, prefer `uv` for environment and package management.

## Repo Workflow

- Run commands from the repo root: `/Users/ecohen/Dev/PhotosByElie`.
- Make small, clear commits with the prefix `photosbyelie:`.
- Use branches for larger changes; preferred branch prefix: `codex/`.

## Versioning

- Follow `~/Dev/.SOPs/VERSIONING_SOP.md`.

## Timelog

- Local SOP: [`docs/sops/TIMELOG_SOP.md`](./docs/sops/TIMELOG_SOP.md).
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

- Before adding new scripts, check whether the repo already contains a file or workflow that solves the task.

## Python Hygiene

- Do not commit virtual environments such as `.venv/`.
- Do not commit Python cache artifacts such as `__pycache__/` or `*.pyc`.
