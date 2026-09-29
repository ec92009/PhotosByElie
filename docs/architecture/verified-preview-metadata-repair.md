# Verified preview metadata repair

Use this bounded native maintenance path when an existing public preview's
SHA256 still matches its verified receipt, but its recorded byte count is stale.
It is not an upload, source-adoption, approval, lifecycle or identity operation.

The request contains sorted, unique `mediaIds` (1–20) and an explicit owner
`authorization` reference. Read-only preparation binds the current catalog,
native source/publication, fixture policy and edition, exact receipts and R2
inventory. Authenticated full GETs must match existing hashes and dimensions.
Any changed image, missing authority or public/local catalog mismatch stops it.

Run the installed signed Backstage OwnerRuntime entry point:

```text
python3 verified_preview_metadata_repair.py --repo-root <canonical-repo> --request <request.json>
python3 verified_preview_metadata_repair.py --repo-root <canonical-repo> --apply-plan <saved-plan.json> --approved-plan-sha256 <reviewed-hash>
```

Persist and inspect the first command's JSON before the second. Production
apply requires the existing sealed installed-runtime and enrollment checks.
It re-fetches every preview and repeats local authority checks under a write
transaction. Only preview receipt/inventory byte metadata, existing catalog
preview byte cells, the affected catalog-publication pending status, and a
durable `verified_preview_metadata_repairs` audit row can change. The audit
preserves the complete prior rows and exact plan. Existing image bytes, IDs,
source versions, approvals, fixture delivery states and private masters remain
unchanged. Identical apply retries return the historical receipt without writes.

A prepared catalog is **not deployed**. Use the existing guarded projection
export, publication validation, normal website deployment and full-byte deployed
verification. Then rerun whole-subject readiness. A receipt or replay never
asserts current readiness, native upload completion or FIFO completion.
