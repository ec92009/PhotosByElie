# Access Tiers

Photos By Elie uses Google-backed Cloudflare Access as the identity proof for cloud
workflows. Google answers "which email is this?" The Photos By Elie access
registry answers "what can this email do?"

## Tiers

- `admin`: `ec92009@gmail.com` only. Admin can open the Access Console Sandbox
  and manage the user registry through guarded cloud Worker routes. Admin is a
  bootstrap identity, not a stored or grantable role.
- `owner`: trusted Owner workflow user. Owner can run cloud Owner work from any
  machine after Google login once the corresponding cloud Owner APIs exist.
- `re_client`: Real Estate client. The registry stores the exact gallery keys
  this email may open. No separate client password is required for the
  Google-backed path.
- `user`: public buyer/browser user. Login is optional and should never be
  required for normal browsing or guest checkout.

Admin is deliberately not grantable to arbitrary emails through the registry.
The Worker treats `ACCESS_ADMIN_EMAIL` as the only Admin bootstrap identity and
ignores registry records as a source of additional admins.

## Registry

Access Console V7 stores structured access state in D1 once the Worker has an
`ACCESS_DB` binding. Auth/session reads switch to the D1 registry immediately
when that binding exists. Until then, deployed auth keeps the legacy KV registry
as a compatibility fallback.

Current ACS deployment:

- Worker routes: `https://auth.photos-by-elie.com/access-console/*`
- D1 database name: `photosbyelie-access`
- D1 binding: `ACCESS_DB`
- Migrations: `migrations/0001_access_console.sql`,
  `migrations/0002_access_console_audience_groups.sql`,
  `migrations/0003_access_console_group_state.sql`,
  `migrations/0004_access_console_gallery_defaults.sql`

D1 tables:

- `pbe_access_people`: email, display name, notes, fixture marker, disable state,
  and created/updated actor metadata.
- `pbe_access_role_grants`: active/revoked `owner` and `re_client` grants.
- `pbe_access_gallery_grants`: active/revoked gallery grants, currently Real
  Estate gallery keys.
- `pbe_access_audience_groups`: family, event, and Real Estate audience groups,
  each tied to a gallery key, capability list, per-gallery defaults, and
  active/archived state.
- `pbe_access_group_memberships`: active/revoked email-to-group assignments.
- `pbe_access_fixture_events`: clearly marked rehearsal family/event/RE records.
- `pbe_access_audit_events`: before/after snapshots for role and disable changes.

Public registry record shape:

```json
{
  "schema": "photosbyelie.accessUser.v1",
  "email": "client@example.com",
  "displayName": "Client Example",
  "tier": "re_client",
  "roles": ["user", "re_client"],
  "realEstateClients": ["corine-real-estate"],
  "groupIds": ["re-la-concha"],
  "groups": [
    {
      "id": "re-la-concha",
      "label": "RE La Concha",
      "kind": "real_estate",
      "galleryKind": "real_estate",
      "galleryKey": "re-la-concha",
      "capabilities": ["view_gallery", "view_watermarked", "pdf", "video", "view_originals"],
      "galleryDefaults": {
        "watermarked": true,
        "saleEnabled": false,
        "downloads": false,
        "pdf": true,
        "video": true,
        "memberOriginals": true,
        "ownerOriginals": true
      }
    }
  ],
  "effectiveAccess": {
    "summary": "RE La Concha",
    "capabilities": ["pdf", "video", "view_gallery", "view_originals", "view_public", "view_watermarked"],
    "scopes": []
  },
  "notes": "",
  "source": "manual",
  "fixture": false,
  "disabledAt": null,
  "grantedBy": "ec92009@gmail.com",
  "grantedAt": "2026-06-20T00:00:00.000Z",
  "updatedAt": "2026-06-20T00:00:00.000Z"
}
```

`tier` is derived from active roles and direct Real Estate gallery grants. Auth
session calculation also reads `effectiveAccess` so a Real Estate audience group
can grant the existing gallery-scoped login path. Admin is not a registry tier
and cannot be granted through ACS.

## Worker Routes

- `GET /auth/session`: optional session check. Without a Google-backed session,
  returns an unauthenticated `user` tier. With a direct Google OAuth or legacy
  Cloudflare Access session, returns email, roles, tier, Admin flag, and direct
  plus group-derived Real Estate gallery grants.
- `GET /auth/google/login`: direct Google OAuth entrypoint for public Account
  and Real Estate Google buttons. It asks Google for `prompt=select_account`,
  signs the OAuth state, and redirects back through `/auth/google/callback`.
  If direct OAuth secrets are not configured, it redirects to the legacy
  `/auth/login` path.
