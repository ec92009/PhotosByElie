# Getting started with PhotosByElie Backstage

PhotosByElie Backstage is the private macOS workspace for organizing,
reviewing, uploading, delivering, and publishing Photos By Elie media.
The public website and client galleries remain separate.

Backstage is currently installed on Max at:

`/Applications/PhotosByElie Backstage.app`

The installed build's exact version and build are shown in the Backstage
toolbar and in the **Updates** workspace; do not rely on a copied version label
from an older handoff.

Open it from Finder, Spotlight, or the system Applications folder.

Every Backstage button explains its action after the pointer rests on it for
half a second. The explanation describes the affected scope and whether the
button previews, confirms, commits, reverses, publishes, or merely navigates;
disabled buttons retain the same explanation. VoiceOver receives that text as
the button's accessibility hint.

## The five-minute safe start

1. Open **PhotosByElie Backstage**.
2. In **Overview**, confirm that **Authentication** says **Authenticated** and
   that no orange connection warning appears in the toolbar.
3. Open **Gallery** and choose **Allow Photos** if macOS asks for permission.
   Grant full Photos access. Backstage should report how many recent Photos
   previews it cached.
4. Open **Fixtures** and choose **Reload tree**. Confirm that the current
   fixture hierarchy appears. Root fixtures such as Expo and RE expand to
   reveal their children; the breadcrumb below the tree confirms the active
   path.
5. Open **Activity** and choose **Refresh**. This is the audit trail for
   Backstage actions.

Those checks are read-only. They do not change a photo, upload a file, publish
anything, or contact a client.

## Control CLI without Computer Use

The installed Backstage executable also exposes a structured, read-only control
surface. It runs inside the Backstage bundle identity, so its Photos/TCC result
is about Backstage itself rather than a third helper process:

```sh
scripts/backstage-control.zsh health --pretty
scripts/backstage-control.zsh release verify --pretty
scripts/backstage-control.zsh photos authorize --pretty
scripts/backstage-control.zsh real-estate originals preflight \
  --gallery corine-real-estate \
  --items-file /path/to/items.json \
  --pretty
```

The response includes Backstage release metadata, Backstage Photos access,
Owner session state, connector identity, and an actionable message. Exit code
`0` means local readiness; `2`
means a readiness gate needs attention; `64` means invalid arguments.
`release verify` checks the Backstage/helper release path without requiring
first-run Photos/TCC access. `health`, `doctor`, and `photos health` include
that access gate. These commands do not open the UI, use accessibility
automation, or mutate cloud/photo state, so they can be invoked over a
supported SSH/mesh channel
during remote acceptance. `photos authorize` is the explicit exception: it asks
PhotoKit to show the standard macOS permission request and reports the result;
it does not click or automate that prompt. Cloud/photo mutations remain behind
the existing Owner action and explicit authorization gates.

The release audit also inventories exact hidden
`.PhotosByElie Backstage.install-<UUID>.app` paths beside the canonical app.
Recent verified stages are retained as potentially active; wrong-identity or
invalid-signature lookalikes are retained as unsafe; only old, identity- and
signature-verified installer stages are eligible for bounded reconciliation.

## Updates

Open **Updates** to see the exact installed bundle identifier, version, and
build. Opening the workspace automatically reads the configured authoritative
HTTPS release manifest when no update operation is already active; there is no
separate manual check control. When a newer compatible release is available,
Backstage shows its version/build, minimum macOS version, release notes, and
archive size.

Production signed builds use
`https://download.photos-by-elie.com/backstage/releases/latest.json`. Release
owners publish only from the reviewed commit recorded in the app and from the
canonical `refs/heads/release/backstage` source line. The manifest builder
proves that exact commit is reachable from that branch on `origin`, then writes
both the commit and canonical ref into the release manifest. An unpushed,
worktree-only, or unrelated-branch commit fails closed before publication.

Promoting source is a separate reviewed Git action. In a clean isolated
worktree, fetch `refs/heads/release/backstage`, inspect its divergence from the
reviewed commit, and update it with an ordinary non-force push only when the
existing remote tip is an ancestor of the reviewed commit. Verify the exact
remote tip with `git ls-remote origin refs/heads/release/backstage`, then build
and sign from the reviewed commit. Never force-push or rewrite the canonical
release branch to reconcile divergence. The public PBE web release remains a
separate release boundary and is not changed by this Backstage process.

