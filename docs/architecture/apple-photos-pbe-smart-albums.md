# Apple Photos PBE metadata and Smart Albums

## Authority and timing

Sidecar is authoritative for culling and editorial state. Apple Photos receives
metadata only through the explicit fixture give-back commit, and only after R2
delivery for the same editorial version is verified. A dry-run is always
available first and lists current values, intended values, and the exact fields
that would change. Source media and unrelated Photos keywords are never
removed.

## Managed fields

The give-back writes the approved Sidecar title to Photos `name`, the approved
caption to Photos `description`, and merges natural-language Sidecar keywords
with these managed keywords:

- `PBE-Rating-N`, where N is 0 through 5;
- `PBE-Color-X` when a color label exists;
- `PBE-Approved` when the asset is both picked and metadata-approved;
- `PBE-Fixture-ID:<stable-fixture-id>` once for each active fixture placement.

On later commits, only keywords with these exact managed prefixes are replaced.
All unrelated Apple Photos keywords remain untouched. `Pick` and `Approved`
remain distinct decisions; only their conjunction emits `PBE-Approved`.

## Recommended Smart Album

Create a macOS Photos Smart Album named **PBE Approved** with the condition
`Keyword is PBE-Approved`. Optional per-fixture Smart Albums use `Keyword is
PBE-Fixture-ID:<stable-fixture-id>`.

Smart Albums are a macOS Photos feature. They may not be creatable or visible in
the same way on iPhone/iPad, so the keywords—not the album UI—are the portable
source of truth.

## Verification

After a commit, Photos is re-read and the title, caption, and complete expected
keyword set must match. Only then is an `apple_photos` verified receipt recorded.
Failures stay independently retryable and do not invalidate an already verified
R2 receipt.
