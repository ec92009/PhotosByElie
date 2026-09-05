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
