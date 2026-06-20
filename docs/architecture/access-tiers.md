# Access Tiers

Photos By Elie uses Google-backed Cloudflare Access as the identity proof for cloud
workflows. Google answers "which email is this?" The Photos By Elie access
registry answers "what can this email do?"

## Tiers

- `admin`: `ec92009@gmail.com` only. Admin can manage the user registry, but
  registry mutation must stay a David-local Owner/Admin action. The cloud
  Worker reports this tier for session awareness, but should not expose a public
  self-service grant endpoint.
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

The first implementation stores user records in the existing Worker KV namespace
under:

```text
pbe:access-users:<lowercase-email>
```

Record shape:

```json
{
  "schema": "photosbyelie.accessUser.v1",
  "email": "client@example.com",
  "tier": "re_client",
  "realEstateClients": ["corine-real-estate"],
  "grantedBy": "ec92009@gmail.com",
  "grantedAt": "2026-06-20T00:00:00.000Z",
  "updatedAt": "2026-06-20T00:00:00.000Z"
}
```

`tier` is one of `user`, `re_client`, or `owner`. Admin is not a registry tier.

## Worker Routes

- `GET /auth/session`: optional session check. Without a Google Access session,
  returns an unauthenticated `user` tier. With a session, returns email, roles,
  tier, Admin flag, and Real Estate gallery grants.
- `GET /auth/login`: Cloudflare Access login entrypoint. Redirects back to the
  allowed `returnTo` origin after Access has authenticated the browser.
- `POST /auth/logout`: redirects through Cloudflare Access logout when Access is
  configured.
- `GET /owner/session`: requires a Google session whose registry tier is
  `owner`, or the configured Admin email.
- `POST /owner/actions`: requires an Owner/Admin Google session and stores a
  queued cloud Owner action record. This is the protected mutation entrypoint
  for future remote Owner work; it does not grant roles.
- `GET /owner/actions/<id>`: requires an Owner/Admin Google session and reads a
  queued cloud Owner action record.
- `POST /real-estate/access-login`: requires a Google session whose registry
  grants include the requested `galleryKey` or an Owner/Admin session. It mints
  the existing signed Real Estate session cookie so the current gallery-scoped
  deliverables/originals APIs keep their object-prefix restrictions.

The Real Estate page prefers Google login through `/auth/login` followed by
`/real-estate/access-login`. The legacy `POST /real-estate/login` password flow
remains for local fallback and older client links.

## Local Admin Grant Path

Admin role grants are not public Worker mutations. On David localhost, the Owner
page Cloud tab can save email/tier rows into `Owner.sqlite:access_users` and
publish the corresponding Worker KV record with:

```text
npx wrangler kv key put pbe:access-users:<email> --path <temp-json> --binding ORDERS_KV --remote
```

This keeps David-local Admin as the only grant surface while still letting Owner
and Real Estate client sessions work from any computer after the KV row exists.
Rows are marked `pending`, `synced`, or `failed` locally so a failed Wrangler
publish can be retried without losing the intended grant.

## Cloudflare Access Setup

Configure Google as a Cloudflare One identity provider, then configure the
Worker/auth hostname with Cloudflare Access. Cloudflare documents the Google IdP
setup in its Google identity provider guide:

https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/

Cloudflare Access sends the Worker an Access JWT in the
`Cf-Access-Jwt-Assertion` request header on protected requests. Browser sessions
also carry the token in the `CF_Authorization` cookie. The Worker validates the
JWT signature and audience before trusting the email:

https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

Access logout is handled by redirecting to the application logout endpoint:

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