After that explicit source promotion and signed build, publish with:

```zsh
scripts/publish_backstage_release.zsh \
  --app 'native/PhotosByElieBackstage/dist/PhotosByElie Backstage.app' \
  --release-notes 'Short operator-facing summary'
```

For this single-operator app, source-ready Backstage changes normally continue
through this compile, sign, source-promotion, and publication path in the same
work cycle. Pause only for a concrete failing check or unavailable release
dependency. Installation and live UI acceptance are still separate evidence
and must be reported truthfully.

Use `--dry-run` to perform the complete local archive and manifest validation
without changing Cloudflare. The dry run still checks canonical remote source
reachability. Publication keeps versioned archives immutable, verifies the
uploaded bytes, preserves the previous manifest—including its source commit
and ref—for rollback, and updates `latest.json` only as the final write.

When the automatic manifest check finds a newer compatible release, Backstage
immediately downloads it into a unique directory below the app cache and checks
the declared byte count, SHA-256, stable bundle identity, version/build, team,
signing authority, and designated requirement without changing the installed
app. Concurrent checks cannot start a duplicate download. Choosing **Install
and run new version** immediately enters the separate guarded installer; there
is no Finder review step, second confirmation dialog, or follow-up launch
button. The installer repeats release and signing checks, stages the complete
app, preserves the incumbent signed app for rollback, atomically replaces only
the canonical app bundle, launches that replacement, and closes the older copy
only after macOS confirms the new process started. If launch fails, the old copy
stays open and reports the canonical recovery path. Neither path changes
Photos permission, connector enrollment, Keychain credentials, Owner SQLite,
fixtures, catalog, or publication state. If the endpoint is not configured,
the release is a downgrade/incompatible, or verification fails, the workspace
explains the blocker and recovery guidance.

### No-send client-originals preflight API

PBB-74 also defines a versioned cloud preflight for the private Real Estate
download path:

`POST https://auth.photos-by-elie.com/api/v1/real-estate/originals/preflight`

Call it with either an existing signed `pbe_re_session` client cookie or a
short-lived Backstage Owner Bearer session and a JSON body containing
`galleryKey` plus the selected `photoId`, `albumSlug`, and optional source/title
fields. The CLI renews that Owner session from the installed app's device
credential, so no browser session or Computer Use is required. The response is
machine-readable schema version 1 and reports each selected original as
available or missing. It deliberately returns no private object key.

This endpoint is read-only: it creates no download token, order, email, client
message, gallery change, or asset mutation. A successful preflight proves that
an authenticated client selection is ready for the separate, explicit
download-session action. Owner Bearer access applies only to preflight and does
not authorize that mutating download-session action.

Backstage restores its working layout between launches: the main and Quick
Look window frames, the last selected workspace, the navigation sidebar's
visibility and width, the Fixtures and People & Access dividers, and the
independent Gallery and Review inspector visibility and width. Quick Look does
not reopen stale media automatically; its saved frame is used the next time a
preview is opened.

## First-time enrollment

Enrollment is normally needed only once per Mac.

1. Open Backstage **Overview** and choose **Set up this Mac**.
2. Complete the Owner account-picker and confirmation in the browser.
3. Return to Backstage. It polls the five-minute handoff, stores the revocable
   device credential in this Mac's Keychain, and renews a short-lived session.

The browser URL carries only the handoff id. The independent claim secret and
Mac binding remain in Backstage memory, and no credential passes through the
URL or clipboard. A handoff is single-use and rejects expiry, cancellation,
binding mismatch, replay, and unauthorized identities. **Use one-time code
fallback** remains available until native setup, revocation, and clean-state
recovery receive installed/live acceptance. Enrollment does not grant Photos
access or change Owner.sqlite, fixtures, media, or publication state.

## A useful mental model

Backstage separates work into distinct stages:

1. **Fixtures** define where media belongs.
2. **People & Access** defines who belongs to which access groups.
3. **Gallery** is the canonical fixture asset browser; its **Culling —
   Undecided** saved view is the decision queue.
4. **Metadata** prepares titles, captions, keywords, and verified Photos
   give-back.
5. **Waste Basket** handles recoverable removals and explicitly confirmed
   global tombstones.
6. **Uploads** sends approved fixture media to R2, verifies it, and makes each
   verified source live in its effective picked fixtures.
7. **Delivery** records ready PDF, video, or Originals links.
8. **Publication** registers eligible public media in the static catalog.
9. **Activity** shows the durable action history.

These stages are deliberately separate. Uploading approved media makes it live
in its effective fixture, but does not by itself register it in the static
catalog or deploy the website. Recording a delivery link does not message a
client. Catalog registration does not deploy the website.

## Overview

Use **Overview** to check this Mac's authentication.

- **Authenticated** means the app has a working session. Once connected,
  Backstage removes the redundant green toolbar indicator. In Gallery and
  Review, that top-right space becomes the collapse/expand control for the
  preview or editorial panel.
- **Refresh session** reloads the session from the credential stored in
  Keychain.
- Backstage renews its short-lived access token automatically. If a workspace
  request and startup authentication happen together, the request waits for
  the same authentication result instead of showing a stale Google-login
  error.
- **Sign out** revokes the local session and removes the Backstage credentials
  from Keychain.

Do not sign out merely to close the app. Backstage restores its session from
Keychain on the next launch.

### One-time Keychain authorization after the signing repair

Backstage release builds are signed with a stable Apple code-signing identity.
That identity lets macOS recognize later builds as updates of the same app
instead of treating each rebuild as a new application.

The existing `com.photosbyelie.backstage` credential is preserved. The first
launch of the newly signed build may show one macOS dialog asking whether
**PhotosByElie Backstage** may access that Keychain item. If it does:

1. Confirm that the dialog names **PhotosByElie Backstage** and the
   `com.photosbyelie.backstage` item.
2. Enter the login-keychain password directly into the macOS dialog. Never
   paste or send that password to Codex, a script, a terminal command, or
   another person.
3. Choose **Always Allow** once.
4. Quit and reopen Backstage, then choose **Refresh session**. Later launches
   and session refreshes should not ask again while builds keep the same
   signing identity.

Do not delete or recreate the Keychain item to suppress the prompt. If the
dialog returns after the one-time authorization, stop and inspect the
installed app's designated requirement before changing the credential.

## Fixtures

Fixtures are folders with stable identities. They may contain child fixtures,
and the same asset can be placed in more than one fixture without copying the
source file.

### Create a fixture

1. Choose **Fixtures** and then **Reload tree**.
2. To create a root fixture, leave the fixture list unselected.
3. To create a child, select its intended parent.
4. Enter the name in **New fixture or new name**.
5. Leave **Template** unchanged unless the fixture needs a known special
   template.
6. Choose **Create root** or **Create child**.

Use **Rename** to change the visible name without changing the fixture's stable
identity. **Archive / reopen** is reversible.

### Set the fixture contract

Select the fixture and use its policy editor to describe what the fixture is
allowed to do.

- **Population** controls how membership is built: manually curated, produced
  by a saved rule, or constrained to a parent fixture's assets.
- **Visibility** and **Searchable** are separate. A private fixture must not
  become public merely because it has catalog metadata.
- **Retention** controls whether media may exist as public previews, private
  masters, archive-only objects, or not in cloud storage at all.
- **Delivery** and **Download** control who may receive or download the
  fixture's products.
- **Commerce** distinguishes retail sale, paid client service, free sharing,
  and disabled commerce.

Choose the closest template first, then change only the fields that differ.
Child fixtures inherit the effective policy unless they explicitly override a
field. Saving creates a new audited policy revision; existing culling
snapshots retain the revision they were created with.

### Find and place assets

1. Select the destination fixture.
2. Search by title, keyword, filename, or camera.
3. Select one or more results.
4. In **Reversible fixture placements**, select the destination fixture or
   fixtures.
5. Choose **Place selected assets**.