- `GET /auth/google/callback`: exchanges the Google authorization code,
  validates the Google ID token, sets the signed `pbe_google_session` cookie,
  and returns to the allowed `returnTo` URL.
- `GET /auth/login`: legacy Cloudflare Access login entrypoint. Redirects back
  to the allowed `returnTo` origin after Access has authenticated the browser.
- `GET /auth/logout` or `POST /auth/logout`: clears the direct OAuth session
  cookie when direct Google OAuth is configured. Otherwise it redirects through
  Cloudflare Access logout when Access is configured; with a Cloudflare Access
  team name, the Worker prefers the team-domain logout URL.
- `GET /owner/session`: requires a Google session whose registry tier is
  `owner`, or the configured Admin email.
- `GET /owner/actions`: requires an Owner/Admin Google session and lists recent
  queued cloud Owner actions from the KV recent-action head plus timestamp
  index. New actions update the head key so the NewOwner app can reload across
  machines without depending only on KV prefix-list freshness.
- `POST /owner/actions`: requires an Owner/Admin Google session and stores a
  queued cloud Owner action record. This is the protected mutation entrypoint
  for future remote Owner work; it does not grant roles.
- `GET /owner/actions/<id>`: requires an Owner/Admin Google session and reads a
  queued cloud Owner action record.
- `POST /owner/actions/<id>/claim`: requires an Owner/Admin Google session,
  changes a queued action to `claimed`, stores connector id, claimant, claim
  time, and a short lease timestamp.
- `POST /owner/actions/<id>/complete`: requires an Owner/Admin Google session,
  changes a claimed action to `completed`, and stores a result object.
- `POST /owner/actions/<id>/fail`: requires an Owner/Admin Google session and
  marks a queued or claimed action `failed` with a short error message.
- Local helper `POST /__photosbyelie/new-owner-connector`: requires localhost
  or `--allow-lan-owner` private/Tailscale access, accepts a claimed or
  completed `sidecar-culling-review` action, reads Sidecar state from local
  `Owner.sqlite`, and returns compact review-window details for the NewOwner UI
  and Worker `complete` route. The read/open path does not grant roles and does
  not mutate `Owner.sqlite`.
- Local helper `POST /__photosbyelie/new-owner-sidecar-decision`: requires the
  same local/private-LAN guard, accepts an explicit `pick`, `unpick`, or
  `reject` decision for one Sidecar asset id, and writes the staged decision to
  local `Owner.sqlite`.
- `POST /real-estate/access-login`: requires a Google session whose registry
  grants include the requested `galleryKey` or an Owner/Admin session. It mints
  the existing signed Real Estate session cookie so the current gallery-scoped
  deliverables/originals APIs keep their object-prefix restrictions.
- `GET /access-console/state`: requires Admin and returns session, people,
  audience groups, gallery options, fixture events, audit events, grantable role
  metadata, and capability metadata.
- `GET /access-console/gallery-access`: requires Admin and returns a read-only
  policy rehearsal for a gallery key: regular visitor, selected access person,
  and Owner/Admin decisions for view, watermark/original preview, checkout,
  assigned downloads, re-downloads, PDF, and video.
- `POST|PUT|PATCH /access-console/people`: requires Admin and upserts one
  person's non-admin roles, audience group memberships, Real Estate grants, name,
  and notes.
- `POST|PUT|PATCH /access-console/groups`: requires Admin and creates or updates
  an audience group, gallery key, access policy, capability list, and
  per-gallery defaults.
- `POST /access-console/groups/<id>/archive`: requires Admin, marks the audience
  group archived, and revokes active memberships for that group.
- `POST /access-console/people/<email>/disable`: requires Admin and revokes
  active roles, group memberships, and grants without deleting audit history.
- `POST /access-console/fixtures/seed`: requires Admin and seeds fake `.test`
  people plus the `Agnes's B'day`, `RE La Concha`, and `Johnson-Palmer wedding`
  family/event/RE rehearsal records.

The Real Estate page prefers Google login through `/auth/google/login` followed
by `/real-estate/access-login`. The legacy `POST /real-estate/login` password
flow remains for local fallback and older client links.

## Access Console Grant Path

`access-console.html` is the single-repo sandbox UI for role-management
rehearsal. It talks to the auth Worker at the configured
`authWorkerBaseUrl`/`checkoutWorkerBaseUrl`, requires the bootstrap Admin Google
session, and performs reversible writes:

