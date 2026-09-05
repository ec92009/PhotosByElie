# Backstage regression contracts

Run from the repository root on the canonical `release/backstage` worktree:

```sh
npm ci
npm test
swift test --package-path native/PhotosByElieBackstage
```

`npm test` includes browser/Worker contracts and the Python fixture/adapter
suite. The Swift package executes native state, view-model, persistence,
service, and update contracts against injected test data. Successful source
tests are distinct from a signed build, installed-app checks, and owner
acceptance; follow [the sequential cycle](../sops/PBB_SEQUENTIAL_CYCLE_SOP.md).

## Ownership after workflow extraction

`scripts/native_culling_parity_test.py` checks UI and adapter composition:
visible labels, control bindings, handler entry points, inert Canvas wiring,
and calls into the owning workflow service. It must not require moved private
fields to remain in `BackstageViewModel.swift` or infer asynchronous correctness
from a substring's presence.

| Contract | Executable Swift coverage |
| --- | --- |
| Saved Gallery views and legacy navigation identity | `BackstageFixtureSelectionTests.gallerySavedViewsPreserveCullingPersistence` |
| Gallery request ownership, selection and filter cancellation | `BackstageGalleryWorkflowStateTests` and Gallery filter integration cases |
| Thumbnail timeout, retry, upgrade cancellation and stale completion | `BackstageFixtureSelectionTests` thumbnail integration cases |
| Review generations, selection, autosaves and AI refresh ownership | `BackstageReviewWorkflowStateTests` |
| Incremental AI draft replacement and manual-edit preservation | Review workflow-state proposal hydration cases |
| Update discovery, verified-download reuse, install latch and stale results | `BackstageUpdateWorkflowStateTests` |
| Optimistic Waste Basket X, immediate local Undo, deferred Put Back and failures | `BackstageFixtureSelectionTests` lifecycle integration cases |

The immediate-Undo test explicitly holds X and Put Back at the mocked API
boundary until each intermediate state has been checked. It includes a delay
longer than the former 200 ms auto-completion timer. Bounded polling observes
state changes; elapsed time never decides when the mock operation completes.
A rehearsal with the former timer reproduced the failed pending-X assertions.
Use `swift test --package-path native/PhotosByElieBackstage --skip-build` for
repeat suite runs only after compiling the exact current test sources.

## Separate publication validation

`npm run validate` first checks the generated Owner API contract and then
requires an **explicitly reviewed absolute path** to a read-only Owner snapshot:

```sh
PHOTOSBYELIE_OWNER_DB=/absolute/path/to/reviewed/Owner.sqlite npm run validate
```

This example is a placeholder, not an instruction to copy or create a database.
Do not substitute an unreviewed live database, create/migrate one implicitly,
or treat a missing-snapshot rejection as a validation pass. Record the exact
snapshot and result when that separate publication gate is authorized and
supplied. Synthetic regression fixtures do not establish production catalog
readiness.
