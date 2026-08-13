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
   `backstage-device` / `backstage-api` bearer plus a rotating refresh token.
5. Revocation invalidates indexed refresh tokens; every Owner request also
   checks that the device record still exists and is not revoked.

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
- capabilities `gallery.read`, `waste-basket.x`, and
  `waste-basket.restore`;
- lifecycle writer `pbb-79-waste-basket`;
- issued, expiry, close, and state fields.

The session expires after five minutes. `GET /api/v1/pbe-owner/session`
revalidates the signature, session record, device, expiry, state, and all signed
bindings. `POST /api/v1/pbe-owner/sessions/{id}/close` closes only the exact
matching session.

## Local host readiness and lease

Backstage attaches to `127.0.0.1:8000` or launches the existing
`scripts/local_server.py`; it does not start Expo or a competing writer.
`GET /__photosbyelie/pbe-owner/readiness` requires the local Owner database and
public catalog and returns only opaque SHA-256 identities, capabilities, and
the lifecycle writer. Local paths never leave the host.

Both identities validate required SQLite tables and hash their resolved local
slot and stable schema without exposing a path. The mutable Owner source also
binds the file object's device and inode: authorized row writes survive, while
database replacement ends the lease. The public catalog is an expected generated
derivative of X/restore, so its identity deliberately survives an atomic rebuild
at the same canonical slot with the same schema. A different checkout, missing
or unreadable database, or incompatible schema still fails closed.

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
close, expiry, or a fail-closed error.

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
and transport bindings, script order and secret handling, and desktop/narrow
status styling. Production remains unchanged until the normal Worker, static
site, and signed Backstage release gates are completed and manually rehearsed.
