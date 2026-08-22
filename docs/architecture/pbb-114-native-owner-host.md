# PBB-114: Backstage-owned PBE Owner session host

Status: native production host assembled and selected by Backstage, including
route boundary, loopback transport, session authority, SQLite readiness, frozen
gallery, PhotoKit preview, and guarded Worker action submit/status; projection
retry, packaged Python-host removal, and live close/drain acceptance pending,
2026-08-22

## Decision

Do not port `scripts/local_server.py` wholesale. It is a 13,703-line legacy
local-development server containing Owner, R2, import, editing, publication,
repair, and compatibility features that are not part of the Backstage-launched
PBE Owner gallery.

The native host serves only the fixture-frozen actionable gallery. Its exact
dynamic route allowlist is encoded by `PBEOwnerNativeHostContract`:

- host bootstrap and readiness for the in-process Backstage controller;
- session start, status, heartbeat, and close;
- one-time browser handoff bootstrap;
- frozen gallery read;
- guarded action submit, action-status read, and projection retry; and
- authenticated, asset-ID-scoped source preview reads.

The browser also needs an immutable allowlisted web bundle rooted at
`gallery.html`. Static serving must use a generated manifest of exact packaged
files and MIME types; it must not expose the mutable data root or behave like a
general filesystem server.

## Security boundary

- Bind only to `127.0.0.1` on a random port.
- Treat Backstage control, cloud-minted session bearer, one-time browser
  handoff, and browser cookie as distinct authorities.
- Preserve `HttpOnly; SameSite=Strict` browser cookies, exact-origin JSON POST
  checks, bounded bodies, opaque idempotency keys, fixture freeze, expiry,
  heartbeat, and fail-closed session drift.
- Resolve local reads through explicit native stores rooted at the configured
  Owner data directory. Never translate a URL into an arbitrary filesystem
  path.
- Keep guarded mutations behind the Worker/Max action contract.

## Explicitly excluded legacy routes

The native host does not include the old generic photo action, Owner login,
title/keyword queue, owner super-search, R2 progress/fix/fill/skip, visibility
summary, import source/folder/reveal/thumbnail, Apple Photos album/import,
real-estate Owner/import, access-user administration, source edit/import,
price publication, burst culling, connector wake, Sidecar decision, public
media proxy, or private media proxy endpoints.

Those capabilities already belong in native Backstage, a Worker-authorized
action, bounded tooling, or an explicit legacy rollback surface. A future need
must add a reviewed native contract instead of expanding the host implicitly.

## Implementation sequence

1. Freeze and test the reduced route/authority allowlist. **Complete.**
2. Generate and package the immutable `gallery.html` web-bundle manifest.
   **Complete in the sealed runtime and native dispatcher; production host wiring pending.**
3. Add a loopback HTTP parser/listener with strict request/body/header limits
   and deny-by-default routing. **Complete; not production-wired.**
4. Move session/readiness/browser-handoff state into a Swift actor and preserve
   the existing cloud verification and fixture lease. **Complete as an isolated
   native authority with a bounded cloud verifier and native bootstrap,
   readiness, session, heartbeat, browser-handoff, and close handlers;
   query-only SQLite readiness derives opaque source, catalog, fixture, and
   aggregate identities without lifecycle-row churn; production host wiring
   pending. Native and Python leases are intentionally process-local and never
   transfer across the cutover, so each runtime only compares identities it
   derived itself.**
5. Implement gallery and preview reads with native SQLite/PhotoKit services;
   route mutations through `OwnerActionRunner`. **The bounded, authenticated,
   picked-still-photo gallery read and its asset-scoped, bounded PhotoKit JPEG
   preview are complete as isolated native providers and authenticated HTTP
   handlers. Guarded X/restore submission and status now use
   `OwnerActionRunner`, accept no browser authority fields, scope X to the
   displayed gallery, and scope restore to a completed same-session X action;
   projection-only retry remains pending.**
6. **Backstage now defaults to `PBEOwnerNativeHostService`, which loads only
   the signed app's attested web bundle, owns the loopback listener, and never
   launches `local_server.py`.** Keep the legacy service and packaged Python
   host only as explicit rollback material until route parity is complete.
7. Verify signed Max launch, browser behavior, close/drain, crash/sleep/sign-out,
   update/rollback, and no-Python process evidence.
