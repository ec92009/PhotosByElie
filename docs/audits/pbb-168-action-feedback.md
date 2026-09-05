# PBB-168 action feedback and interlocks

Scope: native Backstage on `release/backstage`. This inventory includes SwiftUI buttons, toggles, fields, pickers, sliders, keyboard/accessibility activation declarations and explicit AppKit action handlers. It is source coverage, not a claim that every control was individually timed in a live account.

## Workflow review

| Workflow | Acknowledgement and duplicate guard | Conflict and stale-result handling | Persistent progress and terminal evidence |
| --- | --- | --- | --- |
| Refund | Synchronous preview/confirm entry captures input and sets busy before creating its Task | Duplicate preview/confirm suppressed; edited order rejects stale response; update and quit wait; fresh preview required after submission failure | Stripe check/submission status; explicit failure and recheck guidance; delayed fake-transport regression, no payment |
| Photos previews/index/export | Loading/index/authorization latches before service suspension | Shared Photos maintenance conflict; existing per-thumbnail generations, bounded cancellation and retry | Photo status, bounded thumbnail timeout, export receipts; existing delayed Photos tests |
| Sync/equipment backfill | Busy guard plus mutually disabled start/retry controls | Symmetric conflict with review, fixture, metadata, Photos indexing, AI, cloud work, update and external edit; pending autosave blocks start | Recorded batch counts and checkpoints, cancellation receipt; no invented ETA |
| Gallery decisions and Undo | Mutation latch before readiness await; existing immediate optimistic X/Undo paths retained | Maintenance guard and enqueue duplicate guard; exact selection/window snapshots, rollback on failed durable action | Counted batches, pending action IDs, safe cancellation and restore receipts |
| Review and AI | Existing review/AI latches and pending-action ledgers; handlers enforce AI cloud/update/external-edit conflicts | Generation-owned window requests, draft preservation, exact pending-action reconciliation; blocked autosave reschedules | AI counts and durable action details; explicit success/failure/cancel receipts; existing delayed, stale and retry tests |
| External edit | Synchronous prepare/import latch before Task | Handler checks maintenance/cloud/AI/update; existing active-job and per-return guards | Ordered export count, import steps, persisted job receipt; active job remains separate from a busy import |
| Fixture tree/search/snapshots/policy | Shared fixture operation latch; helper-specific guards prevent a duplicate clearing another call's flag | Fixture selection freezes during write/policy/maintenance; create/rename capture fields before authentication await | Search/snapshot/policy statuses plus shared ordered feedback |
| Access people/groups | Shared access latch before authentication await | Captured person/group/disable-target values cannot drift with editable form fields | Loading/save/archive receipts and recoverable errors |
| Metadata | Shared review/give-back latch; retry also uses it | Captured fixture/scope; stale reports rejected; maintenance conflict | Plan/commit counts; saving status now marked working |
| Upload/delivery/catalog/R2 | Existing cloud workflow and publication serials | Cloud/AI/update/external-edit/maintenance interlocks; cancellation remains available | Durable run IDs, batch counts, current stage, receipts and recovery |
| Updates/quit | Existing update serials and atomic install state | Refund and maintenance additionally block update; refund joins shutdown drain | Download bytes, verification/install states, rollback/launch receipt; quit names blockers |
| Navigation, filters and display settings | Synchronous selection/filter state acknowledges activation | Generation-based refresh replaces stale reads; unrelated display controls remain usable | Current selection, filter and preview state |

The shared feedback view now displays the completed start, actual current status and remaining result step while working; it does not auto-dismiss active work, truncate status to two lines, or invent percentages/ETAs. Existing workflows with real batch/byte counts retain those counts.

## Verification boundary

New regressions cover held refund responses, duplicate activation, cancellation of confirmation, captured reason, stale order, failed submission and recheck; a table of maintenance conflicts and both directions; shutdown/update blocking; duplicate fixture helper latches. Existing regression coverage includes delayed Photos, AI and update operations, pending X/Undo, durable failure rollback, stale previews and retry. Installed build and final test receipts are recorded below after verification.

## Control references

Each row is a source declaration to inspect together with its containing workflow and shared handler. Dynamic rows use the same handler for each data item. Source line numbers refer to this implementation and can shift with later refactoring.

