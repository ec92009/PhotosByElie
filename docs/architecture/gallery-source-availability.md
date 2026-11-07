# Gallery source availability (PBB-194)

`Refresh & discover` checks up to 500 sources in the current Gallery page before
running [PBB-owned persistent discovery](photos-persistent-sync.md). It resolves the exact Photos
identities, without downloading originals or comparing filenames. The resulting
observations update only `sidecar_assets.missing_at` for those identities.

Unknown results and limited Photos access never produce negative observations.
Hidden photos and nonrepresentative burst frames are included in exact lookups.
The SQLite transaction is atomic, idempotent and reversible when an asset is
restored and checked again. Unchecked sources, fixture decisions, publication,
and permanent sales/delivery records are untouched.

The Gallery reload applies the existing Source filters. Its default Available
filter removes unavailable sources; choose Source / Unavailable to inspect and
recheck unavailable entries. A failed Quick Look also checks the current page
and reloads it when Photos explicitly cannot resolve the source. Permission,
download, timeout and rendering failures are not treated as deletion.

`Full library audit` explicitly rebuilds PBB's complete inventory. An asset
missing from an incremental discovery subset is never sufficient evidence that
it has been removed. A full audit can take several minutes on a large library.

Missing-source guidance explains how to restore a deleted photo in Photos rather
than promising that waiting for synchronization will recover it. Normal refresh
clears the prior preview error and holds the Photos-operation latch throughout
source verification and recent discovery, including failure paths.

Verification lives in `PhotoSourceAvailabilityTests`: exact scope, unknown
observations, restoration, idempotence, transaction rollback, size bounds and
the refresh duplicate/failure interlocks.