Use **Review placements** to inspect the relationships. A placement can be
moved, removed, or restored without deleting the asset.

### Create a culling snapshot

After selecting search results, choose **Create stable culling snapshot**.
The snapshot freezes that candidate set for review. Choose **Open in Gallery**
to switch Backstage to the exact immutable pool in its saved order. It does
not open Safari or localhost, and it does not publish or upload the selected
files.

## People & Access

Use **People & Access** for identities, group membership, and inherited access
already represented by those groups.

### Add or update a person

1. Choose **New**, or select an existing person.
2. Enter the email address and display name.
3. Turn the appropriate group memberships on or off.
4. Choose **Save person & access**.

Email addresses and usernames are normalized. Passwords remain
case-sensitive and are never returned to Backstage. **Disable** preserves the
audit history rather than deleting the person.

### Add a group

1. Enter a unique **Stable group ID**.
2. Enter the visible **Label**.
3. Choose the group kind.
4. Choose **Save group**.

Archiving a group preserves its history. Use the existing fixture/access model
when a group must inherit access to a fixture; do not create duplicate grants
for every child fixture.

## Gallery

**Gallery** reads the Photos library and records review decisions through the
audited Owner action path. Choose **All fixture assets** to browse every active
decision state, or **Culling — Undecided** for the bounded culling queue.

1. Choose **Allow Photos** on the first run. **Refresh previews** updates the
   responsive cache of the 2,000 most recent Photos items. **Reconcile
   library** streams the complete Photos library through the signed helper,
   registers newly seen items in Owner, and marks no-longer-present items as
   unavailable only after the complete scan. Reconciliation preserves all
   existing culling decisions, approvals, and tombstones.
   Visible cards load a bounded thumbnail first and opportunistically upgrade
   after scrolling settles. A failed card stops its spinner and offers an
   individual retry; Quick Look remains an independent preview path.
2. When working from a saved fixture pool, confirm the pool name and immutable
   asset count above the list. Search and the Decision, Rating, and Color
   filters only narrow that pool; the total and matching counts remain visible.
   Backstage Gallery and Review source candidates are still photos only.
   Generated Real Estate videos are downstream Delivery outputs, not fixture
   or review candidates.
3. Backstage shows at most 200 matching rows at once. Use **Previous** and
   **Next** to move through a large pool without changing its membership or
   order.
4. Select one or more thumbnail rows. Command-click toggles individual items, Shift-click
   extends from the selection anchor, arrows move focus, Shift-arrows extend
   the range, and Command-A selects the entire current scope.
5. **Review picked** narrows the current scope to picked items. **Select
   burst** selects contiguous frames captured within two seconds of the
   focused item.
6. Use **Fixture decision** for Include, Exclude, or Undecided. P, H, and U are
   the matching fixture-local shortcuts; X remains the separate global
   recoverable Waste Basket action. Only a confirmed **Empty Waste Basket**
   operation activates a global tombstone.
7. Use the rating control for zero to five stars. The number keys 0 through 5
   apply the corresponding value; 0 clears the rating.
8. Use the direct color buttons to assign a label. Choosing a color already
   applied to every selected item clears it.
9. Choose **Quick Look** or press Space to inspect still photos and panoramas
   without leaving Backstage. The metadata panel never
   covers the item: it stacks below landscape previews and beside portrait
   previews while showing the current filename, title, keywords, capture time,
   rating, color, and state. While
   Quick Look is open, Left/Right moves to the previous/next visible item, P and
   H apply fixture Include/Exclude, 0 clears rating, 1–5 set rating, and 6–9
   toggle red/yellow/green/blue. Pressing the same color again clears it. The
   same 0–9 router applies in Gallery, Review,
   Metadata, Uploads, and Waste Basket, and the visible metadata refreshes as
   soon as a rating or color change succeeds. When P or H removes the current
   item from the active filters, Quick Look stays open on the next surviving
   item (or the preceding survivor at the end). Temporary preview files stay
   in the app cache and are replaced on the next preview. Long preparation and
   decision operations show progress and can stop after the current audited
   batch. The Gallery inspector shows the Owner title and keywords, capture
   date, original dimensions and megapixels, resource format, and filename.
   Original file size appears when a verified upload receipt already recorded
   it; otherwise Backstage says it is unavailable rather than downloading the
   original merely to calculate it.
