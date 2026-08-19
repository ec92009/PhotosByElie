# Browser provisioning and Mac Backstage

This document supersedes the former "Cloud Owner anywhere" design. Actionable
Owner operation is Mac-only. PhotosByElie Backstage may run on any enrolled Mac;
Windows, Linux, tablets, and ordinary browser sessions are customer/client
surfaces, not Owner workstations.

## Browser surface

`owner.html` is retained only as the Backstage credential provisioning surface.
It uses `new-owner.css` and `new-owner.js`, but hides and does not initialize the
legacy action, fixture, connector, review, Waste Basket, and ACS controls.

A direct Google sign-in must satisfy all of these conditions before enrollment:

- the verified email is exactly `ec92009@gmail.com`;
- the signed identity provider is `google-oauth`;
- the signed token purpose is `browser`;
- the Worker still resolves the identity as Owner/Admin.

That session may list, create, or revoke Backstage devices. A newly created
device credential is shown once. The browser does not store it. The operator
copies it directly into Backstage, where `OwnerCredentialVault` stores it in
macOS Keychain. Normal Google login cannot mint a native bearer without a valid
device id and device credential, and cannot list or create Owner actions.

The provisioning page cannot X, review, hide, publish, or otherwise act as
Owner. Worker mutation routes independently enforce a signed
`backstage-device` / `backstage-api` identity, so showing old markup through
developer tools does not restore authority.

## Backstage authentication

Backstage exchanges its enrolled device id and Keychain credential at
`POST /api/v1/auth/tokens`. The Worker validates the credential hash and device
revocation state, then issues a 15-minute bearer.
Backstage re-presents that same Keychain credential whenever the bearer expires;
no long-lived refresh token exists. Raw issued device credentials are never
placed in git, URL query parameters,
logs, fixtures, checked-in test vectors, or browser storage.

Device revocation blocks subsequent token minting. Every sensitive Owner request
also resolves the device record, so revocation fails closed before the current
bearer naturally expires.

## Hosted PBE Owner mode

Backstage is the only launch point. From the current fixture in the global
sidebar it:

1. verifies that its Backstage device session is active;
2. attaches to or launches the existing loopback `scripts/local_server.py` host;
3. reads opaque readiness identities for `Owner.sqlite` and the public catalog;
4. asks the Worker to mint a five-minute session bound to the fixture id,
   breadcrumb, source identity, catalog identity, readiness identity, device id,
   capabilities, expiry, and lifecycle writer;
5. attaches that session to the loopback host and opens the gallery with a
   single-use opaque handoff in the URL fragment; and
6. immediately exchanges and removes that handoff for an HttpOnly,
   session-only loopback cookie while Backstage heartbeats the Worker-backed
   lease.

The normal cutover target is not an always-on `com.photosbyelie.owner-connector`
LaunchAgent. Signed Backstage starts the connector runtime with `--once` only
when it has created or is monitoring an explicit Owner action; the PBE local
host uses the same short-lived drain for a hosted lifecycle request and
coalesces repeated browser wakes. The Worker action ledger and `Owner.sqlite`
outbox remain authoritative, so a child that finishes, crashes, or is stopped
does not erase queued work. Closing Backstage or its local host leaves the
durable action available for the next Backstage launch.

The per-Mac token remains in `~/.config/photosbyelie/connector.json` with mode
600 and is passed only by config-file path, never copied into a Swift or shell
argument. Installation still copies tracked connector code into a versioned,
read-only, manifest-verified runtime below
`~/Library/Application Support/PhotosByElie`; the existing LaunchAgent
installer is rollback-only until the PBB-106 release and live/KV gates are
accepted. Every runtime byte comes directly from one fully resolved Git commit
object rather than the index or working tree, and committed symlinks,
non-regular entries, unsafe paths, and invalid revisions fail closed.

The active fixture is frozen for the session. Backstage disables fixture drift;
the Worker, loopback host, and browser independently reject missing, changed, or
expired bindings. Closing the browser banner or Backstage control closes the
lease. Host unavailability, absent/revoked credentials, readiness failure,
identity mismatch, missing capabilities, expiry, and closure all disable Owner
actions with deterministic errors.

The detailed payload and endpoint contract is in
[`pbe-owner-host-session.md`](pbe-owner-host-session.md).

## Writer boundary

Hosted PBE gallery X is deliberately narrow. The browser submits only
`waste-basket-x`, `waste-basket-x-many`, or `waste-basket-restore` to the
dedicated loopback session endpoint. The host derives the actor, fixture,
authorization, and idempotency context from the validated lease and invokes the
shared PBB-79 gateway.

Hosted PBE has no direct tombstone or Waste Basket Empty route. X remains
recoverable until a separately authorized Waste Basket emptying operation.
Backstage Culling X, Review X, and hosted PBE X therefore converge on the same
fixture identity, audit chain, and lifecycle writer.

## Connector boundary

The on-demand Mac connector retains its scoped credential and may claim only
allowlisted, targeted work. It does not grant browser Owner authority. Apple
Photos, `Owner.sqlite`, source files, and Backstage's signed PhotoKit IPC
remain behind the Mac boundary; cloud APIs carry identities, opaque action
records, and audit receipts rather than raw local paths or database access.
Backstage is the only normal launch owner: it runs the sealed connector once
for native actions, while its loopback PBE host does the same for hosted
lifecycle actions. No idle status server or polling process is required.

Sidecar is obsolete as a product, authority, and launch path. Historical
`sidecar-*` action kinds, database type names, and compatibility routes may
remain until a separately audited migration removes them; they do not identify
an active app or grant workflow authority. Backstage is the supported client.

## Release gates

Source and synthetic tests prove the contract, but release still requires:

- Worker and static-site deployment through the normal versioned release;
- one live `ec92009@gmail.com` provisioning and Keychain enrollment rehearsal;
- a real local host launch against an approved Owner database and catalog;
- desktop and narrow Safari visual/keyboard/accessibility acceptance; and
- explicit confirmation that revoke, expiry, close, X, and restore all fail or
  recover as documented without production fixture drift.
