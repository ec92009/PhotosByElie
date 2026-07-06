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

The first action probe is `track-b-cloud-shell-check`. It writes a harmless
queued Owner action to the existing cloud KV-backed Owner action store, reads
the same action back, and refreshes the recent queue so a reload on Max or David
shows the same cloud state.

The first connector-ready action type is `sidecar-culling-review`. NewOwner can
queue a small culling manifest, claim it for the current connector id, run the
local read-only connector, and mark it completed or failed. The connector reads
Sidecar state from local `assets/owner-actions/Owner.sqlite` through
`POST /__photosbyelie/new-owner-connector`, prepares a review-window summary,
and posts compact completion details back through the cloud action lifecycle.
It does not mutate `Owner.sqlite`.

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
- D1-backed role, group, and access-policy visibility.
- Cloud Owner action queue creation, readback, recent-action listing, and
  claim/complete/fail lifecycle.
- Browser-mediated local connector execution for read-only Sidecar culling
  review-window summaries.
- Links back to ACS for role and group assignment.

Still connector-backed later:

- Apple Photos imports and source materialization.
- Sidecar culling decisions and Upload Bridge exports.
- Local cache warming and machine-specific file previews.
- Full catalog publish orchestration from Owner SQLite into public SQLite/R2.

## Next Step

The next Track B slice should turn the read-only Sidecar connector result into
a real review workspace: open the prepared culling window, let the owner assign
gallery/routing decisions, and keep those writes behind explicit local Owner
actions. After that, reuse the same browser-mediated connector pattern for
Apple Photos import and Real Estate source operations.