10. Choose **Undo** or press Command-Z to reverse the latest decision batch.
   Backstage keeps up to 100 session steps and restores the earlier cloud
   decision state and selection.
11. Use the **Metadata**, **Review**, or **Uploads** workspace directly from the
    sidebar. Each owning workspace retains the shared selection when it is
    relevant; Gallery no longer duplicates those navigation actions in its
    footer.

Opening a pool or using **Refresh previews** rehydrates pick, rating, and color
state from the canonical cloud ledger. The pool order and scope remain
unchanged; there is no separate footer reload command.

The Gallery header **Workflows** menu can open Review or ask for a destination
folder to export verified original resources. These actions are separate from
fixture upload and catalog publication.

## Review

**Review** is the editorial workspace for photos already picked into a
fixture. **Backfill** starts with unresolved picked photos; **Full queue** also
loads approved and fixture-hidden photos. During either Review session, a card
you approve or hide remains in the current window until you leave or explicitly
reload Review. That retained card is the propagation anchor: approval adds the
green check, while Hide turns the thumbnail black and white. When **Proposal
Available** is active, completing the proposal does not remove that card if its
new **Approved** or **Hidden** state is also selected; the next explicit reload
reapplies the proposal filter.

When the current fixture and Review filters contain capture-time burst groups,
**Select burst** (or **B**) selects likely duplicate frames while leaving the
probable second-frame survivor unselected. This changes selection only; use
**Hide** to apply the existing audited Review action, and use **Undo** to
reverse that decision batch. The current fixture, ordered queue, focused item,
and Quick Look context remain intact.

1. Edit the title or keywords directly. Changes autosave after a short pause.
   The down arrow beside either field propagates only that field through the
   intended two-hour shoot window.
2. **Approve**, **Hide**, and **Propagate** remain independent actions.
   Approve commits the title and keywords visible for the focused photo in the
   same audited operation. Other selected or propagated photos use their own
   proposals; one photo's metadata is never copied implicitly to another.
   Approved thumbnails carry a 30-point green check. Fixture-hidden
   thumbnails are black and white. An AI-review mark carries a 30-point
   question mark.
   Quick Look shows the same basic metadata context; Left/Right moves to the
   previous/next visible item, P or A approves, H hides, X moves the item to
   the recoverable Waste Basket, U returns the current item to the Gallery's
   Culling saved view, 0
   clears rating, 1–5 set rating, and 6–9 toggle red/yellow/green/blue;
   pressing the same color again clears it.
3. **Propagate** repeats the most recent Approve, Hide, or AI-review mark
   through the same bounded shoot window. It does not run AI.
4. AI reasons and the optional note are only a local form until **Update AI
   review mark** is chosen. That audited action adds or updates the deferred
   AI queue entry. AI work runs later on schedule, or explicitly when **Run AI
   pass now** is chosen.

## Metadata

The upper Metadata sections manage direct Owner metadata, the keyword
blacklist, and the AI model ladder. Backstage Review is Backstage's sole
title/keyword proposal-review surface. The final Metadata section writes approved metadata back to
Apple Photos through Backstage's native PhotoKit services.

Backstage is the only normal-release Photos authority; there is no second
operator application or helper to install. On **Overview**, the **Signed Photos
helper** card reports the bundled helper compatibility and authorization state.
Use **Check helper** after an upgrade or permissions change. Backstage blocks
culling and metadata give-back while its own signed helper is stale, missing,
or unauthorized.

### Edit metadata

1. Select an item in **Gallery**.
2. Open **Metadata** and choose **Use selected Photos item**.
3. Edit the title, caption, or comma-separated keywords.
4. Choose **Save title, caption & keywords**.

Backstage records the connector-returned private values that existed before
each direct metadata or blacklist change. Choose **Undo last change** (or press
Command-Z while Metadata is active) to restore that exact prior state through
another audited Max action. The last 100 changes in the current Backstage
session remain reversible; a failed undo keeps its history entry for retry.

