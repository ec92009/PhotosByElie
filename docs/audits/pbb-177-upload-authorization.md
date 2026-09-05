# PBB-177 — Native upload Photos authority and failure receipts

The owner-started42-asset RE run `uplrun-8d48fbc047624466` completed with17 verified uploads and25 failures on installed v249.8/build322. Read-only inspection of the Upload Bridge ledger showed all25 failed during original export with `photos_job_authorization_required`; their R2 upload stage was never requested. The publication adapter discarded the export error and passed an empty object list to checksum validation.

## Change

Backstage first prepares a durable bounded run, then enqueues its execution as a separate accepted Owner action and polls the run ID. The signed Photos-job planner resolves only that run's queued/uploading/failed asset identities (maximum50 assets), their exact Photos aliases, and the intended approved metadata writes. No authority is needed to prepare a run. Native upload execution remains synchronous inside the sealed app-owned runtime chain; it no longer detaches from the parent that owns/revokes its private pipe capability. Existing expiry, authenticated-session checks, request signatures, operation/identity/write scope, and standalone denial remain intact.

The execution monitor keeps a terminal item snapshot in progress until the Owner action finishes metadata give-back. Launch/action errors are surfaced instead of reporting a completed empty queue. Give-back failures report that receipts were saved but metadata still needs retry. Catalog-only recovery remains its existing receipt-only detached path.

The adapter propagates the originating export or upload error before validating checksum receipts. Empty successful responses still fail closed. No verified object, sale reference, or checksum requirement is weakened.

## Validation

-401 Swift tests/32 suites pass serialized. Parallel runs exposed existing scheduler-sensitive Gallery thumbnail/pending-operation assertions; serialized validation passed without weakening those assertions.
-328 Node and517 Python tests pass, plus50 focused planner/launcher/bridge/connector tests.
-A further real temporary SQLite mixed-batch test exercises the native publication adapter: one verified item plus one authorization failure, then a retry of only the failed item. The original successful receipt remains exactly unchanged.
-Exact-scope planner tests exclude another run and completed items, reject batches over50, bind intended metadata, and give preparation no Photos authority. Existing request signing/replay/expiry/standalone-denial tests remain passing.
-Native tests prove start returns a durable ID before execution completes, terminal item counts wait for give-back, and authorization failures stay actionable.
-Maintainability passes. A new bounded NativeUploadExecutionMonitor owns lifetime/error tracking; only ten net coordinator lines are added to the documented FixtureDeliveryService file ceiling. No function ceiling changes.

Source/test validation is complete. Signed installed verification and any retry of the owner's original failed set are recorded separately below. No website deployment or archive publication is part of this fix.

## Installed retry and persistent export blocks

Signed v250.0/build324 was installed with a retained build322 rollback. Strict signing, Owner authentication, and Photos access passed. A read-only snapshot comparison confirmed the loaded25 assets exactly matched the original failed set. The bounded Upload selection retry `uplrun-6601d44e10c54053` completed25/25 failed with no uploaded items: the bridge excluded all25 because the original export failures left active export blocks. No Photos export or R2 upload was attempted by that retry.

The follow-up allows explicit, nonempty, asset-scoped native retries to revisit export-failure blocks. Unscoped/ordinary queue planning still excludes blocks; other block reasons and metadata readiness still apply. Blocks retain their history and are cleared only by the existing successful export path. Scoped filtering precedes the planner limit. A read-only backup of Owner.sqlite evaluated in memory changes the planned set from zero to exactly the original25, with no live database mutation.54 focused tests pass, including block retention, no unscoped bypass, metadata readiness and other block reasons.

## Isolated preview dependency

Build325's exact25-asset retry `uplrun-9d673e8c58b64e09` reached successful Photos export, then failed preview generation because isolated system Python has no Pillow. The bounded batch completed with25 failures and no verified publication successes. Some private object uploads can precede preview failure; the existing checksum/coverage guards govern retries. Stop safely was requested after repeated failures; the durable terminal receipt, not that click, determines completion.

Build326 bundles the hash-pinned CPython3.9 arm64 Pillow11.3.0 wheel from PyPI inside signed Resources/PythonDependencies. The existing system interpreter, isolated flags, private capability transport and sealed-runtime signature checks remain unchanged. No user package path is loaded. Build-time installation uses uv with required hashes; a real isolated synthetic preview smoke verifies both900/1800px outputs and watermarks. A pre-build equivalent smoke passed without Photos, R2 or Owner mutations.
