# Resumable public publication (PBB-191)

An explicitly started, edition-pinned public native upload run now owns four
separate stages: upload, lifecycle registration, catalog deployment and exact
public-access verification. An upload-complete receipt alone is not completion.
Private fixtures retain their existing private upload behavior. Historical and
catalog-recovery runs are not automatically enrolled or drained.

`public_publication_runs` and `public_publication_items` are app-owned SQLite
continuation records scoped to one existing run and its approved revisions.
They retain the prepared registration envelope before apply, current cloud
receipt, catalog receipt and per-photo verification result. The native status
overlay keeps the operation running through all stages and offers **Retry same
run** after failure or safe cancellation, even when zero photos need uploading.
The normal UI latch remains synchronous and a public-stage failure stops queue
continuation. Active process claims are never stolen; proven-dead workers become
retryable without discarding receipts.

Uploads reuse local source-bound receipts only after fresh authenticated R2
byte checks. Where a PUT succeeded but its local receipt was lost, the exact
deterministic object is checked before another PUT. Different bytes, a missing
expected object, ambiguous network errors and authorization failures stop the
operation; they are never treated as permission to overwrite.
The low-level PUT helpers have blind write retries disabled in this mode. An
ambiguous PUT is followed by a GET and accepted only if its bytes match.

Registration uses the existing connector's PBE-214 preparation/apply API and
one stable repair ID per run/photo/revision. Current exact cloud identity is
reconciled first. Existing allowed identities are reused; missing identities
can be prepared. Identity/binding conflicts, barriers and later denial require
supported reconciliation, not a second identity. Only the public watermarked
900/1800 pair is registered; original and private bindings are unchanged.

Current approval, chosen source, selection, fixture/ancestor policy and uploaded
preview evidence are rechecked before side effects. The guarded catalog
publisher receives the same callback immediately before push and while waiting
for deployment. Final verification selects exactly this run's IDs in bounded
batches of at most 20; it never consumes an unrelated oldest-photo batch.
Successful partial verification batches are checkpointed. Retry selects only
unfinished or expired observations and can reuse a catalog deployment only
while the current Owner projection and exact live HTTPS bytes still match.
Dead-worker recovery compares the observed PID and claim timestamp atomically;
an older recovery snapshot cannot overwrite a newer running claim.

PBB-179's `public_access_current` remains the sole Live authority, including
its five-minute expiry and exact-input match. Historical completion receipts
do not grant perpetual Live status. An interruption keeps the phase truthful;
the next explicit retry reconciles authoritative state before proceeding.

Tests use disposable Owner databases and fake providers to cover lost replies,
remote-byte reuse, failed deployment/verification, cancellation, stale approval,
private policy, changed source, later denial, exact selection and worker death.
They do not constitute production historical repair or campaign publication.
