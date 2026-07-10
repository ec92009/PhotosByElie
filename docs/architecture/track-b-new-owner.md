# Cloud Owner And Mac Connector

The production Owner app separates the public buyer experience from an
authenticated cloud control plane that can run from Max, David, Curie, Windows,
Linux, or a tablet. Apple Photos and local files remain behind enrolled Mac
connectors because a browser cannot receive PhotoKit permissions.

## Production Surface

- Entry point: `owner.html` redirects to `new-owner.html`
- Styles: `new-owner.css`
- Runtime: `new-owner.js`
- Production: `https://photos-by-elie.com/owner.html`
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
- `GET /owner/connectors`: lists recent authenticated connector heartbeats.
- `GET /owner/connector/download/mac`: streams the private connector ZIP only
  after an Owner/Admin session check.
- `POST /owner/connector/heartbeat`: accepts a scoped per-Mac credential.
- `GET /owner/connector/actions` and connector transition routes: let a
  background Mac claim and finish only connector work, without a browser login.

For local/Tailscale previews such as `http://100.111.30.109:8000/new-owner.html`,
Safari may not send the `auth.photos-by-elie.com` session cookie as a
third-party credential. The auth Worker therefore adds a signed session token in
the URL fragment only when Google OAuth returns to allowed local/Tailscale HTTP
origins. `new-owner.js` removes that fragment immediately, stores the token in
`sessionStorage`, and sends it as `Authorization: Bearer ...` for Owner API
calls. Public same-site auth still uses the HttpOnly cookie path.

`owner-connector-check` is the harmless production probe. It is visible only to
the supported connector feed, proves the browser-to-Mac-to-cloud round trip,
and leaves the old Track B rehearsal actions untouched in the audit ledger.

`sidecar-photos-index-sync` runs the full permission-bearing Apple Photos
metadata scan on the selected Mac. The Owner site's Refresh Photos control is
therefore the start of a new intake cycle; no localhost helper page is needed.

`sidecar-culling-review` is connector-backed. The Owner site queues a 24-item
window; an enrolled Mac reads local `Owner.sqlite`, asks the permission-bearing
Photos Bridge app for compact previews, and returns the review window through
the cloud action ledger. Completed windows expose previews, stars, title,
keywords, Pick, Unpick, Reject, and metadata approval from any Owner browser.

Each explicit decision queues `sidecar-review-decision`. The same Mac connector
writes it to local `Owner.sqlite`, including the pending Photos write-back audit,
then returns the exact decision state to the browser. `sidecar-upload-publish`
performs one deliberate guarded R2 bridge upload and immediately invokes public
catalog registration/rebuild on that connector.

The background connector is installed with:

```bash
zsh scripts/install_new_owner_connector.zsh
```

It runs as `com.photosbyelie.owner-connector`, keeps its per-Mac token in
`~/.config/photosbyelie/connector.json` with mode 600, and does not serve a
localhost Owner UI.

## Boundaries

The cloud Owner page replaces the old localhost Owner web UI as the operator
surface. `Owner.sqlite` remains the local Sidecar authority until its reviewed
state is migrated to cloud storage; private snapshots move through the approved
Max/David sync process.

Cloud-ready now:

- Google Owner/Admin session.
- Safari-compatible local/Tailscale OAuth transfer for NewOwner and ACS.
- D1-backed role, group, and access-policy visibility.
- Cloud Owner action queue creation, readback, recent-action listing, and
  claim/complete/fail lifecycle.
- Background connector execution with per-Mac credentials and health.
- Cloud-carried Sidecar previews and culling/metadata decisions.
- Guarded Upload Bridge execution followed by catalog registration.
- Owner/Admin-only Mac connector package download with no bundled credential.
- Links back to ACS for role and group assignment.

Still connector-backed later:

- Direct Apple Photos source materialization outside the Sidecar review path.
- Sidecar gallery routing decisions, richer thumbnails/previews, and Upload
  Bridge exports.
- Local cache warming and machine-specific file previews.
- Full catalog publish orchestration from Owner SQLite into public SQLite/R2.

## Remaining Hardening

- Add gallery/routing assignment and batch decision propagation to cloud review.
- Move the remaining Owner workflows onto supported cloud action types.
- Apple-sign and notarize the Mac package before distribution beyond Elie's
  vetted David and Max Macs.
- Migrate durable reviewed Sidecar state from machine snapshots to a cloud
  database only after conflict and rollback behavior is proven.