- `owner` and `re_client` can be granted or revoked.
- `admin` is displayed as bootstrap-only and rejected if submitted.
- Audience group checkboxes assign family, event, and Real Estate memberships
  without hard-coding future roles such as family member or event attendee.
- The group manager can create, edit, and archive family/event/RE/custom groups
  with gallery keys, access policies, capability lists, and per-gallery defaults.
- The gallery record picker can prefill public galleries, fixture events, and
  Real Estate groups. Gallery defaults persist watermark, sale/checkout,
  assigned-download, PDF, video, member-original, and Owner-original-preview
  behavior; Owner originals do not grant ordinary member access.
- The membership workbench lists selected-group members, bulk-adds Google-style
  email identities, revokes individual memberships, and filters the people table
  by group, role, state, or search text.
- The gallery-permission preview derives selected group, selected person,
  regular visitor, and Owner/Admin modes from the same effective-access scopes,
  including an Owner originals switch for full-resolution/unwatermarked preview
  rehearsal without granting new public capabilities.
- The Worker policy tester calls `/access-console/gallery-access` for the
  selected group and selected person, confirming the cloud-side visitor,
  member, and Owner/Admin decisions before those rules are enforced by public,
  event, and Real Estate gallery routes.
- Archived groups stay visible in ACS but no longer appear in person assignment
  pickers, gallery options, auth-session effective access, or new memberships.
- The effective-access inspector shows the selected person's base user scope,
  role scope, group/gallery scopes, and capability chips.
- Disable revokes active roles, group memberships, and gallery grants but keeps
  the person and audit events.
- Fixture people use fake `.test` addresses and are marked `fixture`.

Provision/apply command history:

```text
npx wrangler d1 create photosbyelie-access
npx wrangler d1 migrations apply photosbyelie-access --remote
npx wrangler deploy
```

The database is bound in `wrangler.toml` as `ACCESS_DB`; deploy the Worker after
future access-schema changes.

## Legacy KV Fallback

When `ACCESS_DB` is absent, the deployed Worker still reads legacy KV records so
existing Owner/RE auth does not break during the D1 cutover. Legacy records live
under:

```text
pbe:access-users:<lowercase-email>
```

Do not use KV as the long-term source of truth once `ACCESS_DB` is bound.

## Direct Google OAuth Setup

Direct public Account and Real Estate login uses the Worker, not Cloudflare
Access. Store the Google client credentials and session signing secret as
Worker secrets:

```text
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_SESSION_SECRET
```

The Google OAuth client must include this authorized redirect URI:

```text
https://auth.photos-by-elie.com/auth/google/callback
```

The Worker validates Google ID tokens against Google's public certificates,
requires the issuer/audience/expiry/email verification claims to match, and then
maps the verified email through the same Admin/Owner/RE/User registry. The
direct OAuth cookie is host-only to the auth Worker and is used by credentialed
fetches from the public site.

## Cloudflare Access Legacy Setup

Configure Google as a Cloudflare One identity provider, then configure the
Worker/auth hostname with Cloudflare Access. Cloudflare documents the Google IdP
setup in its Google identity provider guide:

https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/

Keep the Access setup as a fallback for protected legacy `/auth/login` flows.
Do not send browsers directly through Google AccountChooser; iPhone testing
showed Google rejects that malformed continuation before Cloudflare Access can
run.

Cloudflare Access sends the Worker an Access JWT in the
`Cf-Access-Jwt-Assertion` request header on protected requests. Browser sessions
also carry the token in the `CF_Authorization` cookie. The Worker validates the
JWT signature and audience before trusting the email:

https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

Access logout is handled by redirecting to Cloudflare Access logout. The Worker
prefers the team-domain logout endpoint when configured because Cloudflare
stores the global SSO token on the team domain, while the application token
lives on the protected hostname:

https://developers.cloudflare.com/cloudflare-one/faq/authentication-faq/#how-do-end-users-log-out-of-an-application-protected-by-access

Required Worker configuration:

```text
ACCESS_ADMIN_EMAIL=ec92009@gmail.com
ACCESS_TEAM_NAME=<cloudflare-access-team-name>
ACCESS_AUD=<cloudflare-access-application-audience>
```

`ACCESS_AUD` belongs in Worker secrets. `ACCESS_ADMIN_EMAIL` is not secret.

Run the local preflight before relying on a new machine or Worker auth host:

```bash
npm run auth:preflight -- --worker-url https://photosbyelie-checkout-mock.ec92009.workers.dev
```

Use `--offline` to check only local repo configuration.
