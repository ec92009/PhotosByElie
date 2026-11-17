# Public-access observations (PBB-179)

`POST /api/v1/lifecycle/public-previews/verify` is an authenticated, read-only
Owner/connector contract. It accepts at most 20 exact canonical asset/media
identities and their public Expo 900/1800 JPEG pairs (64 KiB body maximum).
One D1 read snapshot checks authority readiness, canonical asset ownership,
every requested object binding, lifecycle projection and armed deny barriers.
It never seeds/reconciles registration, writes D1/R2, enumerates unrequested
bindings, or returns private object keys. Public `/lifecycle/visibility` remains
unchanged and is not sufficient evidence for this native workflow.

The response is `photosbyelie.publicPreviewObservation.v1`, `readOnly: true`,
with `checkedAt`, `expiresAt` (five minutes), and exact per-item
`allowed/reason/revision/receiptId` observations. All responses are uncached.
Unknown identities/bindings remain pending; mismatch, denial and barriers are
blocked. Service failure yields no affirmative observation.

This is an observation, not a capability or enduring availability guarantee.
It cannot attest local source versions or bytes. The native consumer must
independently verify its current approved edition, current public catalog
checksum, exact upload receipts and public JPEG bytes, then recheck lifecycle
revision after reading the bytes. Its local observation must be invalidated
by input changes, failure or expiry. Existing media-upload/catalog receipts
are retained and never silently upgraded to public Live.

Release compatibility: additive Owner API 1.3.0 operation; no D1 migration,
new credential, new binding or permission change. Older native clients and
existing public visibility/download routes are unchanged.
