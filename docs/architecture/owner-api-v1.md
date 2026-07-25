# Owner API v1

`/api/v1` is the formal cloud boundary for PhotosByElie Backstage. During
migration, its handlers delegate to the production-tested Worker routes, so
the legacy web Owner and the native client exercise the same authorization,
action ledger, D1, R2, and delivery implementation.

## Conventions

- JSON requests use `application/json`; binary deliverable responses retain
  their media type and stream without buffering.
- Successful JSON responses retain the existing resource envelope while the
  OpenAPI contract names the canonical fields.
- Errors use `{ "error": { "code", "message", "details" } }`.
- Every v1 response carries `X-PBE-API-Version: 1`,
  `X-PBE-Request-Id`, and `Cache-Control: no-store`.
- Authentication accepts the existing signed owner session cookie or its
  bearer representation. Connector routes require the distinct connector
  credential.
- Native Backstage enrollment is bootstrapped by a human Owner session.
  Enrollment returns a device credential once; the application stores it in
  Keychain and exchanges it for a 15-minute bearer token plus a rotating
  30-day refresh token. The Worker stores only credential/token hashes.
- Each native device is independently listable and revocable. Revoking a
  device also revokes its indexed refresh tokens. Connector credentials remain
  a separate authentication class and cannot be exchanged for human tokens.
- Mutation clients send `Idempotency-Key`; the Worker accepts the
  `X-Idempotency-Key` compatibility spelling during migration.
- Opaque identifiers are URL encoded. Clients do not infer meaning from an
  action, job, fixture, person, group, gallery, or deliverable ID.
- Times are ISO 8601 UTC strings.

## Pagination and filters

Collection endpoints use `limit` (default 50, maximum 200) and an opaque
`cursor`. Responses use:

```json
{
  "items": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

Action and job lists may additionally filter by `state`, `target`,
`actionKind`, `createdAfter`, and `createdBefore`.

## Long-running work

Long-running local or cloud work is represented by either an owner action or a
render job. Canonical states are `queued`, `claimed`, `running`, `completed`,
`failed`, and `cancelled`. Progress is:

```json
{
  "phase": "uploading",
  "completed": 42,
  "total": 100,
  "percent": 42,
  "detail": "Uploading public preview"
}
```

Creation returns `202 Accepted` when execution is asynchronous. Repeating a
mutation with the same idempotency key returns the original resource and does
not enqueue duplicate work.

Queued actions may be cancelled by an authenticated Owner. Connectors cannot
cancel actions, and cancellation never interrupts a claimed local mutation:
claimed work must finish as `completed` or `failed`. This keeps
`Owner.sqlite` mutation boundaries atomic and auditable.

## Compatibility policy

The v1 router is an explicit allowlist. Unknown v1 routes fail closed with
`404 not_found`; they never fall through to arbitrary legacy endpoints.
Compatibility adapters are removed only after:

1. all first-party web and native clients use `/api/v1`;
2. contract and connector parity tests pass;
3. the PBB-18 reversible cutover rehearsal passes;
4. the rollback checkpoint has been documented.

The route mapping is implemented in `worker/owner-api-v1.mjs`, and the
machine-readable contract is `docs/api/owner-v1.openapi.yaml`.
