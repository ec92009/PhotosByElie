# Repo And Media Cleanup SOP

Use this SOP before proposing or applying repository cleanup, media movement, or ignored-artifact removal in PhotosByElie.

## Ground Rules

- Do not use GitHub as a general media vault. Git should hold code, small metadata, public-safe context bundles, tiny brand assets, public documentation, and the active public catalog artifacts.
- Keep GitHub Pages serving from the repository root. Do not move root HTML into `docs/`, create a mirror, or remove root HTML as part of cleanup while Pages serves `main` at `/`.
- Treat `assets/catalog/photosbyelie.sqlite` as the active public catalog artifact. Do not delete it or replace it with `photos-data.js` alone.
- Treat `assets/catalog/photosbyelie.sqlite.br` as retained legacy-only catalog history. Do not regenerate it in normal catalog or cleanup work.
- Keep large public preview media, private masters, private renders, Real Estate originals, generated deliverables, and disposable import/cache work out of Git unless a tracked asset is deliberately approved as small and durable.
- Keep Owner-private workflow state local or private: `assets/owner-actions/Owner.sqlite`, its WAL/SHM sidecars, `assets/hidden/`, Real Estate client credentials, Pixelmator edit folders, local review logs, and credentials must not be committed.

## Safe Cleanup Workflow

1. Start with `git status --short --ignored` from the repo root and classify changes as tracked, untracked, or ignored.
2. For ignored scratch cleanup, run `python3 scripts/clean_local_ignored.py` first. Review the dry-run output before using `--apply`.
3. Archive borderline local artifacts instead of deleting them. The helper archives under `../PhotosByElie-local-archive/` by default.
4. For any tracked-file cleanup proposal, write down the file path, approximate size, current runtime role, replacement home, and rollback plan before touching it.
5. Require explicit owner approval before deleting or moving tracked public catalog artifacts, root HTML, public-safe Real Estate contexts, public music assets, or any asset whose runtime role is uncertain.
6. After any actual cleanup, run the relevant validation:
   - `npm test`
   - `npm run validate`
   - `git diff --check`

## Placement Guide

- Root HTML, CSS, JS, public metadata, and `assets/catalog/photosbyelie.sqlite`: keep in Git.
- Large public preview media: store in public R2/CDN, referenced through catalog keys and `media-config.js`.
- Private masters, private renders, paid delivery files, and Real Estate originals: store in private R2 or local source storage, never Git.
- Import/render caches, local screenshots, Playwright artifacts, local delivery ZIPs, and temporary review logs: keep ignored; archive or regenerate as needed.
- Owner workflow state: keep in ignored SQLite/local files or private R2 sync snapshots, never GitHub Pages.

## Completion Check

A cleanup ticket is complete only when the repo remains pushable, GitHub Pages root serving is preserved, active public catalog artifacts are still present, and any large/private media decision has an explicit storage home outside Git.