Select the current asset's preview or press Space to open canonical Quick
Look. The shared shortcuts remain available there: 0 clears rating, 1–5 set
rating, and 6–9 toggle red/yellow/green/blue. Pressing the same color again
clears it. Successful changes immediately
refresh the visible Quick Look metadata.

The keyword blacklist is replaced as one managed set; review it carefully
before choosing **Replace blacklist**. Metadata loads the saved AI model ladder
directly from authoritative `Owner.sqlite` without requiring a localhost helper
or connector daemon. Use Backstage **Review** to compare title/keyword proposals, then
choose **Approve** or return the item through **Needs AI** with specific reasons.

### Give approved metadata back to Photos

1. Enter the exact fixture ID.
2. Choose **Preview changes**.
3. Review the Ready, Blocked, and Failed counts. Photos is unchanged during
   this preview.
4. Only after a satisfactory preview, choose **Commit & verify** and confirm.
5. If individual items fail, use **Retry failed only**.

Backstage preserves unrelated Photos keywords and re-reads every changed item
before recording a verified receipt.

### Backfill searchable camera equipment

Choose **Start backfill** in Metadata to read camera, lens, and focal-length
metadata from Apple Photos entirely on this Mac. Backstage advances through
durable 25-photo checkpoints at low priority and updates the six progress
counts after every checkpoint. Choose **Stop safely** at any time; **Resume
backfill** continues the remaining exact PhotoKit identities without replaying
completed photos. Unavailable and failed photos remain terminal until you
explicitly choose **Retry unavailable & failed**. Finish or stop other
publication, delivery, sync, metadata, fixture, Review, or R2 work before
starting this maintenance run.

The bounded incremental Photos scan reports its current stage, checked count,
and remaining count. **Stop safely** requests a stop after the current PhotoKit
checkpoint; completed classifications remain recorded and the remaining items
return on a later pass.

## Waste Basket

The Waste Basket has two intentionally different normal actions:

- **Put back** restores all selected recoverable items.
- **Empty Waste Basket** changes recoverable entries into active global
  tombstones only after explicit confirmation.

The table uses bounded Photos thumbnails: while a preview is loading it says
**Loading preview…**, and a failed preview offers **Retry preview** without
fetching the original just to populate the list. Select a column heading to
sort; equal values retain a deterministic ledger order. Command-click,
Shift-click, and keyboard selection work across refresh. **Delete Selected**
applies the guarded tombstone transition only to selected recoverable rows;
the larger count line distinguishes recoverable entries from active global
tombstones. Use **Refresh**, select the items to restore, and choose
**Put back**. **Empty Waste Basket** remains the explicit all-recoverable-items
path.

Select exactly one row and press Space, or choose **Quick Look**, to inspect it.
Within Quick Look, 0 clears rating, 1–5 set rating, and 6–9 toggle
red/yellow/green/blue through the same shared router used by the other photo
workspaces. These metadata changes do not restore or tombstone the item.

Emptying retains source media, R2 objects, and history. A tombstoned item can
return only through the separate explicit tombstone-restore path; ordinary X
and restore remain idempotent and auditable.

## Uploads

Uploads are fixture-scoped and require approved items. The main table shows
the current native upload plan, including a small Photos thumbnail, title,
file name, capture date, state, and any eligibility error.

1. Choose a fixture and refresh the queue.
2. Select any column heading to sort by that column; select it again to reverse
   the order.
3. Use Command-click to add or remove individual rows, or Shift-click to extend
   the current selection.
   Press **R** to open the guarded Return to Review action, **H** to open the
   guarded fixture-hide action, or **Space** to open a larger preview with the
   canonical title and keywords. In Quick Look, 0 clears rating, 1–5 set
   rating, and 6–9 toggle red/yellow/green/blue; pressing the same color again
   clears it, and the metadata pane refreshes after each successful change.
   Press Space again to close it.
4. Read the persistent queue-window line. It says how many of the eligible
   items are shown and how many remain outside the loaded window. The server
   loads at most 200 of the oldest eligible items by upload-readiness time;
   column sorting rearranges only those shown rows.
