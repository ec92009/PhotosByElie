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
not be replayed or erased. This report does not authorize applying the proposed
states; an operator-reviewed, transactionally tested mutation remains a
separate gate.
