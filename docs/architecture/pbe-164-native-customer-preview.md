# PBE-164: Native View as customer

Status: customer-only cutover implemented in source; release promotion, installation,
and production customer acceptance remain separate receipts.

## Product boundary

PBB is the sole Owner workspace. PBE remains the customer site, not a second
Owner interface. The first native handoff is **Gallery → Workflows → View as
customer**, for exactly one selected photo in the current fixture. It opens
`https://photos-by-elie.com/photo.html?id=<published-media-id>` in the default
browser. It creates no Owner session, token, capability, cookie, or local host,
does not read Photos, and does not alter decisions, publication, or enrollment.
Existing browser customer login state is neither cleared nor impersonated;
ordinary customer access rules still apply. This is not anonymous-mode testing.

## Evidence and failure behavior

The read-only SQLite resolver joins `asset_publications` to
`public_catalog_publications` by exact asset and source version, in the selected
non-archived fixture. Both records must be live; a withdrawal, active asset
tombstone, or globally blocked media lifecycle prevents opening.

The public-catalog record must contain the canonical catalog URL, a SHA-256
digest, and a parseable verification timestamp. The stored URL points to the
catalog, not a photo: the handoff constructs a fixed-origin customer photo URL
from its **published media ID**, never a filename, Photos ID, fixture slug, or
arbitrary stored URL. Query values are encoded, including literal plus signs.

Upload/delivery state alone is insufficient: native promotion sets some local
delivery rows live before remote catalog verification. A new local editorial
version does not supersede a separately verified live source version. Conflicting
live destination IDs fail closed. A missing/older database is not created or
migrated. The lookup has a bounded SQLite busy timeout and runs off the UI actor.

Visible and accessible feedback reports lookup, failure, browser-open failure,
or success. No page opens after cancellation or a changed selection, workspace,
or fixture. Duplicate submissions are disabled while lookup is in progress.

This is **recorded publication evidence**, not a new network verification of the
customer page at click time. Customer-side revocation/access enforcement remains
authoritative. It does not claim an unpublished item is visible.

## Customer-only cutover

Customer HTML no longer links to Backstage provisioning or loads the browser
Owner authentication, navigation, hosted-session, hidden-store, or mutation
bundles. A legacy `gallery=pbe-owner` request redirects to the neutral Search
gallery. A legacy photo URL keeps its exact published media ID while removing
the Owner gallery parameter before rendering the ordinary customer detail page.

Backstage no longer presents an Open/End PBE Owner control or starts a hosted
Owner session from the fixture picker. **Gallery → Workflows → View as customer**
is the only browser-opening workflow exposed by the native app. The attested
host/session implementation remains in source as unreachable rollback material
until a later removal inventory deletes it; it is not part of the normal UI or
customer runtime.

`owner.html` remains an unlinked, `noindex` recovery surface for direct Google
identity verification, one-time Backstage enrollment, device inspection, and
revocation. Its provisioning-only policy hides every workflow card except
Backstage enrollment. Server-side role and device checks remain authoritative.

## Remaining release gates

- Signed release promotion and installed UI/customer-page acceptance remain
  separate from source tests.
- Private-only customer deliveries and fixture-wide previews require their own
  exact customer-link evidence. This public-photo handoff deliberately does not
  guess those links or grant access. Do not treat it as complete PBE-164 parity.
- PBE-164's inventory source receipt is `9eb3dd66` on
  `codex/pbe-164-owner-retirement-inventory`. It describes the later detachment,
  removal, and deployment order; this implementation does not execute those steps.
- Curie=Max fixture parity remains parked by user decision.

## Tests and acceptance

Synthetic SQLite tests cover exact identity/fixture/version, local/pending/failed
states, withdrawals, lifecycle/tombstones, malformed receipts, missing schema,
conflicting live mappings, older live renditions, query encoding, and read-only
bytes. Native model tests cover selection count, no Owner session, visible
failure feedback, browser failure, duplicate submission, and stale async results.

After promotion, test with a known verified published photo:
select it in Gallery, choose Workflows → View as customer, and confirm the right
ordinary customer page opens with no Owner controls added by the handoff. Then
test an unpublished/private-only photo, no/multiple selection, and a changed
selection during lookup. Confirm keyboard reachability, VoiceOver feedback, and
the narrow-window layout. Also confirm legacy hosted-Owner gallery/detail URLs
fail closed into customer pages and no Owner bundle or loopback request is made.
