# Static-First Media Hosting Notes

Date: 2026-05-06

This note captures the "thinking out loud" discussion about whether PhotosByElie can stay mostly static while the media library grows beyond what is comfortable for GitHub Pages.

## Current Pressure

The current project shape bends around GitHub limits because GitHub Pages used to do two jobs:

- Hosting the static site code.
- Hosting some public media assets.

The first job is a good fit. The second job is the source of the acrobatics and has moved to R2 for public previews and private delivery assets.

GitHub Pages should remain the home for the static storefront: HTML, CSS, JavaScript, catalog metadata, and public gallery pages. Media binaries do not need to live in GitHub. The current public catalog is SQLite-backed and loads the plain SQLite file directly. Discarded/tombstoned media must leave the public catalog as soon as it is banned; public metadata must never point at R2 objects that cleanup intentionally deleted.

## Future Media States

Each source media item may eventually have several useful derivatives:

- Developed full-resolution photo image.
- Full original/developed master.
- Watermarked 900px still preview.
- For video, a 5-second watermarked 720p preview clip.

Each media item also has a curation state:

- Expo.
- Reserve.
- Waste Basket.
- Discarded.

Those states should be metadata and/or storage location concerns. They should not force GitHub to carry the full media vault.

## Static-First Architecture

The durable direction is static-first, not necessarily static-only:

- GitHub Pages hosts the public storefront and catalog metadata, using plain `assets/catalog/photosbyelie.sqlite` as the active catalog artifact.
- A public media CDN or object store hosts public display derivatives.
- Private/local storage keeps protected sales assets.
- A tiny trusted service may eventually handle payment callbacks, delivery ZIPs, signed links, and print-on-demand order submission.

The site can remain static in spirit: no always-on application server, no heavy database, and no dynamic page rendering. The dynamic parts should be limited to actions that need secrets, money handling, or private file access.

## Public Media

Public media should mean public display media, not all sellable files.

Good public candidates:

- Watermarked 900px still preview.
- For video, a watermarked 900px poster plus short 720p preview clip.

Questionable or likely private candidates:

- Clean developed full-resolution JPG/TIFF.
- Original MOV/MP4/M4V video files.

The reason to put any media file on a public CDN is browser performance and simplicity: the public gallery needs previews it can load without authentication. But if a file is something a buyer should pay for, it should not be publicly addressable just because it is small.

Decision: public object storage/CDN should contain watermarked preview media only: still JPG previews and short video preview clips.

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
- Photo JPG delivery renders at 1 MP, 3 MP, and 6 MP.
- Delivery ZIP files stored under the purchase order ID.

The target model keeps four sellable photo delivery flavors: 1 MP JPG, 3 MP JPG, 6 MP JPG, and full original/developed asset. Photo previews remain the existing `still_900` gallery preview and `still_1800` detail preview. Videos are different: customer delivery is the full original/developed asset only, with a `still_900` gallery poster and a 5-second watermarked `short_5s_720p` detail preview. After masters, photo delivery renders, and public previews are uploaded, normal Owner metadata edits should not rewrite those media objects; Waste Basket/discarded cleanup is the exception.

Waste Basket media retention is owner-controlled, not clock-controlled. Once a photo is basketed, it leaves global eligibility immediately while remaining recoverable. The Owner SQLite gateway preserves immutable provenance so the owner can put it back exactly. Only an explicitly confirmed Empty Waste Basket operation activates a global tombstone; it retains source/R2 media and history, and the fail-closed catalog/publication/delivery policy prevents use until the separate explicit tombstone-restore path.

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
  public SQLite catalog and generated compatibility metadata

Public media CDN/object storage
  watermarked 900px still previews/posters
  watermarked 720p video preview clips

Private object storage
  developed full-size masters
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
