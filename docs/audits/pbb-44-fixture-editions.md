# PBB-44 — fixture-owned approval and editions

Approved now belongs to `(fixture, asset, revision)`. An edition owns its selected image version, accepted title, keywords and country. The shared camera original stays immutable. AI requests, proposals, returned After selections, Review Undo, Uploads and catalog projection use the active fixture. An edit revokes only that edition's approval. A queued upload pins its revision and fails if it changes before publication. Different fixtures get distinct object keys and catalog rows.

Give Back is exclusive to the Expo root. Both the app controls and the Photos job capability planner enforce it. Expo writes its approved title and keywords to Apple Photos; an RE upload has export authority only. No new upload or Photos metadata write is performed by this release procedure.

Migration replays the applied Review audit in each operation's own fixture. It never copies a global approval into every membership. An approval without an exact recorded image identity becomes an unreviewed draft. Legacy editorial, delivery and publication records remain available. The migration CLI requires a new verified backup; without `--commit` it migrates only that copy. Stop Backstage before committing the migration.

The final production-copy rehearsal seeded 43,491 editions, replayed 11,608 snapshots, restored 353 explicit approvals and retained 347 exact current upload receipts. RE Marketing has 3 approved After editions and 153 picked photos awaiting Review. All available photos have a source identity. Integrity and foreign-key checks passed. The 4,008 unresolved-source count is historical snapshots, not unique photos.

Validation: 425 native tests and 143 Python tests passed (19 edition/migration/integration, 17 native upload, 20 publication, 63 fixture, 6 Give Back, 5 AI, 13 visual repair). The new tests exercise isolation, scoped Undo, stale queued uploads, per-fixture AI attempt counters, exact After export, non-Expo exclusion from Photos writes, catalog coexistence/recovery, migration idempotence and rollback. Catalog recovery never uploads bytes. Retained legacy receipts keep their old identities; recovery refuses to silently reassign shared legacy keys to a new edition.

Target release: Backstage v265.6, build 351. Installation proof is recorded separately below after signed build, backup, migration and live checks.

A final live migration check additionally requires the legacy current delivery to remain live and its accepted metadata to match before retaining Uploaded. A historical receipt by itself cannot override a later needs-upload state. The added regression passed. All three approved Marketing After editions correctly remain needs-upload.
