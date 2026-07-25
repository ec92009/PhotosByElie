# Owner and Backstage capability parity

This inventory is the acceptance baseline for PBB-1 and PBB-11. It separates
the public/client web application from private owner capabilities and records
the authoritative store for every mutation.

## Boundary rules

- `Owner.sqlite` on Max remains the private owner source of truth and the sole
  writer for catalog curation, fixtures, culling, metadata, lifecycle, and
  Apple Photos receipts.
- The Worker is the authentication, authorization, audit, action-ledger, D1,
  R2, delivery, and sharing boundary.
- A browser or native app may create an opaque Worker action. It never sends a
  raw local SQLite operation to a localhost mutation endpoint.
- Max claims an exact action with its connector credential, validates the
  target and action kind, performs the local mutation, and completes or fails
  the action in the Worker.
- Apple Photos mutations continue through the signed Photos Bridge app. The
  native Backstage app may use PhotoKit for reads, selection, and exports, but
  it does not create a second metadata writer.
- Legacy Worker routes remain compatibility adapters during migration. New
  clients use the formal `/api/v1` surface.

## Capability matrix

| Area | Existing implementation | Source of truth / boundary | `/api/v1` resource | Native milestone |
| --- | --- | --- | --- | --- |
| Owner authentication | Google OAuth owner session; connector bearer credential | Worker auth and session verifier | `/auth/*`, `/owner/session` | Secure sign-in, Keychain token storage, sign-out |
| Owner activity | Owner queue and audit views | Worker action ledger + `Owner.sqlite` receipts | `/actions`, `/actions/{id}` | Activity sidebar with durable status and diagnostics |
| Connectors | Heartbeat, exact claim, direct local wake, poll fallback | Worker ledger; connector credential | `/connectors/*` | Connectivity indicator and retry-safe action submission |
| People | Create/update/disable; roles and gallery access | D1 access registry | `/acs/people*` | Searchable people editor |
| Groups | Create/update/archive; membership | D1 access registry | `/acs/groups*` | Group editor with membership |
| Access assignments | Person/group gallery access and audit undo | D1 access registry | `/acs/state`, `/acs/gallery-access`, `/acs/audit/*` | Access workspace with effective-access preview |
| Fixtures | Root/sub-fixture hierarchy, seed, rename/move/archive/reopen | `Owner.sqlite`, through Worker action ledger | `/actions` plus `/fixtures/seed` | Fixture browser and create/move/archive flows |
| Universal search | Catalog and Photos-index search | `Owner.sqlite` and local Photos index | `/actions` | Native search and fixture assignment |
| Sidecar culling | Query, apply, batch apply, upsert | Worker sidecar state + local receipts | `/sidecar/decisions/*` | Keyboard culling and batch decisions |
| Metadata review | Title/keyword proposals, accept/undo, blacklist | `Owner.sqlite`; Photos Bridge give-back | `/actions` | Compare, edit, approve, undo, blacklist |
| Waste Basket | Hide, restore, discard, empty; recover saved title | `Owner.sqlite` lifecycle state | `/actions` | Multi-select lifecycle workspace |
| Upload bridge | Queue, R2 upload, collision/receipt accounting | `Owner.sqlite`, private/public R2 | `/actions` | Upload queue with progress and cancellation |
| Apple Photos give-back | Signed-app batch read, explicit batch mutation, re-read verification and independently retryable receipts | Signed Photos Bridge app | `/actions` | Native dry run, explicit commit, verified/failed receipts and failed-only retry |
| Delivery | PDF/video assembly, status, view/download | Worker + R2 | `/deliverables*`, `/jobs*` | Delivery builder and download/share view |
| Sharing | Delivery links and fixture/gallery access | Worker + D1/R2 | `/delivery-links`, `/acs/*` | Share sheet and access assignment |
| Publication | Static catalog generation, validation, deploy | Max connector and GitHub Pages | `/actions` | Rehearsal report and explicit publish action |

### Native implementation status

As of the PBB-16 checkpoint, the People, Groups, Fixtures, Universal search,
Sidecar culling, Metadata review, and Apple Photos give-back rows have native
OwnerCore services and SwiftUI workflow screens. Their mutation boundaries are
covered by native request/action tests: ACS uses canonical authenticated API
requests, culling uses the batch decision endpoint, and fixture/metadata
operations remain opaque audited Max actions. Waste Basket, upload, delivery,
sharing, publication, and the final reversible parity rehearsal remain later
PBB-11 children; this checkpoint does not retire any web Owner surface.

## Action kinds

The action ledger is intentionally extensible. The currently supported owner
families include fixture management, PhotoKit/Photos-index refresh, metadata
review, photo moderation, Sidecar upload, R2 cleanup and static publication.
Every native mutation maps to one of these existing action families or adds a
new versioned kind with a connector test before the UI exposes it.

## Parity evidence

Each row is complete only when all of these exist:

1. a formal `/api/v1` request/response contract;
2. an authenticated Worker or compatibility-adapter test;
3. a connector/local-state test for private mutations;
4. a native `OwnerCore` model/client fixture;
5. a reversible end-to-end rehearsal that leaves public/client behavior
   unchanged.

Web Owner retirement is out of scope until the PBB-18 rehearsal proves every
row and an explicit rollback path.
