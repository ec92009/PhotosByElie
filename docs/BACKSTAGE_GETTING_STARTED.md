# Getting started with PhotosByElie Backstage

PhotosByElie Backstage is the private macOS workspace for organizing,
reviewing, uploading, delivering, and publishing Photos By Elie media.
The public website and client galleries remain separate.

Backstage is currently installed on Max at:

`/Users/ecohen/Applications/PhotosByElie Backstage.app`

The current native workflow is included in version **0.4.14 (build 25)**.

Open it from Finder, Spotlight, or the Applications folder in your Home
directory.

## The five-minute safe start

1. Open **PhotosByElie Backstage**.
2. In **Overview**, confirm that **Authentication** says **Authenticated** and
   that no orange connection warning appears in the toolbar.
3. Open **Culling** and choose **Allow Photos** if macOS asks for permission.
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

## First-time enrollment

Enrollment is normally needed only once per Mac.

1. In a browser, sign in as Owner at
   [photos-by-elie.com/owner.html](https://photos-by-elie.com/owner.html).
2. Find **Backstage enrollment**.
3. Choose **Create one-time code…**, confirm the prompt, and then choose
   **Copy code**.
4. Return to Backstage **Overview**.
5. Paste the code into **One-time enrollment code** and choose
   **Enroll this Mac**.
6. Clear the clipboard after Backstage reports that enrollment was stored in
   this Mac's Keychain.

The code is a one-time device credential. It does not grant Photos access and
does not change catalog data. If **Authentication** already says
**Authenticated**, do not create another code.

## A useful mental model

Backstage separates work into distinct stages:

1. **Fixtures** define where media belongs.
2. **People & Access** defines who belongs to which access groups.
3. **Culling** records picks, rejects, and ratings.
4. **Metadata** prepares titles, captions, keywords, and verified Photos
   give-back.
5. **Waste Basket** handles recoverable removals and permanent discards.
6. **Uploads** sends approved fixture media to R2 and verifies the result.
7. **Delivery** records ready PDF, video, or Originals links.
8. **Publication** registers eligible public media in the static catalog.
9. **Activity** shows the durable action history.

These stages are deliberately separate. Uploading does not publish. Recording
a delivery link does not message a client. Catalog registration does not
deploy the website.

## Overview

Use **Overview** to check this Mac's authentication.

- **Authenticated** means the app has a working session. Once connected,
  Backstage removes the redundant green toolbar indicator. In Culling and
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
The snapshot freezes that candidate set for review. Choose **Open in Culling**
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

## Culling

**Culling** reads the Photos library and records review decisions through the
audited Owner action path.

1. Choose **Allow Photos** on the first run. **Refresh previews** updates the
   responsive cache of the 2,000 most recent Photos items. **Reconcile
   library** streams the complete Photos library through the signed helper,
   registers newly seen items in Owner, and marks no-longer-present items as
   unavailable only after the complete scan. Reconciliation preserves all
   existing culling decisions, approvals, and tombstones.
2. When working from a saved fixture pool, confirm the pool name and immutable
   asset count above the list. Search and the Media, Decision, Rating, and
   Color filters only narrow that pool; the total and matching counts remain
   visible.
3. Backstage shows at most 200 matching rows at once. Use **Previous** and
   **Next** to move through a large pool without changing its membership or
   order.
4. Select one or more thumbnail rows. Command-click toggles individual items, Shift-click
   extends from the selection anchor, arrows move focus, Shift-arrows extend
   the range, and Command-A selects the entire current scope.
5. **Review picked** narrows the current scope to picked items. **Select
   burst** selects contiguous frames captured within two seconds of the
   focused item.
6. Use **Pick state** and **Apply pick state** for Pick, Reject, or Clear.
   P, X, and U are the matching keyboard shortcuts.
7. Use **Rating** and **Apply rating** for zero to five stars. The number keys
   0 through 5 apply the corresponding value.
8. Use **Color** and **Apply color** for the five labels or to clear a label.
9. Choose **Quick Look** or press Space to inspect photos, videos, and
   panoramas without leaving Backstage. Temporary preview files stay in the
   app cache and are replaced on the next preview. Long preparation and
   decision operations show progress and can stop after the current audited
   batch. The Culling inspector shows the Owner title and keywords, capture
   date, original dimensions and megapixels, resource format, and filename.
   Original file size appears when a verified upload receipt already recorded
   it; otherwise Backstage says it is unavailable rather than downloading the
   original merely to calculate it.
10. Choose **Undo** or press Command-Z to reverse the latest decision batch.
   Backstage keeps up to 100 session steps and restores the earlier cloud
   decision state and selection.
11. **Send to Metadata** and **Send to Uploads** retain the current selection
    while switching to that separate workspace. Neither button publishes or
    uploads by itself.

Opening a pool or choosing **Reload decisions** rehydrates pick, rating, and
color state from the canonical cloud ledger. The pool order and scope remain
unchanged.

**Export originals…** asks for a destination folder and exports verified
original resources. It is separate from fixture upload and catalog
publication.

## Review

**Review** is the editorial workspace for photos already picked into a
fixture. **Backfill** shows unresolved picked photos; **Full queue** also keeps
approved and fixture-hidden photos visible so their state can be inspected.

1. Edit the title or keywords directly. Changes autosave after a short pause.
   The down arrow beside either field propagates only that field through the
   intended two-hour shoot window.
2. **Approve**, **Hide**, and **Propagate** remain independent actions.
   Approved thumbnails carry a 30-point green check. Fixture-hidden
   thumbnails are black and white. An AI-review mark carries a 30-point
   question mark.
3. **Propagate** repeats the most recent Approve, Hide, or AI-review mark
   through the same bounded shoot window. It does not run AI.
4. AI reasons and the optional note are only a local form until **Update AI
   review mark** is chosen. That audited action adds or updates the deferred
   AI queue entry. AI work runs later on schedule, or explicitly when **Run AI
   pass now** is chosen.

## Metadata

The upper Metadata sections manage Owner metadata and review decisions. The
final section writes approved metadata back to Apple Photos through the signed
Photos Bridge.

Photos Bridge runs as a background-only helper. It should not appear in the
Dock or as a second operator application. On **Overview**, the **Signed Photos
helper** card reports whether it is installed, background-only, and authorized
for Photos. Use **Check helper** after an upgrade or permissions change.

### Edit metadata

1. Select an item in **Culling**.
2. Open **Metadata** and choose **Use selected Photos item**.
3. Edit the title, caption, or comma-separated keywords.
4. Choose **Save title, caption & keywords**.

Backstage records the connector-returned private values that existed before
each direct metadata or blacklist change. Choose **Undo last change** (or press
Command-Z while Metadata is active) to restore that exact prior state through
another audited Max action. The last 100 changes in the current Backstage
session remain reversible; a failed undo keeps its history entry for retry.

**Queue selected for review** sends the selected item or items to the existing
metadata review queue. The keyword blacklist is replaced as one managed set;
review it carefully before choosing **Replace blacklist**.

### Review AI proposals

Choose **Load proposals**, compare the current and proposed metadata, and then
choose **Approve**, **Reject**, or **Block** for each proposal. These decisions
are audited actions; they are not direct SQLite edits.

### Give approved metadata back to Photos

1. Enter the exact fixture ID.
2. Choose **Preview changes**.
3. Review the Ready, Blocked, and Failed counts. Photos is unchanged during
   this preview.
4. Only after a satisfactory preview, choose **Commit & verify** and confirm.
5. If individual items fail, use **Retry failed only**.

Backstage preserves unrelated Photos keywords and re-reads every changed item
before recording a verified receipt.

## Waste Basket

The Waste Basket has two intentionally different actions:

- **Put back** restores all selected recoverable items.
- **Discard** permanently discards one item after a separate confirmation.

Use **Refresh**, select the items to restore, and choose **Put back**.
Permanent discard is deliberately one item at a time and should be used only
when recovery is no longer wanted.

## Uploads

Uploads are fixture-scoped and require approved items.

1. Choose a fixture and **Load plan**.
2. Choose **Queue health** to inspect queued, uploadable, covered, and partial
   counts.
3. Select the intended table rows.
4. Choose **Upload selected**.
5. Watch the progress and per-item R2 and Photos states.
6. Use **Retry failed** for independently retryable failures.

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

## Activity and troubleshooting

Use **Activity** first when an operation appears slow or stuck. Backstage
actions are durable: if the local connector does not wake immediately, it can
claim the same action through its polling fallback.

### Enrollment required

Return to the browser Owner page and create a fresh one-time code. A code that
was already exchanged should not be reused.

### Photos access is required

Choose **Allow Photos**. If macOS no longer prompts, open **System Settings →
Privacy & Security → Photos** and grant PhotosByElie Backstage full access,
then return to the app and choose **Refresh**.

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

Browser Owner and fixture pages do not launch Sidecar. During the native
rehearsal window only, the compatibility UI can be enabled deliberately by
starting the connector with `PBE_ENABLE_LEGACY_SIDECAR=1`; ordinary operation
leaves this switch unset and exposes only Backstage as the operator app.

## Safety summary

- `Owner.sqlite` remains the private Owner source of truth.
- Normal Backstage mutations pass through the Worker audit ledger and the Max
  connector; the app does not directly edit business rows.
- Photos writes use the signed Photos Bridge and are verified by re-reading.
- Upload, delivery, publication, deployment, and client messaging are separate
  decisions.
- Public buyer pages and private client pages remain independent of Backstage.

For implementation details and rollback boundaries, see
[Backstage native architecture](architecture/backstage-native.md).
