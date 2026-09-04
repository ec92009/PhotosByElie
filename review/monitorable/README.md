# PBE monitorable preview

Run `npm run preview:monitorable`, then open http://127.0.0.1:8099/.
The server serves the actual customer storefront, not a file directory or an iframe.

- `VERSION` identifies the candidate; published v245.2 remains separate.
- WST's shared v1.1.0 beacon sends synthetic, sessionless preview events to the local receiver.
- Expand **Preview signals** in the top preview bar to see server-received page views and CTA counts.
- Counts span navigation and reset on server restart. They do not enter the central WST dashboard.
- GPC and Do Not Track suppress events. No session IDs, form values, photo IDs, query strings or payment values are retained.
- Native production analytics is omitted from served preview HTML. The server is loopback-only, does not list directories, and rejects Owner/private routes.
- Existing customer checkout links retain their destination. This preview does not run or validate a purchase, and PBE-180 remains the discount-code investigation.
- The production sign-in service does not allow this local origin; review as a signed-out visitor. No authentication configuration is changed.

The onboarding manifest describes production capabilities as planned. Public deployment requires connecting the declared scope to central WST, with preview activity still excluded from production totals.

Validate the manifest from the WST checkout with `npm run check:onboarding -- /path/to/PhotosByElie/.wst/site.json`.

## Local verification · 2026-09-04

- Onboarding declaration passes. This does not claim public collection is active.
- Actual browser page-view and CTA receipts arrived; gallery-to-photo navigation counted `photo_open` and loaded the public photo.
- Injected GPC suppressed page views and clicks without interrupting navigation.
- The receiver rejected production events, unexpected personal-data fields and foreign origins; replaying one event counted it once.
- Policy routes and gallery modules returned 200; private/Owner paths returned 404.
- Homepage widths 320, 375, 390, 768 and 1280 had no horizontal overflow. Desktop and phone screenshots inspected; preview bar, header and version pill are clear of one another.
- Mobile gallery and photo navigation worked. Settings opened; public thumbnails loaded. The local-only caption sampler uses the public thumbnail endpoint.
- Field vitals, the full accessibility/performance matrix, signed-in journeys and checkout acceptance remain outside this local check.
