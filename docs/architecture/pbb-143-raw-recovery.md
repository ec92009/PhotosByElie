# PBB-143 RAW-only Photos recovery

Backstage can evaluate RAW-only Apple Photos assets without changing Photos or
the canonical Owner database. The initial release intentionally exposes only a
read-only census and one explicitly selected private sample.

## Publication cutoff

Backstage tries these rungs in order and stops at the first technical pass:

1. Photos current rendered image.
2. Embedded JPEG preview in the RAW resource.
3. Deterministic Core Image RAW development.

A pass must be a correctly oriented sRGB JPEG with at least one million real
pixels and dimensions no larger than the RAW source (including its rotated
orientation). Backstage never upscales. The generated receipt lists only the
1MP, 3MP, and 6MP products supported by the resulting pixels.

Technical success is not publication. Every sample is `needs-review`; Review
must approve image quality, title, keywords, and place before Uploads can ever
consider it. Rung 2 remains camera-sampled and rung 3 remains visually gated
until representative camera recipes are accepted.

## Operator surface

```text
backstage-control photos raw-recovery plan --sample-limit 8 --pretty
backstage-control photos raw-recovery sample --asset-id <Photos-local-ID> --pretty
```

The plan reads PhotoKit metadata only and reports a deliberately broad storage
range. The sample command accepts exactly one RAW-only local Photos identifier,
writes an owner-only JPEG and JSON receipt below Backstage Application Support,
and is checksum-idempotent on retry. The receipt records source lineage, rung,
dimensions, sRGB, checksum, available products, failed earlier rungs, and the
mandatory Review state.

Bulk recovery, Owner enrollment, Photos write-back, and publication remain
disabled until representative live samples are visually accepted.
