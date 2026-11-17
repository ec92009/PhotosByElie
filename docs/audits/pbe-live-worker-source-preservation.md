# Captured live Worker source preservation

This bounded source reconciliation starts at parent candidate
`48ca67733e6e033d668c479223efa9de49e5e96e` (v321.12). The parent owns release
versioning, full artifacts, migration sequencing, deployment and provider
acceptance. Private captured modules and executable comparison receipts remain
under ignored task workspaces; none are public artifact inputs.

## Production authority and Tilbury relationship

Parent-captured active Worker `photosbyelie-checkout-mock`, version
`ebcb81cb-8b48-41aa-9b35-a8d7b0296d9d`, deployed 2026-10-21:

| Captured module | SHA-256 |
| --- | --- |
| `cloud-worker.js` | `345fd811965549254f87e4760abdff0c0a8316c2a4377cab4924ddb6114ae2a2` |
| `tilbury-handler.mjs` | `68acd4c1aec6da73c38179629f543c23c0cb34009c6a4488c8ff21d3fd674dab` |

Both hashes were rechecked against the downloaded files. The parent receipt
establishes runtime date/flags and plain-text configuration parity. This child
does not access credentials or providers or change flags, bindings or secrets.

The read-only TILBURY `commerce/tilbury-handler.mjs` source has SHA-256
`18ebc409659f4367ac868133c97743d214fde296eb06920db6f3571bd4566da5`.
It contains a later checkout attribution block absent from the captured module.
Removing only that block produces source SHA-256
`acb02474d871dd0dd98af10e6bbc1a4746a600ce67a8e78d5155bcfe2b304157`.
Bundling that source with the locked SDK/compiler produces an application
section byte-identical to the captured `// tilbury-handler.mjs` section:
SHA-256 `2d93b9734e3662d64b2eae1eb4731b696c1478f8bf9eca43699847727dc27c40`.
This checks the whole application section, including routes and fulfillment,
rather than inferring a relationship from a filename or one product.

The restored PBE source differs from that verified source only by the accepted
dispatch adaptation: clone/inspect common webhook metadata before constructing
Stripe, safely handle null/scalar/malformed PBE bodies, and contain Tilbury
client errors. Reversing those specific adaptations reproduces the verified
source exactly. Stripe 23.0.0 and the entire dependency lock are unchanged.

The missing live behavior comprised the fourth `tech-proof` offer and
`setupTechProof` plus `/tilbury/setup-tech-proof` dispatch. The restored setup
retains the approved ZIP hash/size gates, private R2 verification, stable product
and price identities, one-time USD 0.99 checks, seven-lesson product description,
existing-shop preservation and configuration reread/conflict fences. No later
upstream attribution feature is adopted.

## Bounded main-module comparison

The candidate main entrypoint was bundled offline with the Tilbury handler
external, matching the captured split-module structure. Source section comments
identify 46 application module sections, including both cloud-entrypoint parts.
No live section is missing. Twenty-four sections are byte-identical; fifteen
more are identical after compiler identifier/shorthand normalization. The
normalization is recorded in private scripts/receipts, including the one
cross-module `canonicalJson` generated alias and the local OAuth `identity`
alias. This is a bounded application comparison, not a third-party SDK audit.

The seven material differences are intentional:

| Module | Retained difference |
| --- | --- |
| `cloud-worker.mjs` | Existing Tilbury-first fetch wrapper and render workflow retained; accepted private `wstFunnelSnapshot()` added beside unchanged private commerce RPC. |
| `paid-order-refund.mjs` | Accepted authoritative reservation, CAS/monotonic outcomes and recovery, including confirmed-pending mirror protection. |
| `paid-order-fulfillment.mjs` | Accepted extraction with authoritative refund exclusion and explicit mock-only authority exception. |
| `checkout-worker.mjs` | Accepted refund-protected store and pre/post-read download/email guards; unrelated routes retained. |
| `lifecycle-deny-store.mjs` | Accepted D1 settlement integration and guarded readiness/capability/email operations. |
| `campaign-video-sqlite.mjs` | Accepted strict scalar decoder adaptation, preserving traversal/schema/overflow/size guards without changing browser source. |
| `photos-catalog.generated.mjs` | Parent's current verified public-catalog projection and generated data retained. |