| Source | Line | Declaration |
| --- | ---: | --- |
| BackstageAppKitAdapters.swift | 752 | `@objc private func selectQuickLookEditor(_ sender: NSPopUpButton) {` |
| BackstageAppKitAdapters.swift | 786 | `@objc private func selectQuickLookEditJobAction(_ sender: NSPopUpButton) {` |
| BackstageAppKitAdapters.swift | 998 | `@objc func invoke() {` |
| BackstageWindowState.swift | 217 | `@objc private func windowFrameDidChange(_ notification: Notification) {` |
| CullingCanvasControls.swift | 10 | `TextField("Search title, file, keyword, or equipment", text: $model.cullingSearch)` |
| CullingCanvasControls.swift | 13 | `.onSubmit { model.applyCullingFilters() }` |
| CullingCanvasControls.swift | 17 | `Button(savedView.rawValue) {` |
| CullingCanvasControls.swift | 24 | `Button("Review picked") { model.showPickedReview() }` |
| CullingView.swift | 435 | `Button("Return \(model.cullingReturnToReviewEligibleIDs.count.formatted()) to Review") {` |
| CullingView.swift | 439 | `Button("Cancel", role: .cancel) {}` |
| CullingView.swift | 522 | `Toggle(` |
| CullingView.swift | 565 | `Toggle("Bursts", isOn: $model.galleryBurstsOnly)` |
| CullingView.swift | 573 | `TextField("From", text: $model.galleryDateFrom)` |
| CullingView.swift | 577 | `TextField("To", text: $model.galleryDateTo)` |
| CullingView.swift | 588 | `Picker("Megapixel comparison", selection: $model.galleryMegapixelComparison) {` |
| CullingView.swift | 596 | `TextField("Count", text: $model.galleryMegapixelValue)` |
| CullingView.swift | 605 | `Toggle(` |
| CullingView.swift | 617 | `Toggle(` |
| CullingView.swift | 629 | `Toggle(` |
| CullingView.swift | 638 | `Toggle("RAW backing", isOn: $model.galleryRawBackingOnly)` |
| CullingView.swift | 642 | `Button("Clear filters") { model.clearCullingFilters() }` |
| CullingView.swift | 690 | `Button("Previous \(workspace.limit)") {` |
| CullingView.swift | 695 | `Button("Next \(workspace.limit)") {` |
| CullingView.swift | 702 | `Button("−") { decreaseCullingThumbnailSize() }` |
| CullingView.swift | 706 | `Button("+") { increaseCullingThumbnailSize() }` |
| CullingView.swift | 711 | `Button(model.cullingUsesFill ? "Fill" : "Fit") {` |
| CullingView.swift | 829 | `.onTapGesture {` |
| CullingView.swift | 836 | `Button(editor.name) {` |
| CullingView.swift | 841 | `Button("Choose another app…") {` |
| CullingView.swift | 874 | `Button("Show \(model.cullingMatchCount(for: view).formatted()) \(view.label)") {` |
| CullingView.swift | 950 | `Button("P Pick") {` |
| CullingView.swift | 957 | `Button("H Hide") {` |
| CullingView.swift | 964 | `Button("U \(model.cullingClearDecisionLabel)") {` |
| CullingView.swift | 978 | `Button("R Return to Review…") {` |
| CullingView.swift | 990 | `Button("X Waste Basket") {` |
| CullingView.swift | 1022 | `return Button {` |
| CullingView.swift | 1072 | `Button("Undo") { Task { await model.undoLastCullingDecision() } }` |
| CullingView.swift | 1073 | `.keyboardShortcut("z", modifiers: .command)` |
| CullingView.swift | 1100 | `Button("Stop") { model.cancelCullingOperation() }` |
| CullingView.swift | 1176 | `Button("View as customer", systemImage: "arrow.up.right.square") {` |
| CullingView.swift | 1181 | `Button("Open in Review") { model.sendCullingSelection(to: .review) }` |
| CullingView.swift | 1184 | `Button("Export selected originals…") {` |
| CullingView.swift | 1197 | `Button("All Photos") {` |
| CullingView.swift | 1202 | `Button("Allow Photos") {` |
| CullingView.swift | 1207 | `Button {` |
| CullingView.swift | 1232 | `Button {` |
| CullingView.swift | 1636 | `Button(thumbnailFailure.actionTitle) {` |
| CullingView.swift | 1827 | `.accessibilityAction(named: "Clear rating") {` |
| CullingView.swift | 1846 | `Button(action: action) {` |
| CullingView.swift | 1910 | `Button {` |
| FixturePicker.swift | 69 | `Button {` |
| FixturePicker.swift | 122 | `Button {` |
| FixturePicker.swift | 159 | `Button {` |
| PhotosByElieBackstageApp.swift | 71 | `Button("Return finished file…") {` |
| PhotosByElieBackstageApp.swift | 76 | `Button("Show return folder") {` |
| PhotosByElieBackstageApp.swift | 80 | `Button("Choose return folder…") {` |
| PhotosByElieBackstageApp.swift | 85 | `Button("Cancel edit job", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 102 | `Button {` |
| PhotosByElieBackstageApp.swift | 158 | `Button("Refresh Activity") {` |
| PhotosByElieBackstageApp.swift | 161 | `.keyboardShortcut("r")` |
| PhotosByElieBackstageApp.swift | 310 | `Button(title) {` |
| PhotosByElieBackstageApp.swift | 313 | `.keyboardShortcut(key, modifiers: modifiers)` |
| PhotosByElieBackstageApp.swift | 323 | `Button("Select All") {` |
| PhotosByElieBackstageApp.swift | 337 | `.keyboardShortcut("a", modifiers: .command)` |
| PhotosByElieBackstageApp.swift | 351 | `Button(model.currentUndoMenuTitle) {` |
| PhotosByElieBackstageApp.swift | 358 | `.keyboardShortcut("z", modifiers: .command)` |
| PhotosByElieBackstageApp.swift | 362 | `Button("Redo") {` |
| PhotosByElieBackstageApp.swift | 365 | `.keyboardShortcut("z", modifiers: [.command, .shift])` |
| PhotosByElieBackstageApp.swift | 401 | `Button("Set up this Mac") {` |
| PhotosByElieBackstageApp.swift | 407 | `Button(model.isCancellingMacSetup ? "Cancelling…" : "Cancel setup", role: .cancel) {` |
| PhotosByElieBackstageApp.swift | 413 | `Button("Check Keychain again") {` |
| PhotosByElieBackstageApp.swift | 429 | `Button("Enroll with code") {` |
| PhotosByElieBackstageApp.swift | 441 | `Button("Retry Owner session") {` |
| PhotosByElieBackstageApp.swift | 451 | `Button("Refresh session") {` |
| PhotosByElieBackstageApp.swift | 456 | `Button("Sign out", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 473 | `Button("Refresh") {` |
| PhotosByElieBackstageApp.swift | 503 | `Button("Revoke", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 522 | `Button("Revoke Mac", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 526 | `Button("Cancel", role: .cancel) {` |
| PhotosByElieBackstageApp.swift | 541 | `TextField("PBE order ID", text: $model.paidOrderRefundOrderID)` |
| PhotosByElieBackstageApp.swift | 544 | `Button("Check with Stripe") {` |
| PhotosByElieBackstageApp.swift | 588 | `TextField("Required support reason", text: $model.paidOrderRefundReason, axis: .vertical)` |
| PhotosByElieBackstageApp.swift | 593 | `Button("Review full refund…", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 614 | `Button("Issue full refund", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 618 | `Button("Cancel", role: .cancel) {` |
| PhotosByElieBackstageApp.swift | 633 | `Button(model.photoAccess == .notDetermined ? "Allow Photos" : "Refresh Photos access") {` |
| PhotosByElieBackstageApp.swift | 767 | `Button("Install and run new version") {` |
| PhotosByElieBackstageApp.swift | 841 | `Button("Load") { Task { await model.loadDeliverables() } }` |
| PhotosByElieBackstageApp.swift | 848 | `Picker("Product", selection: $model.deliverableKind) {` |
| PhotosByElieBackstageApp.swift | 854 | `TextField("Authenticated share URL", text: $model.deliverableShareLink)` |
| PhotosByElieBackstageApp.swift | 855 | `Button("Record ready link") { Task { await model.linkDeliverable() } }` |
| PhotosByElieBackstageApp.swift | 905 | `Button("Preview reconciliation") {` |
| PhotosByElieBackstageApp.swift | 910 | `Button("Apply guarded reconciliation…") { confirming = true }` |
| PhotosByElieBackstageApp.swift | 914 | `Button(model.isCancellingR2Reconciliation ? "Stopping…" : "Stop safely") {` |
| PhotosByElieBackstageApp.swift | 961 | `Button("Apply reconciliation", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 965 | `Button("Cancel", role: .cancel) {}` |
| PhotosByElieBackstageApp.swift | 1040 | `Button("View Activity") {` |
| PhotosByElieBackstageApp.swift | 1237 | `Button("Refresh") { Task { await model.loadLifecycle() } }` |
| PhotosByElieBackstageApp.swift | 1240 | `Button("Put back") { Task { await model.restoreLifecycleSelection() } }` |
| PhotosByElieBackstageApp.swift | 1249 | `Button("Delete Selected", role: .destructive) { confirmingDeleteSelected = true }` |
| PhotosByElieBackstageApp.swift | 1260 | `Button("Empty Waste Basket", role: .destructive) { confirmingEmpty = true }` |
| PhotosByElieBackstageApp.swift | 1302 | `Button(failure.actionTitle) {` |
| PhotosByElieBackstageApp.swift | 1373 | `Button("Quick Look") {` |
| PhotosByElieBackstageApp.swift | 1424 | `Button("Empty Waste Basket", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 1429 | `Button("Cancel", role: .cancel) { confirmingEmpty = false }` |
| PhotosByElieBackstageApp.swift | 1438 | `Button("Delete Selected", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 1443 | `Button("Cancel", role: .cancel) { confirmingDeleteSelected = false }` |
| PhotosByElieBackstageApp.swift | 1459 | `Button("Refresh") { Task { await model.refreshActions() } }` |
| PhotosByElieBackstageApp.swift | 1551 | `Button("Reload tree") { Task { await model.loadFixtures() } }` |
| PhotosByElieBackstageApp.swift | 1592 | `TextField("New fixture or new name", text: $model.fixtureName)` |
| PhotosByElieBackstageApp.swift | 1593 | `TextField("Template", text: $model.fixtureTemplate)` |
| PhotosByElieBackstageApp.swift | 1597 | `Button("Create child") {` |
| PhotosByElieBackstageApp.swift | 1606 | `Button("Create root") {` |
| PhotosByElieBackstageApp.swift | 1611 | `Button("Rename") { Task { await model.renameFixture() } }` |
| PhotosByElieBackstageApp.swift | 1618 | `Button("Archive / reopen") { Task { await model.toggleFixtureArchive() } }` |
| PhotosByElieBackstageApp.swift | 1628 | `TextField("Title, keyword, file, camera…", text: $model.fixtureSearch)` |
| PhotosByElieBackstageApp.swift | 1629 | `Button("Search") { Task { await model.searchFixtureAssets() } }` |
| PhotosByElieBackstageApp.swift | 1653 | `Button("Create stable culling snapshot") {` |
| PhotosByElieBackstageApp.swift | 1693 | `TextField(` |
| PhotosByElieBackstageApp.swift | 1775 | `Button("Save contract") {` |
| PhotosByElieBackstageApp.swift | 1812 | `Button("Place selected assets") {` |
| PhotosByElieBackstageApp.swift | 1821 | `Button("Review placements") {` |
| PhotosByElieBackstageApp.swift | 1835 | `Button(fixture.name) {` |
| PhotosByElieBackstageApp.swift | 1844 | `Button(placement.isActive ? "Remove" : "Restore") {` |
| PhotosByElieBackstageApp.swift | 1879 | `Button(model.isReloadingFixturePools ? "Reloading…" : "Reload snapshots") {` |
| PhotosByElieBackstageApp.swift | 1884 | `Button(model.isOpeningFixturePool ? "Opening…" : "Open selected in Gallery") {` |
| PhotosByElieBackstageApp.swift | 1915 | `Button(model.isOpeningFixturePool ? "Opening…" : "Open in Gallery") {` |
| PhotosByElieBackstageApp.swift | 1953 | `Button("Reload") { Task { await model.loadAccess() } }` |
| PhotosByElieBackstageApp.swift | 1966 | `Button("New") { model.newPerson() }` |
| PhotosByElieBackstageApp.swift | 1975 | `.onTapGesture { model.selectPerson(person.id) }` |
| PhotosByElieBackstageApp.swift | 1977 | `TextField("Email", text: $model.personEmail)` |
| PhotosByElieBackstageApp.swift | 1978 | `TextField("Display name", text: $model.personName)` |
| PhotosByElieBackstageApp.swift | 1983 | `Toggle(` |
| PhotosByElieBackstageApp.swift | 1997 | `Button("Save person & access") { Task { await model.savePerson() } }` |
| PhotosByElieBackstageApp.swift | 2000 | `Button("Disable", role: .destructive) { Task { await model.disablePerson() } }` |
| PhotosByElieBackstageApp.swift | 2017 | `Button(group.isArchived ? "Archived" : "Archive") {` |
| PhotosByElieBackstageApp.swift | 2027 | `TextField("Stable group ID", text: $model.groupID)` |
| PhotosByElieBackstageApp.swift | 2028 | `TextField("Label", text: $model.groupName)` |
| PhotosByElieBackstageApp.swift | 2029 | `Picker("Kind", selection: $model.groupKind) {` |
| PhotosByElieBackstageApp.swift | 2035 | `Button("Save group") { Task { await model.saveGroup() } }` |
| PhotosByElieBackstageApp.swift | 2119 | `Button("Sync now") {` |
| PhotosByElieBackstageApp.swift | 2148 | `Button(model.equipmentBackfillReport?.remaining ?? 0 > 0 ? "Resume backfill" : "Start backfill") {` |
| PhotosByElieBackstageApp.swift | 2154 | `Button("Stop safely") {` |
| PhotosByElieBackstageApp.swift | 2161 | `Button("Retry unavailable & failed") {` |
| PhotosByElieBackstageApp.swift | 2191 | `TextField("Asset ID", text: $model.metadataAssetID)` |
| PhotosByElieBackstageApp.swift | 2192 | `Button("Use selected Photos item") { model.useSelectedPhotoForMetadata() }` |
| PhotosByElieBackstageApp.swift | 2205 | `TextField("Title", text: $model.metadataTitle)` |
| PhotosByElieBackstageApp.swift | 2206 | `TextField("Caption", text: $model.metadataCaption)` |
| PhotosByElieBackstageApp.swift | 2207 | `TextField("Comma-separated keywords", text: $model.metadataKeywords)` |
| PhotosByElieBackstageApp.swift | 2209 | `Button("Save title, caption & keywords") {` |
| PhotosByElieBackstageApp.swift | 2214 | `Button("Undo last change") {` |
| PhotosByElieBackstageApp.swift | 2217 | `.keyboardShortcut("z", modifiers: .command)` |
| PhotosByElieBackstageApp.swift | 2230 | `TextField("Keyword blacklist (comma-separated)", text: $model.metadataBlacklist)` |
| PhotosByElieBackstageApp.swift | 2231 | `Button("Replace blacklist") {` |
| PhotosByElieBackstageApp.swift | 2248 | `TextField("Model", text: $model.metadataModelLadder[index].model)` |
| PhotosByElieBackstageApp.swift | 2250 | `TextField("Effort", text: $model.metadataModelLadder[index].effort)` |
| PhotosByElieBackstageApp.swift | 2257 | `Button("↑") {` |
| PhotosByElieBackstageApp.swift | 2262 | `Button("↓") {` |
| PhotosByElieBackstageApp.swift | 2267 | `Button(role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 2276 | `Button("Add rung") {` |
| PhotosByElieBackstageApp.swift | 2280 | `Button("Save ladder") {` |
| PhotosByElieBackstageApp.swift | 2318 | `Button("Preview changes") {` |
| PhotosByElieBackstageApp.swift | 2323 | `Button("Commit & verify") {` |
| PhotosByElieBackstageApp.swift | 2331 | `Button("Retry failed only") {` |
| PhotosByElieBackstageApp.swift | 2371 | `Button("Commit and verify \(model.metadataReport?.readyCount ?? 0) item\((model.metadataReport?.readyCount ?? 0) == 1 ? "" : "s")", role: .destructive) {` |
| PhotosByElieBackstageApp.swift | 2375 | `Button("Cancel", role: .cancel) {}` |
| PhotosByElieBackstageApp.swift | 2387 | `Button {` |
| ReviewCanvasInspector.swift | 22 | `Picker(` |
| ReviewCanvasInspector.swift | 38 | `Button {` |
| ReviewCanvasInspector.swift | 78 | `TextField(` |
| ReviewCanvasInspector.swift | 88 | `Button {` |
| ReviewCanvasInspector.swift | 97 | `TextField(` |
| ReviewCanvasInspector.swift | 108 | `Button {` |
| ReviewView.swift | 271 | `TextField("Search complete Review queue", text: $model.reviewSearch)` |
| ReviewView.swift | 273 | `.onSubmit {` |
| ReviewView.swift | 277 | `Button("Search") {` |
| ReviewView.swift | 283 | `Button("Refresh") {` |
| ReviewView.swift | 288 | `Button("Select burst") {` |
| ReviewView.swift | 319 | `Button("Replace \(model.reviewProposalConflictIDs.count) conflicting draft\(model.reviewProposalConflictIDs.count == 1 ? "" : "s")") {` |
| ReviewView.swift | 327 | `Button(` |
| ReviewView.swift | 337 | `Button(model.isCancellingAIPass ? "Cancelling…" : "Cancel") {` |
| ReviewView.swift | 344 | `Toggle("Nightly AI at 02:00 (Madrid)", isOn: $model.nightlyAIJobsEnabled)` |
| ReviewView.swift | 371 | `Button("Previous \(model.reviewWindowLimit)") {` |
| ReviewView.swift | 376 | `Button("Next \(model.reviewWindowLimit)") {` |
| ReviewView.swift | 401 | `.onTapGesture {` |
| ReviewView.swift | 407 | `Button(editor.name) {` |
| ReviewView.swift | 413 | `Button("Choose another app…") {` |
| ReviewView.swift | 495 | `Button("Open in Gallery") {` |
| ReviewView.swift | 507 | `Button(editor.name) {` |
| ReviewView.swift | 515 | `Button("Choose another app…") {` |
| ReviewView.swift | 520 | `Button("Choose return folder…") {` |
| ReviewView.swift | 528 | `Button("Return finished file…") {` |
| ReviewView.swift | 534 | `Button("Choose return folder…") {` |
| ReviewView.swift | 538 | `Button("Show return folder") {` |
| ReviewView.swift | 542 | `Button("Cancel edit job") {` |
| ReviewView.swift | 551 | `Button("Undo") {` |
| ReviewView.swift | 554 | `.keyboardShortcut("z", modifiers: .command)` |
| ReviewView.swift | 562 | `Button("Clear selection") { model.clearReviewSelection() }` |
| ReviewView.swift | 673 | `Toggle(` |
| ReviewView.swift | 682 | `Toggle(` |
| ReviewView.swift | 690 | `Toggle(` |
| ReviewView.swift | 759 | `Button("Keep in Review") { dismiss() }` |
| ReviewView.swift | 760 | `.keyboardShortcut(.defaultAction)` |
| ReviewView.swift | 1018 | `Button("Close") { dismiss() }` |
| ReviewView.swift | 1019 | `.keyboardShortcut(.cancelAction)` |
| ReviewView.swift | 1177 | `Button("Approve") {` |
| ReviewView.swift | 1181 | `.keyboardShortcut("a", modifiers: [])` |
| ReviewView.swift | 1183 | `Button("Hide") {` |
| ReviewView.swift | 1187 | `.keyboardShortcut("h", modifiers: [])` |
| ReviewView.swift | 1189 | `Button("Waste Basket") {` |
| ReviewView.swift | 1196 | `.keyboardShortcut("x", modifiers: [])` |
| ReviewView.swift | 1198 | `Button("Unpick") {` |
| ReviewView.swift | 1202 | `.keyboardShortcut("u", modifiers: [])` |
| ReviewView.swift | 1204 | `Button("Needs AI") {` |
| ReviewView.swift | 1226 | `Button {` |
| ReviewView.swift | 1241 | `TextField(` |
| ReviewView.swift | 1260 | `Button {` |
| ReviewView.swift | 1288 | `Button("Accept draft") {` |
| ReviewView.swift | 1293 | `Button("Reject draft") {` |
| ReviewView.swift | 1298 | `Button("Regenerate unavailable") {}` |
| ReviewView.swift | 1309 | `Button("Request visual draft unavailable") {}` |
| ReviewView.swift | 1317 | `Button(model.isREReviewScope ? "Compare original / proposal" : "Quick Look") {` |
| ReviewView.swift | 1320 | `.keyboardShortcut(.space, modifiers: [])` |
| UploadHeaderView.swift | 26 | `Button(plan.order.alternateLabel) {` |
| UploadHeaderView.swift | 38 | `Button("Load next 200") {` |
| UploadHeaderView.swift | 44 | `Button("Upload selection…") {` |
| UploadHeaderView.swift | 53 | `Button(model.isRunningCatalogRecovery ? "Recovering catalog…" : "Recover catalog entries…") {` |
| UploadHeaderView.swift | 61 | `Button(model.isDeployingPublicCatalog ? "Deploying & verifying…" : "Deploy & verify website…") {` |
| UploadView.swift | 85 | `Button(` |
| UploadView.swift | 165 | `Button("Open in Gallery") {` |
| UploadView.swift | 175 | `Button("Return to Review…") {` |
| UploadView.swift | 180 | `Button("Hide…") {` |
| UploadView.swift | 185 | `Button("Clear selection") {` |
| UploadView.swift | 203 | `Button("Retry loading uploads") {` |
| UploadView.swift | 230 | `Button(model.isCancellingNativePublication ? "Stopping…" : "Stop safely") {` |
| UploadView.swift | 248 | `Button(model.isRunningNativePublication ? "Retrying…" : "Retry same run") {` |
| UploadView.swift | 276 | `Button("Load receipt audit") { Task { await model.loadDeliveryPlan() } }` |
| UploadView.swift | 279 | `Button("Queue health") { Task { await model.loadUploadHealth() } }` |
| UploadView.swift | 282 | `Button("Retry legacy failures") { Task { await model.retryDeliveryFailures() } }` |
| UploadView.swift | 296 | `TextField("Upload Bridge run ID", text: $model.uploadRunID)` |
| UploadView.swift | 297 | `Button("Preview adoption") {` |
| UploadView.swift | 307 | `Button("Adopt verified run…") { confirmingAdoption = true }` |
| UploadView.swift | 347 | `Button("Return \(model.selectedDeliveryIDs.count) to Review") {` |
| UploadView.swift | 351 | `Button("Cancel", role: .cancel) {}` |
| UploadView.swift | 360 | `Button("Hide \(model.selectedDeliveryIDs.count) assets", role: .destructive) {` |
| UploadView.swift | 364 | `Button("Cancel", role: .cancel) {}` |
| UploadView.swift | 373 | `Button("Adopt exact eligible items", role: .destructive) {` |
| UploadView.swift | 377 | `Button("Cancel", role: .cancel) {}` |
| UploadView.swift | 386 | `Button("Upload selection") {` |
| UploadView.swift | 390 | `Button("Cancel", role: .cancel) {}` |
| UploadView.swift | 399 | `Button("Upload all \(model.nativeUploadPlan?.needsUploadCount ?? 0) assets") {` |
| UploadView.swift | 403 | `Button("Cancel", role: .cancel) {}` |
| UploadView.swift | 416 | `Button("Recover catalog entries") {` |
| UploadView.swift | 420 | `Button("Cancel", role: .cancel) {}` |
| UploadView.swift | 429 | `Button("Deploy & verify website") {` |
| UploadView.swift | 433 | `Button("Cancel", role: .cancel) {}` |

## Source checks

389 Swift tests in 31 suites passed. The repository suite passed 328 Node tests and 508/509 Python tests; its one source-text parity test had two intentionally changed expectations. After updating those expectations, all 71 tests in that parity module passed. The complete suite is rerun against this candidate before installation. No live payment, Photos mutation, or cloud publication was used as test data.

## Installed iteration

Build 318 (`d6dff2b2`) was signed, installed through the production Backstage installer, launched and inspected. The previous app required **Wait and Quit** for a Review update; it drained normally. Installed AX showed the new ordered busy feedback, re-enabled Review controls after completion, and immediate local Metadata validation with no edit submitted. The installation has a retained build-317 rollback.

That inspection found the Review count receipt appeared before visual-draft/AI status loading finished. The follow-up names cached-size, visual-draft and AI-status steps and publishes the count only after completion; generation checks prevent an older final receipt from replacing a newer refresh. A held-action regression reproduces the ordering and checks the newer receipt remains intact. The final candidate is build 319.

Graphify was refreshed in the same canonical worktree (4,711 nodes; 16,238 edges), with a backup of the prior root graph. Its parser reports partial extraction in five Swift files; successful Swift compilation, source inspection and tests are the authority for those files.
