# PBE-122 Backstage-hosted Owner session contract

## Product boundary

Actionable Owner mode is available only on macOS and only after Backstage opens
it. A regular PBE browser session is never actionable, even when Google reports
an Owner/Admin account. The one browser exception is direct Google sign-in as
`ec92009@gmail.com` for Backstage device credential provisioning and revocation.
That exception does not grant gallery, review, hide, publish, or lifecycle
actions.

## Credential chain

1. The provisioning browser calls `POST /api/v1/devices` after exact identity,
   trusted-origin, provider, purpose, role, and identity checks.
2. The Worker stores only a salted credential hash and returns the credential
   once.
3. Backstage stores the device id and credential in macOS Keychain.
4. `POST /api/v1/auth/tokens` accepts only that pair and issues a 15-minute
   `backstage-device` / `backstage-api` bearer. Backstage re-presents the
   Keychain credential whenever another bearer is needed; there is no refresh
   token.
5. Revocation blocks all later bearer minting; every Owner request also checks
   that the device record still exists and is not revoked.

Raw issued device or Worker session credential material must not enter query
strings, fragments, logs, repo files, browser storage, fixtures, or checked-in
test vectors. The PBE browser receives neither credential.

## Session payload

`POST /api/v1/pbe-owner/sessions` requires an active Backstage bearer and this
body:

```json
{
  "fixtureId": "stable-fixture-id",
  "fixtureBreadcrumb": "Parent / Current fixture",
  "sourceIdentity": "owner-sqlite:sha256:<opaque digest>",
  "catalogIdentity": "catalog-sqlite:sha256:<opaque digest>",
  "readinessIdentity": "pbe-readiness:sha256:<opaque digest>"
}
```

The Worker derives, signs, and persists the remaining claims:

- session id and Backstage device id;
- Owner identity;
- `purpose=pbe-owner-session`;
- exact fixture, source, catalog, and readiness bindings;
- capabilities `gallery.read`, `waste-basket.x`, `waste-basket.restore`,
  `fixture.hide`, `fixture.review`, `fixture.clear`, `asset.rating`, and
  `asset.color`;
- lifecycle writer `pbb-79-waste-basket`;
- issued, expiry, close, and state fields.

The session expires after five minutes. `GET /api/v1/pbe-owner/session`
revalidates the signature, session record, device, expiry, state, and all signed
bindings. `POST /api/v1/pbe-owner/sessions/{id}/close` closes only the exact
matching session.

## Local host readiness and lease

Backstage launches the existing `scripts/local_server.py` on a random loopback
port; it never trusts or attaches credentials to an arbitrary fixed-port
process. A one-use bootstrap secret and an independently computed git checkout
identity authenticate the launched host before Backstage sends any bearer.
It does not start Expo or a competing writer.
`GET /__photosbyelie/pbe-owner/readiness` requires the local Owner database and
public catalog and returns only opaque SHA-256 identities, capabilities, and
the lifecycle writer. Local paths never leave the host.

The identities validate required SQLite tables without exposing a path. The
fixture revision hashes canonical fixture membership and stable actionable
content while excluding only intended lifecycle fields. The mutable Owner source also
binds the file object's device and inode: authorized row writes survive, while
database replacement ends the lease. The public catalog is an expected generated
derivative of X/restore, so its identity deliberately survives an atomic rebuild
at the same canonical slot with the same schema. A different checkout, missing
or unreadable database, or incompatible schema still fails closed.

The checkout identity is
`git:<commit>:pbe-host-sha256:<tracked-host-tree-digest>`. Backstage and Python
independently read `scripts/pbe_owner_host_tracked_paths.txt`, require every
declared host/gallery file to be tracked at `HEAD`, reject tracked status
changes, and hash each working-tree blob against the commit before calculating
the same digest. This also detects `assume-unchanged` content changes. Ignored
root `node_modules` and unrelated untracked files outside the Python import
scope are intentionally outside the host-code attestation.

Before creating the bootstrap secret or starting Python, Backstage also walks
the `scripts/` execution/import scope and compares it with Git's tracked set.
Any untracked or ignored Python/extension module, symlink, special file, or
executable fails closed with `pbe_owner_checkout_stray_import`; this includes
an untracked `scripts/json.py` that could shadow the standard library before
Python's in-process attestation. Ordinary `__pycache__` bytecode remains a
non-blocking local artifact because Backstage launches Python with inherited
`PYTHON*` settings disabled and an empty per-launch bytecode-cache prefix, so
checkout caches are not loaded. Python repeats the stray-scope check during
identity evaluation as defense in depth, but the native pre-launch check is
the controlling boundary because Python imports occur first.

After cloud minting, Backstage calls
`POST /__photosbyelie/pbe-owner/session/start` with the short-lived session token
in the Authorization header. The local host:

- revalidates the session with the Worker;
- requires exact local source/catalog/readiness equality;
- retains only the token digest in memory;
- allows one active fixture-frozen lease;
- requires a heartbeat at least every 90 seconds; and
- revalidates Worker state and local identities on status, heartbeat, and every
  action.

Backstage does not open the browser until the cloud response, local response,
and selected fixture all agree. The fixture coordinator remains frozen until
close, expiry, or a fail-closed error. The exact fixture is captured before the
first asynchronous launch step; both fixture selection and refresh are locked
until launch succeeds or the provisional freeze is released on failure.

## Browser handoff

The local launch URL contains a random, single-use handoff—not a credential—in
the URL fragment. `pbe-owner-session.js` posts that handoff once to the loopback
host and removes the fragment immediately. The host stores only its digest,
consumes it exactly once, and returns an unrelated HttpOnly, SameSite, session-
only cookie scoped to the PBE endpoints. Reloads use that cookie. Browser
JavaScript never receives the Worker session token, Backstage device
credential, or browser cookie, and no authorization material is written to
`localStorage` or `sessionStorage`.

The accessible status region reports checking, ready, unavailable, closing,
the frozen fixture, expiry, and the X recovery rule. Normal browser visits do
not create the region and expose no Owner action state.

Heartbeat responses carry an implicit client generation. Close invalidates the
generation and clears the timer before awaiting the server, so a heartbeat
that was already in flight cannot publish `ready` after the session is closed.

Hosted hidden and Undo history is same-tab state in `sessionStorage`, with keys
scoped by the active PBE Owner session id. A new session does not load or merge
the global `photosbyelie-hidden` / `photosbyelie-hidden-history` local-storage
values, a prior hosted session's values, or globally loaded hidden collections.
It also does not read or mutate the legacy reserve-only or reserve-promotion
browser state. Ordinary non-hosted storage behavior remains separate and
unchanged; the hosted path's only durable action is the authenticated PBB-79
gateway write.

Sidecar is obsolete as a product, authority, and launch path. Any retained
`sidecar-*` identifier names a historical compatibility contract only;
Backstage, the loopback lease, PBB-79, and OwnerCore are the active chain.

## Lifecycle writer

The hosted gallery action endpoint accepts only:

- `waste-basket-x`;
- `waste-basket-x-many`; and
- `waste-basket-restore`.

The browser cannot assert its own actor, fixture, Owner authorization, or
lifecycle writer. The host derives those fields from the validated lease and
calls the shared `apply_photo_action` PBB-79 gateway. The generic local photo
action endpoint rejects `source=owner-gallery`, preventing a caller from
bypassing the session endpoint with trusted-looking booleans.

Restore does not trust browser Undo history or browser fixture fields. Before a
hosted restore, the local host resolves every requested authoritative,
recoverable Waste Basket row and requires its stored `fixture_id` to equal the
lease's frozen fixture. The gateway repeats that fixture check inside the
restore transaction; a missing, tombstoned, unbound, or cross-fixture entry
fails closed without restoring anything. X remains independently constrained
to the actual displayed frozen-fixture window.

The authoritative restore transaction and its static catalog projection have
truthful separate acknowledgement. If projection fails after commit, the host
returns `authoritative_committed=true` and a retryable `projection=pending`
rather than claiming the restore rolled back. A later request may resolve the
same fixture-bound restored receipt as `already-restored` and retry only the
projection. Browser Undo history is therefore removed on authoritative
success, while a lost HTTP acknowledgement remains safely retryable with a new
idempotency key.

There is no hosted PBE route for direct tombstone creation, tombstone restore,
or Waste Basket Empty. X is recoverable until a separately authorized emptying
operation. Backstage Culling X, Review X, and hosted PBE X therefore share the
same fixture identity, audit receipt, and lifecycle writer.

## Deterministic fail-closed cases

Owner actions are disabled when any of these is true:

- no device credential or native bearer;
- wrong provisioning email, provider, or token purpose;
- missing, invalid, or revoked device;
- unavailable Worker or loopback host;
- dirty, untracked, or content-mismatched declared host code;
- missing Owner database or public catalog;
- missing capability or lifecycle writer;
- absent or mismatched fixture/source/catalog/readiness binding;
- a second conflicting local lease;
- expired heartbeat or cloud session; or
- explicit local or cloud close.

No failure falls back to Google browser authority, a generic localhost Owner
session, direct SQLite mutation, or a direct global tombstone.

## Verification and release boundary

Automated coverage includes Worker authorization/revocation/expiry, Python
readiness and in-memory lease behavior, guarded X/restore payloads, Swift launch
and transport bindings, dirty/`assume-unchanged` checkout rejection, stale
heartbeat rejection, fixture-refresh locking, projection retry, script order
and secret handling, and desktop/narrow status styling. Production remains
unchanged until the normal Worker, static site, and signed Backstage release
gates are completed and manually rehearsed.
