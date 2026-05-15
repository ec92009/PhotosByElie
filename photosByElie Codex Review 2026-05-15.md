# photosByElie Codex Review 2026-05-15

1/ General architecture:
- The site has grown into a TSV/catalog-driven static app plus localhost owner tooling and a worker prototype. Keep public catalog code, owner-only actions, and worker checkout code clearly separated.
- `photos.css` and several scripts are large enough that future work should reduce coupling between gallery rendering, owner review, basket state, and campaign pages.

2/ UI:
- The public gallery/detail/basket experience needs consistent visual hierarchy across many pages. Preserve the By Elie language, but avoid owner-tool controls leaking into public surfaces.
- Owner review screens should prioritize dense operational controls, while public pages should prioritize image inspection and purchase confidence.

3/ UX:
- Basket, liked photos, and campaign entry points are now substantial flows. Add explicit empty/error/loading states so static hosting and remote media failures are understandable.
- The owner workflow needs a crisp queue model: unknown classification, waste basket, title/keyword review, and approvals should each have an obvious current count and completion state.

4/ Testing:
- Tests and validation scripts exist. Expand coverage around TSV generation, basket/liked localStorage migration, owner action serialization, and media URL fallbacks.
- Add browser smoke tests for homepage search, gallery open, detail basket toggle, basket total, and owner localhost gating.

5/ Everything else:
- The repo is currently dirty with owner-action and asset-state work. Preserve that work and finish/commit it before undertaking larger architecture changes.
- The README is comprehensive; keep moving deep operational details into `docs/` as it grows.

6/ My suggetions:
1. Finish and commit the current asset/owner-action work before broad refactors.
2. Separate public catalog rendering, owner review tooling, and worker checkout boundaries more explicitly.
3. Add browser smoke tests for homepage, gallery, detail, basket, and owner gating.
4. Add queue counts/completion states to owner review workflows.
5. Move deep operational details from README into focused docs as needed.
