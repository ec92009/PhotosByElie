# PBB-183 / PBB-185 installed verification — 2026-09-20

Installed personal app: **Backstage v263.4 · build 344** at
`/Applications/PhotosByElie Backstage.app`, built from clean source
`83bbd400cb4cc4bc3102da4bd93376a97544a1fb`. Signed with the existing Apple
Development identity. Build 343 first corrected comparison availability; build
344 adds the explicitly selected upscaled delivery rendition. Cloud updater and
public-site deployment were not changed.

## Review comparison availability

- Approved filter exposes all 158 picked RE Marketing photos. The other 156 were
  already globally approved; no picks or approvals were reset to reveal them.
- Exactly D5H_2967.jpg and D5H_2970.jpg have Before / After controls. Normal photos
  have no comparison action. Space on D5H_2968.jpg opened its ordinary Quick Look.
- The selected laundry rendition shows Original / After-upscaled overlay. Left
  moved the divider from 50% to 45% original. The original reference and selected
  edited file both render.

## Explicitly upscaled After selection

The user explicitly authorized upscaling after learning the generator output is
smaller than the originals. The new action was applied individually to both real
photos through the installed UI. Each is now visual-accepted, editorial-approved,
and Needs Upload, using its own 4176×2784 PNG. Original capture references and the
1536×1024 generated drafts have unchanged SHA-256 hashes. Upscaling changes the
pixel dimensions and does not restore original photographic detail.

Uploads shows both edited thumbnails and **AI After · upscaled** labels. The
installed runtime's actual edited-source materializer was exercised locally with
a read-only Owner connection; each exported file checksum equals its selected
rendition receipt. No upload or publication command was invoked.

- **D5H_2970.jpg**: source `srcv-5b88c299be868d52033fb540f417f7c6`, SHA-256 `346ee42c8d5a8e015e7414786d04357184da535f0fd24fc5ae499e5e63340373`.
- **D5H_2967.jpg**: source `srcv-84ab9ee3de294417297530f8cc965daf`, SHA-256 `d017a56ed91af5524f3f9db7d04596336761647467895f0f82a28cfe029ff4da`.

## Regression and state checks

- 13 Swift tests passed: edit-return behavior, real-image upscaling, replay,
  original preservation, exact source binding, stale-source rejection inside
  the return transaction, unreadable/missing/foreign After rejection.
- 9 visual proposal Python tests and 3 edited-source materialization tests passed.
- Release compilation, source manifest, signing verification and signed-runtime
  900/1800-pixel preview smoke passed.
- For the other 156 picked photos, aggregate hashes matched before and after for
  sidecar assets, sidecar decisions, editorial state, delivery state and source
  versions. Their existing workflow records were unchanged.
- Repeated After preparation resolves the same job/version. An interrupted
  approval leaves a recoverable candidate rather than silently uploading an
  original; the existing edit-return file size and checksum checks remain active.