5. Choose **Publish selected…** for a hand-selected subset, or **Publish these
   N…** to accept the exact loaded window. The latter drains the visible
   snapshot through sequential runs of at most 50 assets, preserving the
   existing isolated-failure contract.
6. Watch the aggregate progress and per-item R2 and Photos states. **Stop
   safely** lets already-started uploads finish, keeps their verified receipts,
   and leaves every unstarted item in the queue for an independent retry.

If an approved item needs more editorial work, select one or more rows and
choose **Return to Review…**. After confirmation, Backstage reverses the
approval through the audited Review workflow while preserving fixture picks,
title, and keywords. Returned rows disappear from the Upload queue as soon as
the audited transition succeeds, even if the subsequent queue refresh is slow.
Live items cannot be returned this way. The action can be undone through the
existing Review audit trail.

The recovery area can adopt a previously verified Upload Bridge run by its
exact run ID. Always use **Preview adoption** before **Adopt verified run…**.
Adoption verifies existing R2 checksums and does not message a client or
publish media.

## Delivery

Use **Delivery** after a PDF, video, or Originals product has already been
completed.

1. Choose the fixture and **Load** its current deliverables.
2. Choose PDF, Video, or Originals.
3. Paste the authenticated share URL.
4. Choose **Record ready link**.

This records the ready product against the fixture. It does not send the link
to a client.

## Publication

Publication is the final catalog-registration gate for fixtures that are
explicitly public.

1. Choose the fixture.
2. Choose **Preview gate**.
3. Review the Eligible and Blocked lists.
4. If the plan is correct, choose **Register eligible…** and confirm.

Registration changes catalog source files. It does not deploy or push the
website and it does not message anyone. Keep private and Real Estate fixtures
out of this gate.

The separate **R2 safety** workspace reports the current object checkpoint and
remaining count for both preview and commit runs. **Stop safely** finishes the
current object atomically, preserves its quarantine/protection/deletion
receipt, and leaves the remaining objects for a fresh reconciliation run.

## Activity and troubleshooting

Use **Activity** first when an operation appears slow or stuck. Backstage
actions are durable: if the local connector does not wake immediately, it can
claim the same action through its polling fallback.

### Enrollment required

Choose **Set up this Mac** in Overview. If browser authorization is cancelled
or expires, start a new handoff; an earlier handoff cannot be reused. Use the
restricted one-time-code fallback only while the native route is unavailable.

### Photos access is required

Choose **Allow Photos**. If macOS no longer prompts, open **System Settings →
Privacy & Security → Photos** and grant Full Access to **PhotosByElie
Backstage**, then return to the app and choose **Refresh**. The Overview helper
card must report **Compatible** and
**authorized** before culling or metadata give-back.

### Photos indexed, but an item is absent

Choose **Reconcile library** and wait for the signed helper to finish the
complete library scan. The ordinary **Refresh previews** action only refreshes
the 2,000 most recent preview candidates and is not the catalog boundary.
Backstage does not silently export an original merely to display the list or
calculate its disk size.

### An action stays queued

1. Check **Activity**.
2. Refresh the session from **Overview**.
3. In the browser Owner page, check Max connector health.
4. Leave the action in place rather than submitting duplicates; the durable
   poller can still complete it.

### Something looks unsafe or ambiguous

Stop before confirming. Preview or reload the relevant plan, verify the
fixture and item counts, and inspect **Activity**. The browser Owner remains
available for authentication, enrollment, connector health, access review,
and audit, but Backstage is the active mutation workspace.

Browser Owner and the retired Sidecar pages do not launch PhotoKit work.
Ordinary operation exposes only Backstage as the operator app; legacy browser
import routes fail closed with `410 Backstage required`.

## Safety summary

- `Owner.sqlite` remains the private Owner source of truth.
- Normal Backstage mutations pass through the Worker audit ledger and the Max
  connector; the app does not directly edit business rows.
- Photos writes use Backstage's signed native PhotoKit services and are verified
  by re-reading.
- Upload, delivery, publication, deployment, and client messaging are separate
  decisions.
- Public buyer pages and private client pages remain independent of Backstage.

For implementation details and rollback boundaries, see
[Backstage native architecture](architecture/backstage-native.md).
