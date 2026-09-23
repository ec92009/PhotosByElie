# PBE-196 Google OAuth browser transaction binding

Google sign-in now creates a Secure, HttpOnly, host-only SameSite=Lax transaction
cookie. Its random secret is the PKCE verifier; only its SHA-256 challenge,
a random transaction ID and OIDC nonce appear in signed state. The callback
requires the exact single cookie, validates state/origin/expiry, atomically
consumes its D1 record, sends the verifier to Google, and checks the signed
ID-token nonce before issuing the existing browser session.

D1 consumption prevents concurrent or stale-cookie replay across Worker
instances. Wrong-browser attempts do not consume the legitimate record.
Provider denial and exchange failures consume the transaction; callers restart
sign-in. Both logout paths invalidate pending transactions. Every sign-in
entrypoint, including Backstage enrollment, carries the transaction cookie.
Success and callback errors clear it. Redirects containing cookies are no-store.

Existing device/session token APIs, role mapping and account-picker behavior
remain. New sign-in starts require HTTPS and available transaction storage;
there is no insecure in-memory production fallback. An in-progress login from
the old version must restart after deployment. A new login replaces the browser's
previous pending transaction cookie; only the latest attempt can complete.

## Release ordering

1. Apply `migrations/0015_google_oauth_transactions.sql` to ACCESS_DB using the
   normal reviewed D1 migration workflow.
2. Deploy the reviewed Worker source. Missing schema/storage fails sign-in closed.
3. Verify legitimate Google account-picker/callback/logout and Backstage
   enrollment with the intended account in the deployed environment.

This source change does not authorize or perform those production steps.
Rollback to an older Worker reopens the reported vulnerability; keep the additive
transaction table if code rollback becomes necessary.

## Verification

Focused tests cover browser A/B transfer with zero token exchanges, duplicate
and malformed cookie fields, concurrent/stale replay, PKCE challenge/verifier
binding, logout and provider denial. Real RSA-signed ID tokens exercise missing,
wrong and matching nonces. The D1 adapter executes its actual SQL against SQLite,
including two independent auth instances consuming the same transaction.
HTTP dispatcher tests cover both login routes, cookie propagation, error cleanup,
existing RE role/session behavior, and sign-out. Worker dry-run passes.

Protocol reference: [Google OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect), checked 2026-09-05.

Final source verification: 104 focused OAuth/Worker tests pass. Full suite before
the isolated logout review correction passed 340 Node +489 Python tests; focused
checks after correction cover both logout routes. The original module accepted
a valid fixture callback without any browser cookie and issued the attacker
fixture session. Patched tests reject that request before token exchange.
Independent review found only the D1-outage logout regression; corrected error
responses clear Google, RE and transaction cookies while reporting revocation
failure. Real Google account login and production migration/deployment remain
unperformed.