Four candidate-only sections are the accepted funnel record/snapshot modules
and refund settlement/protected-store modules. Routing and runtime construction
in `deployed-worker.mjs` are byte-identical. Auth/user registry, connector/device
and enrollment paths, sidecar, registration preparation/replay, legacy identity,
public catalog authority, native video/campaign delivery, private real-estate
assets and email behavior are retained. Outside `worker/`, the captured main
bundle contains the earlier `catalog-sqlite.js` reader used by the intentionally
adapted decoder; its scalar dependency is accounted for above. The injected
Tilbury import, final exports and wrapper were inspected separately.

No additional dropped unrelated application behavior was demonstrated.
The captured main's generated catalog has 6,359 identities; all remain in the
parent's current 6,360-identity projection. Pricing/resolution/frame/video-policy
configuration in those sections is identical. Current catalog metadata comes
from the parent's newer verified projection; this reconciliation does not
regenerate or revert it.

## Installed publisher compatibility

The installed Backstage runtime was read as source only. Its
`owner_catalog_projection.py` and `catalog_authority_client.py` match the
candidate byte-for-byte, SHA-256 respectively
`262742de12cf1ad3d9585776266fc4a026b40137c36dbf666500dee7a1b582a1` and
`40b616c0daeab901a0be791ce71143a657122917e15b96592b6ec50ffb2a7cea`.

The newer/different installed `native_publication_pipeline.py` was inspected
through `publish_verified_asset` and its relevant callers:

- `native_catalog_promotion` uses the same projection schema/store hooks;
  prepare/verify/commit consume the retained catalog authority API and exact
  generation/revision/hash/publisher receipt fields.
- `public_access_verification` posts exact identities/previews to
  `/api/v1/lifecycle/public-previews/verify`, validating the existing read-only
  observation schema and five-minute bound.
- `public_preview_registration` uses connector-only reconciliation preparation
  (`prepareOnly`) and replays the returned exact envelope at
  `/api/v1/lifecycle/reconcile`. Candidate routes, bounds, schemas and authority
  checks match the captured live application.
- Fixture editions, upload queue/status/cancellation overlays and R2 worker
  recovery changes remain native-local concerns; no new Worker contract was
  required by the inspected callers. They are not copied into this candidate.

No installed app, native build, enrollment, configuration or canonical database
was changed. This establishes source compatibility for the inspected callers,
not fresh native publication or end-to-end provider acceptance.

## Offline validation and release limits

`npm run worker:release-check` passed 347 registered focused Node tests, 55
temporary-database/injected-transport Python tests and the generated Owner API
contract check (49 operations, 19 schemas). New regressions cover all four live offers, setup/auth/ZIP
guards, fixed price activation, signed webhook replay, paid/free/historical
entitlements, email/letter idempotency and refund denial. The actual combined
workerd entrypoint tests both private RPCs, HTTP non-exposure, Tilbury routing
and malformed/unrelated PBE webhook fallthrough. Parent-accepted refund and
recovery tests, including migration0018 in disposable local D1, remain intact.

A separate private workerd fixture executes the exact two captured modules and
the actual candidate entrypoint with the real approved local ZIP, real SHA-256,
synthetic credentials and intercepted outbound requests. Both produce the same
successful/replayed provisioning receipts and provider operation payloads;
only SDK-generated random retry UUIDs are normalized. Explicit product/price
idempotency keys and URL queries compare exactly. No product bytes are committed.

Public SQLite remains SHA-256
`f210bc0b6a6e7bfb29e89dae2189ee09775f3f85950b6e0c8ebfde085972ce2c`;
pricing remains `4ffa3c68fc2666a5d8fb4bb317777ca0040fdc0979c572b2754006254460897f`.
Generated catalog/bootstrap/sidecar bytes, refund migration0018, configuration,
WST receiver identity and collection-OFF state are untouched.

Parent gates remain: migrations0018 and0015 (including the absent OAuth table),
new release identity/full artifact checks, static publishing-source adoption,
guard-aware rollback and separately authorized deployment/provider acceptance.
This child performs no provider calls, analytics reads, credential access,
remote migration, deployment, main push, ticket or shared timelog/telemetry write.
