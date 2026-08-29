# PBB-143 RAW-only Photos recovery

Backstage can recover RAW-only Apple Photos assets without changing Photos.
PBB-143 established the rung policy and one accepted private sample. PBB-147
adds a fixed 2,000-photo queue window with durable resume, storage protection,
color-quality quarantine, and explicit Owner discovery after recovery.

## Publication cutoff

Backstage tries these rungs in order and stops at the first technical pass:

1. Photos current rendered image.
2. Embedded JPEG preview in the RAW resource.
3. Deterministic Core Image RAW development.

A pass must be a correctly oriented sRGB JPEG with at least one million real
pixels and dimensions no larger than the RAW source (including its rotated
orientation). Backstage never upscales. The generated receipt lists only the
1MP, 3MP, and 6MP products supported by the resulting pixels.

Technical success is not publication. Every derivative is `needs-review`; Review
must approve image quality, title, keywords, and place before Uploads can ever
consider it. Rung 2 remains camera-sampled and rung 3 remains visually gated
until representative camera recipes are accepted.

## Operator surface

```text
backstage-control photos raw-recovery plan --sample-limit 8 --pretty
backstage-control photos raw-recovery sample --asset-id <Photos-local-ID> --pretty
backstage-control photos raw-recovery batch start --max-items 2000 --reserve-gb 15 --pretty
backstage-control photos raw-recovery batch status --pretty
backstage-control photos raw-recovery batch resume --max-items 2000 --pretty
backstage-control photos raw-recovery batch cancel --pretty
backstage-control photos raw-recovery batch index --pretty
```

The plan reads PhotoKit metadata only and reports a deliberately broad storage
range. The sample command accepts exactly one RAW-only local Photos identifier.
The batch command snapshots no more than 2,000 previously unprocessed RAW-only
identities. It writes owner-only JPEGs, per-photo receipts, an active manifest,
and a compact lifetime ledger below Backstage Application Support. Every photo
is checkpointed before the next starts, so interruption and retry do not replay
completed work.

After completion, `batch index` emits only that window's receipted PhotoKit
rows. Owner can enroll the exact recovered identities without repeatedly
paging and rescanning the complete Photos library.

Before each photo, Backstage checks the destination's capacity and pauses when
available storage reaches the configured reserve (15 GB by default). A custom
absolute destination is supported. The accepted RAW source remains unchanged
in Photos.

## Blue/cyan cast quarantine

Each generated JPEG is sampled in sRGB. The detector evaluates neutral
midtones, not overall blue dominance, so a saturated blue sky or body of water
does not by itself trigger quarantine. Too few neutral pixels produces an
`inconclusive` result. A systematic cool displacement in neutral pixels records
`quarantined-blue-cast`. Both passing and quarantined files remain human Review
items; nothing is auto-approved or auto-published.

## Owner discovery and storage lifecycle

The recovery ledger makes a valid generated JPEG an accepted Photos source for
Backstage indexing. Its index row records the batch, checksum, rung, quality
verdict, and mandatory Review gate. Gallery and Uploads use the receipted JPEG,
not the RAW resource. The ledger is retained after a derivative is eventually
removed so later 2,000-photo windows cannot select the same RAW source again.

Publication and rejection remain normal Owner workflow decisions. Removing a
processed local derivative is allowed only after the corresponding verified
upload or explicit rejection receipt; the compact manifest and ledger remain
as durable lineage.
