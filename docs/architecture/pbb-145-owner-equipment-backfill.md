# PBB-145 — Owner equipment backfill

## Decision

PhotosByElie Backstage can backfill searchable camera equipment entirely on
the enrolled Mac that owns Photos access. David, Curie, Saturn, the retired
Photos Bridge, and direct `.photoslibrary` database access are not part of the
workflow.

## Boundary

- PhotoKit resolves each exact indexed Owner identity and reads only enough of
  the current still-image resource for ImageIO to expose EXIF/TIFF equipment.
- JPEG/HEIC metadata normally resolves from the first resource chunks, after
  which Backstage cancels the remaining PhotoKit transfer.
- Camera body, lens, and focal length are merged into
  `asset_current_equipment` in Owner.sqlite.
- `asset_equipment_backfill_state` records the exact PhotoKit identity,
  attempts, terminal result, and resumable pending work.
- A checkpoint processes at most 25 photos by default. The explicit Start or
  Resume action continues through repeated checkpoints at utility priority.
  Stop and app termination both cancel the active PhotoKit request while
  preserving every completed checkpoint.
- Explicit retry requeues only unavailable and failed items.

## Non-mutation guarantees

The backfill does not export originals, write Apple Photos metadata, or change
fixture placement, eligibility, editorial state, delivery state, publication,
titles, keywords, ratings, colors, or public catalog data.

Gallery search already joins `asset_current_equipment`; after a batch,
Backstage refreshes the current Gallery window so equipment terms such as
`ELPH` can find newly learned camera bodies immediately.

## Acceptance

Synthetic coverage proves exact cloud/local identity resolution, multi-batch
completion, bounded cancellation and resume, idempotence, retry enrollment,
and preservation of fixture/editorial state. Installed acceptance must
additionally prove multiple bounded PhotoKit checkpoints on Max and a resulting
equipment search without requiring another machine.
