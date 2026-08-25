# PBB-107 legacy workflow disposition

Read-only audit date: 2026-08-24. Source of truth: local `Owner.sqlite`.
The audit intentionally emits aggregates only: no run IDs, asset IDs, file
names, paths, credentials, or row-level data.

Run the reproducible audit with:

```sh
python3 scripts/pbb107_legacy_workflow_audit.py \
  --database assets/owner-actions/Owner.sqlite \
  --strict
```

The command opens SQLite in read-only/query-only mode and performs no mutation.
Strict mode fails closed if any row does not match one of the proven shapes.

## Verified inventory

| Workflow | Proven shape | Count | Evidence | Proposed operator disposition |
| --- | --- | ---: | --- | --- |
| Photos sync | Never started | 19 | `Queued`, zero scanned, no PID/token/lease, `needs-review` | `cancelled` |
| Photos sync | Interrupted before first checkpoint | 2 | Entered metadata reading, zero scanned, no PID/token/lease, `needs-review` | `failed` |
| Upload Bridge | Never exported | 3 runs / 1,832 items | Every item remains planned; no export bytes or upload keys | `cancelled` |
| Upload Bridge | Partially interrupted | 1 run / 500 items | 3 items have durable upload keys; 497 remain untouched | `interrupted`, preserving the 3 successful items |

No row falls outside those shapes. The 3 successful historical uploads must
not be replayed or erased.

## Copy-only transaction rehearsal

The operator approved a transaction-only rehearsal on an exact copy on
2026-08-25. The rehearsal tool refuses the source database as its target,
requires the copied file to have the source file's starting SHA-256, applies
all dispositions in one SQLite transaction, and fails closed with a complete
rollback if any running row does not match a proven shape.

Run it only after making a private exact file copy:

```sh
python3 scripts/pbb107_legacy_workflow_rehearsal.py \
  --source-database assets/owner-actions/Owner.sqlite \
  --copied-database /private/path/Owner.rehearsal.sqlite
```

The approved rehearsal passed: all 21 Photos runs and 4 Upload Bridge runs
became terminal in the copy, all 2,332 Upload Bridge item rows remained
value-identical, the 3 durable uploads and 2,329 untouched items were
preserved, and the canonical database SHA-256 remained identical before and
after. The aggregate receipt is retained in
`docs/rehearsals/pbb-107-legacy-workflow-disposition.json`.

## Approved canonical application

The operator separately approved canonical application on 2026-08-25. Before
the write, the tool created and integrity-checked a private SQLite online
backup, then confirmed that SQLite's data version had not changed while the
backup was being made. It acquired an immediate write transaction only after
those checks and reused the same fail-closed classification and mutation logic
as the copy-only rehearsal.

The canonical transaction applied the approved aggregate dispositions: 19
Photos runs became `cancelled`, 2 became `failed`, 3 Upload Bridge runs became
`cancelled`, and 1 partial bridge run became `interrupted`. Post-commit strict
audit found zero running or ambiguous legacy rows. Both canonical and rollback
databases passed `PRAGMA integrity_check`; the rollback database retained the
complete pre-write 19/2 and 3/1 inventory. All 10,360 Upload Bridge item rows
were identical between canonical and rollback databases, including the 2,332
rows in scope, the 3 durable uploaded rows, and the 2,329 untouched rows.

The verified private rollback backup remains retained beside `Owner.sqlite`.
The aggregate canonical receipt is
`docs/rehearsals/pbb-107-legacy-workflow-apply.json`. This disposition does not
by itself complete PBB-107's separate future-retry prevention and acceptance
scope.
