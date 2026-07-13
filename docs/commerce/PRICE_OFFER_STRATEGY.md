# PhotosByElie Price and Offer Strategy

Last updated: 2026-07-13

## Status

The camera-photo launch ladder was reconfirmed on 2026-07-13 after the proof-flow cents prices resurfaced in the canonical product file. The commercial storefront now uses whole-dollar camera pricing and excludes AI-generated images.

Current published prices are stored in `assets/catalog/product-pricing.json`, materialized into `assets/catalog/photosbyelie.sqlite`, exposed to the public basket by `photos-data.js`, and exported to the deployed Worker catalog through `worker/photos-catalog.generated.mjs`.

AI/Leonardo source files and Owner records are preserved as an archive. Public catalog generation, discovery, saved-basket normalization, and Worker checkout exclude the `ai` collection and AI-origin items.

## Launch Offer

Keep the first public offer digital-only:

- Single-photo JPG downloads at 1 MP, 3 MP, and 6 MP.
- Full-resolution original/developed file for premium personal use or owner-approved commercial use.
- Full-original video downloads only; no video resolution ladder for launch.
- Physical prints, framing, and shipping remain Owner-only until samples, fulfillment, support, and refund rules are settled.

Default license language should stay conservative:

- Personal print and personal web use are included for the buyer.
- Commercial use, resale, redistribution, stock licensing, merchandise, and AI-training use require written approval first.
- Stripe receipts are payment records; PhotosByElie order pages are delivery and recovery records.

## Launch Prices

These are the restored public launch prices.

| Product | Camera photo | Notes |
| --- | ---: | --- |
| JPG 1 MP | $8 | Small web/social download. |
| JPG 3 MP | $16 | Main casual buyer product for web, listing, and editorial use. |
| JPG 6 MP | $28 | Premium web and moderate print use. |
| Full resolution | $65 | Native-resolution source/developed file. |

Video:

| Product | Price | Notes |
| --- | ---: | --- |
| Original video under 10s | $12 | Short social or motion-detail clip. |
| Original video 10-30s | $20 | Standard short download tier. |
| Original video 30-60s | $28 | Premium short download tier. |
| Original video 1-3 min | $35 | Raise once video checkout gets real buyer interest. |
| Original video 3+ min | $50 | Treat long clips as a premium/manual-support item. |

The temporary cents-priced tiers were proof-of-flow fixtures and are not a commercial posture.

## Local POD Preview

The inactive/local-only POD model now uses these starter sizes:

| Product ID | Size | Proposed customer print | Proposed frame add-on | Supplier automation |
| --- | --- | ---: | ---: | --- |
| `print-12x16` | 12 x 16 in / 30 x 40 cm | $48 | $70 | Prodigi primary, Printful fallback, Gelato API proof |
| `print-16x20` | 16 x 20 in / 40 x 50 cm | $68 | $90 | Prodigi primary, Printful fallback, Gelato API proof |
| `print-18x24` | 18 x 24 in / 45 x 60 cm | $82 | $105 | Prodigi primary, Printful fallback, Gelato API proof |

Quality-tier routing is modeled separately from size/frame products so the later storefront can offer buyer-facing tiers without duplicating every product row:

| Tier | Supplier route | Use |
| --- | --- | --- |
| Value POD | Prodigi | Lowest landed cost and first automation path, including the frame-it-yourself option. |
| Standard POD | Printful | Finished framed print path when the buyer should receive an assembled framed product. |
| Gallery premium | theprintspace | Fine-art/photo paper and gallery framing candidate; sample and API setup required. |

Gelato stays in the catalog as an API-proof/global-routing supplier until product UIDs, live quote behavior, and account billing are verified.

`pod_settings.storefrontEnabled` is `false`; the browser only reveals print/frame choices when running on localhost and the Owner Commerce toggle is enabled. Supplier-cost rows live in `pod_suppliers`, `pod_quality_tiers`, and `pod_options` so the future Worker integration can quote/order by supplier SKU or variant id without opening public checkout yet.

## Bundles and Promotions

Do not add bundle logic before the first clean paid traffic pass. Add it only after single-photo checkout behavior is proven against real visitors.

Recommended order:

1. Single-photo launch prices.
2. Collection landing pages for the strongest social campaigns.
3. Manual promo-code hook or simple owner-managed discount link.
4. Three-file and five-file automatic bundle discount.
5. Buy-all-liked checkout once analytics show enough multi-photo baskets.

Suggested later discounts:

- 3+ digital files: 15% off digital subtotal.
- 5+ digital files: 20% off digital subtotal.
- Campaign launch code: 20% off for a short window.

## Refund and Support Policy Draft

Keep support language buyer-friendly but operationally safe:

- Duplicate charges and delivery failures should be fixed or refunded.
- If the wrong resolution was bought by mistake, support can review the order and offer an upgrade path instead of forcing a repurchase.
- Successfully delivered digital files are generally not refundable for preference changes, but support can still review cases individually.
- Expired download links can be refreshed for a verified paid order when appropriate.
- Support requests should include the order ID and checkout email.

## Implementation Checklist

When changing the launch ladder again:

1. Update `assets/catalog/product-pricing.json`.
2. Run `node scripts/write_catalog_tsv.cjs --commerce-only` to preserve media while refreshing commerce tables and retirement rules.
3. Regenerate the Worker catalog.
4. Verify the browser basket shows the intended prices.
5. Run `node --check photos.js basket.js order.js`, `npm test`, `npm run validate`, and `git diff --check`.
6. Bump the visible version because public pricing is user-facing.
7. Commit and push.
8. Deploy the Worker so hosted Stripe Checkout validates the same price list.
9. Run one live proof purchase when a suitable controlled order is available and confirm receipt, statement descriptor, webhook, order recovery, and download.

## Open Owner Decisions

- Monitor whether the restored `$8 / $16 / $28 / $65` camera ladder fits Etsy and direct-site buyer behavior.
- Decide whether full-resolution sales need an explicit commercial-use prompt before checkout.
- Approve or revise the local POD starter sizes, quality-tier names, supplier route per tier, and margin before samples are ordered.
- Confirm whether Prodigi's frame-it-yourself framed product is acceptable for customers or should be EU-only/testing-only.
- Decide whether the support email remains `ec92009@gmail.com` for launch or moves to a branded address later.
- Decide when social campaign pages are strong enough to send paid or public traffic.
