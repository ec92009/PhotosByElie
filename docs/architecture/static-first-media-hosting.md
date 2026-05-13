# Static-First Media Hosting Notes

Date: 2026-05-06

This note captures the "thinking out loud" discussion about whether PhotosByElie can stay mostly static while the photo library grows beyond what is comfortable for GitHub Pages.

## Current Pressure

The current project shape bends around GitHub limits because GitHub Pages is doing two jobs:

- Hosting the static site code.
- Hosting some public photo assets.

The first job is a good fit. The second job is the source of the acrobatics.

GitHub Pages should remain the home for the static storefront: HTML, CSS, JavaScript, catalog JSON, and public gallery pages. Photo binaries do not need to live in GitHub long term.

## Future Media States

Each source photo may eventually have several useful derivatives:

- Developed full-resolution image.
- 6MP delivery image.
- 3MP delivery image.
- 1MP delivery image.
- Preview image.
- Watermarked 1800px image.
- Watermarked 900px image.

Each photo also has a curation state:

- Expo.
- Reserve.
- Blocked.
- Discarded.

Those states should be metadata and/or storage location concerns. They should not force GitHub to carry the full media vault.

## Static-First Architecture

The durable direction is static-first, not necessarily static-only:

- GitHub Pages hosts the public storefront and catalog files.
- A public media CDN or object store hosts public display derivatives.
- Private/local storage keeps protected sales assets.
- A tiny trusted service may eventually handle payment callbacks, delivery ZIPs, signed links, and print-on-demand order submission.

The site can remain static in spirit: no always-on application server, no heavy database, and no dynamic page rendering. The dynamic parts should be limited to actions that need secrets, money handling, or private file access.

## Public Media

Public media should mean public display media, not all sellable files.

Good public candidates:

- Watermarked preview.
- Watermarked 900px display image.
- Watermarked 1800px display image.

Questionable or likely private candidates:

- Clean 1MP JPG.
- Clean 3MP JPG.
- Clean 6MP JPG.
- Clean developed full-resolution JPG/TIFF.

The reason to put any photo file on a public CDN is browser performance and simplicity: the public gallery needs images it can load without authentication. But if a file is something a buyer should pay for, it should not be publicly addressable just because it is small.

Decision: public object storage/CDN should contain watermarked images only.

## Originals And RAW Files

Original RAW files should stay outside the web hosting plan.

Owner preference:

- Originals remain on local computers and backup drives.
- RAW files are not offered as standard products.
- If someone wants RAW files, they must contact Elie directly.

The site can still keep metadata about whether a public image came from a RAW source. That can help owner-side curation and duplicate detection, but RAW source status is not a buyer-facing product promise.

## Private Storage Scope

Private object storage is for developed sales assets and delivery artifacts, not RAW originals.

Expected private storage contents:

- Developed full-size masters.
- Lazily generated clean delivery sizes, such as 6MP, 3MP, and 1MP.
- Delivery ZIP files stored under the purchase order ID.

Smaller clean delivery derivatives are generated/uploaded by the media pipeline and then reused. After masters, private render triplets, and public previews are uploaded, normal Owner metadata edits should not rewrite those media objects; blocked/discarded cleanup is the exception.

Blocked and discarded media should use a short undo window rather than permanent preview retention. Once a photo is blocked or discarded, it should leave the public catalog immediately. Public preview derivatives may stay briefly so Owner undo/review remains humane; the current default target is 24 hours. After that window, public/private preview derivatives can be purged from R2. The durable record is the blocked/discarded photo id plus the blacklisted master/source path needed to keep future imports from resurrecting the same file.

Delivery ZIP files should remain available for future re-download under their purchase order ID. Access should be rate-limited, with a rough starting rule of no more than one delivery ZIP download per order per hour. The exact rule can change later, but the intent is to avoid accidental or hostile repeated downloads.

RAW originals remain outside this storage plan.

## RAW To Developed Workflow

The RAW-to-developed-master process stays on the owner's computer. It is typically a one-time creative/export step, not a web workflow.

After that export, the developed master can enter the sales/storage pipeline. RAW files are not offered as a standard product and are not required by the web fulfillment system.

## Practical Answer

Long term, the clean split is:

```text
GitHub Pages
  static site shell
  gallery pages
  JavaScript
  CSS
  public catalogs and metadata

Public media CDN/object storage
  watermarked previews
  watermarked 900px images
  watermarked 1800px images

Private object storage
  developed full-size masters
  lazily generated clean 6MP/3MP/1MP derivatives
  delivery ZIPs keyed by purchase order ID

Local computers and backup drives
  original RAW files
  RAW-to-developed working archive

Optional private service
  payment webhook handling
  signed temporary download links
  print-on-demand handoff files
```

This avoids using GitHub as a media vault while preserving the simplicity of a mostly static public website.

## Checkout Track

The buyer-facing basket can stay static, but paid delivery needs a trusted Worker track:

```text
Browser basket
  sends selected photo IDs, products, checkout mode, and buyer email

Worker
  validates the basket against the catalog
  creates the order ID and USD amount
  creates a Stripe Checkout Session
  stores the basket snapshot and expected amount

Stripe
  handles card/payment UI and sends a signed paid webhook

Worker
  verifies the webhook, order ID, amount, and currency
  creates or queues the delivery ZIP
  stores the ZIP under the order ID in private R2
  issues a signed download link or order-portal link
```

The browser is never the source of truth for fulfillment. Stripe confirms payment; the Worker decides what the payment unlocks. V1 uses USD only, guest checkout first, and optional account checkout later.

The first code version lives in `worker/` and uses mock Stripe plus in-memory storage so the order state machine can be tested before real Cloudflare/Stripe credentials are introduced.

## References

- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Stripe Payment Links: https://docs.stripe.com/no-code/payment-links
- Google Cloud Storage static hosting: https://cloud.google.com/storage/docs/hosting-static-website
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
