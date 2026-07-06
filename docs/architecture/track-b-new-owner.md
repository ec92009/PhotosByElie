# Track B NewOwner Foundation

Track B separates the public buyer app from a cloud-backed Owner app that can
run from Max, David, or Curie. The first committed shell is intentionally small:
it proves cloud identity, cloud access state, and cloud action queueing without
moving local Owner SQLite, Apple Photos, or Sidecar files into the public app.

## Current Shell

- Page: `new-owner.html`
- Styles: `new-owner.css`
- Runtime: `new-owner.js`
- Local preview: `http://100.111.30.109:8000/new-owner.html` on Max
- Worker base: `window.photosByElieMediaConfig.authWorkerBaseUrl`

The cloud shell uses deployed Worker routes:

- `GET /owner/session`: verifies a Google Owner/Admin session.
- `GET /access-console/state`: reads D1 people, groups, fixtures, roles, and
  capability state when the signed-in account is the bootstrap Admin.
- `GET /owner/actions`: lists the recent cloud Owner action queue from the
  KV-backed recent-action head plus timestamp index.
- `POST /owner/actions`: queues a cloud Owner action.
- `GET /owner/actions/<id>`: reads the queued action back.
- `POST /owner/actions/<id>/claim`: assigns a queued action to a connector id
  such as `max`, `david`, or a future local worker name.
- `POST /owner/actions/<id>/complete`: marks a claimed action completed and
  records a small result object.
- `POST /owner/actions/<id>/fail`: marks a queued or claimed action failed with
  a short error message.

For local/Tailscale previews such as `http://100.111.30.109:8000/new-owner.html`,
Safari may not send the `auth.photos-by-elie.com` session cookie as a
third-party credential. The auth Worker therefore adds a signed session token in
the URL fragment only when Google OAuth returns to allowed local/Tailscale HTTP
origins. `new-owner.js` removes that fragment immediately, stores the token in
`sessionStorage`, and sends it as `Authorization: Bearer ...` for Owner API
calls. Public same-site auth still uses the HttpOnly cookie path.

The first action probe is `track-b-cloud-shell-check`. It writes a harmless
queued Owner action to the existing cloud KV-backed Owner action store, reads
the same action back, and refreshes the recent queue so a reload on Max or David
shows the same cloud state.

The first connector-ready action type is `sidecar-culling-review`. NewOwner can
queue a small culling manifest, claim it for the current connector id, run the
local read-only connector, mark it completed or failed, and reopen completed
review windows from the cloud action list. The connector reads Sidecar state
from local `assets/owner-actions/Owner.sqlite` through
`POST /__photosbyelie/new-owner-connector`, prepares a review-window summary,
and posts compact completion details back through the cloud action lifecycle.
Completed review windows render the first 50 Sidecar records with current
pick/reject state and explicit `Pick`, `Unpick`, and `Reject` controls.

Those controls call the local helper route
`POST /__photosbyelie/new-owner-sidecar-decision`, which writes back to local
`Owner.sqlite` only after an explicit owner click. Browser QA opened the review
workspace read-only and deliberately did not click a real-data decision button.

When the app is opened through the Max/David Tailscale URL
`http://100.111.30.109:8000/new-owner.html`, the local helper must be running
with:

```bash
python3 scripts/local_server.py 8000 --bind 100.111.30.109 --allow-lan-owner
```

Loopback-only previews can use:

```bash
python3 scripts/local_server.py 8000
```

## Boundaries

This shell does not replace `owner.html` yet. It is the Track B rehearsal
surface for cloud-only workflows while the existing Owner app remains the local
operator console for SQLite, Apple Photos, local imports, and Sidecar/Upload
Bridge work.

Cloud-ready now:

- Google Owner/Admin session.
- Safari-compatible local/Tailscale OAuth transfer for NewOwner and ACS.
- D1-backed role, group, and access-policy visibility.
- Cloud Owner action queue creation, readback, recent-action listing, and
  claim/complete/fail lifecycle.
- Browser-mediated local connector execution for read-only Sidecar culling
  review-window summaries.
- Reopening completed Sidecar review windows from cloud action state and staging
  explicit pick/unpick/reject decisions through the local helper.
- Links back to ACS for role and group assignment.

Still connector-backed later:

- Apple Photos imports and source materialization.
- Sidecar gallery routing decisions, richer thumbnails/previews, and Upload
  Bridge exports.
- Local cache warming and machine-specific file previews.
- Full catalog publish orchestration from Owner SQLite into public SQLite/R2.

## Next Step

The next Track B slice should enrich the Sidecar review workspace with the
owner-grade things that make it useful for real work: thumbnails or cached
previews, gallery/routing assignment, and a clearer audit trail for staged local
decisions. After that, reuse the same browser-mediated connector pattern for
Apple Photos import and Real Estate source operations.
