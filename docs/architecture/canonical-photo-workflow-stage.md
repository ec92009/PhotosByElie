# Canonical photo workflow stage

Backstage projects one owner-facing workflow stage for each photo in each
fixture. The projection is derived from the durable Owner SQLite columns; it
does not replace those columns or expose private Owner state on the public
site.

## Main path

| Stage | Entry trigger | Exit trigger |
| --- | --- | --- |
| New in Apple Photos | Apple Photos creates or imports the asset. | Backstage discovery indexes its stable Photos identity. |
| Discovered | Discovery records the source asset, but no active fixture placement exists yet. | A fixture snapshot or discovery reconciliation creates an active placement. |
| Undecided | The active fixture placement is created or a user clears its fixture decision. | Pick, Hide, Waste Basket, or global tombstone. |
| Awaiting Review | The user picks the asset for the fixture. | Request AI, approve directly, hide, unpick, or Waste Basket. |
| AI Requested | The user submits the asset with at least one AI-review reason. | A valid proposal becomes ready, the request is cancelled or superseded, or the asset leaves Review. |
| Proposal Ready | A proposal for the current source version is available. | Approve, edit or supersede the proposal, request AI again, or leave Review. |
| Approved | The user approves the current title, keywords, country, and source version. | Upload starts, approval is reversed, or the asset is hidden or removed. |
| Needs Upload | An approved source version has no verified full-resolution upload receipt, or its previous upload failed. | Upload starts or approval is reversed. |
| Uploading | The full-resolution upload run owns the asset. | Checksum verification succeeds or the run fails or is cancelled. |
| Full-resolution Uploaded | The uploaded object has a verified checksum, but no catalog publication is in progress. | Catalog projection or publication begins. |
| Publishing | Catalog projection, deployment, or website-visibility verification is pending. | The public site verifies the asset as live, or publication remains retryable after a failure. |
| Live | The deployed public catalog and media receipt verify the asset is visible. | A later publication replaces or removes it, or a sale receipt advances it to Sold. |
| Sold | A completed order receipt references the live asset and purchased rendition. | Terminal commercial stage; later fulfillment events are receipts, not a different photo stage. |

## Side stages

These stages override the main path for the affected scope:

| Stage | Trigger | Restore trigger |
| --- | --- | --- |
| Hidden | Hide in one fixture. The asset keeps its editorial and delivery history, but no other stage is displayed or counted for that fixture. | Clear the fixture decision or pick it again. |
| Waste Basket | Move to the recoverable Owner Waste Basket. | Put Back restores the recorded prior fixture state. |
| Globally Tombstoned | Confirm permanent global removal through the lifecycle gateway. | No ordinary UI restore; use an audited recovery path if one exists. |

Precedence is: globally tombstoned, Waste Basket, hidden in fixture, fixture
placement, editorial stage, then delivery, publication, and sale stage. This
means combinations such as `Hidden + Awaiting Review` or `Hidden + Live` may
still exist in historical columns, but Backstage displays, filters, and counts
only `Hidden` in that fixture.

## Health is not stage

Upload failure, publication failure, source unavailability, missing metadata,
and cancellation are health or retry signals. They accompany one canonical
stage and must not appear as a second workflow stage.

## Public boundary

The public catalog receives only verified public metadata and live media. It
does not receive fixture-local Hidden, Review, AI, approval, Waste Basket, or
tombstone internals. Full-resolution upload and sale receipts remain private
Owner evidence even when their canonical stage is shown in Backstage.
