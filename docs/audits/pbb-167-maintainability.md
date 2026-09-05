# PBB-167 bounded maintainability work

Baseline source: `e3a5690c` on canonical `release/backstage`. The pinned report excludes generated code and DEBUG preview fixtures: 84 production Swift files, 42,970 effective lines, 1,714 functions; 7 files excluded. Review triggers: 11 files above 1,000 NLOC, 85 functions above 60 NLOC, 42 above CCN 15, 64 above six parameters, 74 above four nested structures. This narrower production-only scope differs from historical line counts that included preview code.

New characterization tests passed **before** extraction: later-target Review failure rolls back the entire database, Culling bounded pages preserve complete summaries and database bytes, and refund state changes notify the root view model immediately. Existing 390 native tests remain the wider regression baseline.

## Baseline outliers

| File/function | NLOC | CCN | Parameters | Nesting |
| --- | ---: | ---: | ---: | ---: |
| OwnerReviewSQLiteStore.swift: applyReview | 662 | 96 | 13 | 19 |
| OwnerCullingSQLiteStore.swift: cullingWindow | 369 | 68 | 18 | 4 |
| BackstageReviewWorkflowState.swift: applying | 48 | 55 | 2 | 1 |
| BackstageViewModel.swift: applyReviewAction | 171 | 44 | 3 | 4 |
| BackstageViewModel.swift: chooseExternalEditReturnDirectory | 222 | 44 | 0 | 1 |
| FixtureWorkflowService.swift: init | 46 | 44 | 1 | 0 |
| BackstageViewModel.swift: retainReviewResultInCurrentWindow | 111 | 40 | 2 | 3 |
| FixtureDeliveryService.swift: nativeUploadPlan | 69 | 40 | 4 | 2 |
| OwnerReviewSQLiteStore.swift: reviewWindowItem | 85 | 36 | 1 | 0 |
| BackstageViewModel.swift: startNativePublication | 167 | 34 | 2 | 6 |
| PBEOwnerNativeHostService.swift: startHost | 222 | 33 | 0 | 6 |
| BackstageViewModel.swift: undoLastCullingDecision | 189 | 32 | 0 | 6 |

## Boundary choices

Review action handlers will share one caller-owned transaction and connection. Culling query construction, filtering and page assembly will keep their current order and read-only connection. Refund coordination will own its state and API work while preserving root-view observation and authentication recovery. No schema, authorization, publication or user-visible workflow change is intended.

## Implemented bounded increment

Review's per-asset action handlers share the original connection and outer transaction. Validation, normalized inputs, proposal conflict checks, eligibility recomputation, audit snapshots and Undo remain in the store. Helpers never commit independently. Culling query construction and capture/selection filters are separate; search, alias collapse, placement, summary and paging retain their order. Refund state/API work lives in an observable workflow with synchronous forwarding to the root view model; update admission and authentication recovery remain app-owned.

| Measured source | Before NLOC / CCN | After NLOC / CCN |
| --- | --- | --- |
| Review applyReview | 662 / 96 | 250 / 43 |
| Culling cullingWindow | 369 / 68 | 148 / 25 |
| Review store file | 1,991 | 1,579 |
| Culling store file | 1,039 | 901 |
| BackstageViewModel file | 8,858 | 8,824 |

New files: Review mutation handlers 515 NLOC, Culling query 198, refund workflow 99. All new executable helpers are below 60 NLOC and CCN 15 except the explicitly reviewed 96-NLOC/CCN-5 SQL projection. Four exact `ns` exceptions cover flat switch/SQL-binding parser counts; they are not waivers for new deep control nesting. Original public parameter-rich APIs remain compatible. Existing ceilings ratchet downward.

The root view model remains substantial debt. This ticket establishes repeatable enforcement and three tested ownership boundaries rather than claiming the whole app has been rewritten. Overall: 87 production files, 43,198 NLOC, 1,750 functions, 7 excluded; 10 files exceed 1,000, 86 functions exceed 60, 42 exceed CCN 15, 64 exceed six parameters and 78 exceed parser nesting 4. Helper boilerplate increases total NLOC; peak responsibilities and changed-function complexity decrease. The new SQL function makes its previously embedded projection visible to function metrics.

## Source validation

392 Swift tests in 31 suites pass, including the pre-extraction rollback/paging contracts, refund observation, delayed duplicate/stale/failure paths, lifecycle/update/upload, edit-return and sold-source protections. All 328 Node checks pass. The 509-test Python run found one source-location assertion after Culling SQL moved; it was updated to inspect the extracted query while preserving unique-identity and no-filename requirements, then the Culling parity suite was rerun. Xcode source membership includes all three new files and the project file validates. No live refund or photo edit was performed.

Signed release target: v249.6 build320. Installed evidence is recorded after replacement and UI inspection.
