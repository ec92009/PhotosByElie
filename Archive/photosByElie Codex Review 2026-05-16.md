# photosByElie Codex Review 2026-05-16

Review timestamp: 2026-05-16 02:03 CEST.

1/ General architecture:
- The project has matured into a static public gallery plus localhost-only owner tooling, TSV catalog shards, R2 media delivery, and checkout/fulfillment prototypes.
- The most important architecture boundary is still public immutable media versus local owner state; keep that boundary explicit and enforced by scripts.

2/ UI:
- Public browsing, detail pages, liked/basket flows, and campaign pages have a rich feature set.
- Owner tools now need the same information design discipline as the public site: fewer overloaded controls, clearer state labels, and prominent "what will change" summaries for destructive actions.

3/ UX:
- The basket coverage pruning fix is the right direction for buyer safety.
- Checkout-sensitive flows should keep explaining exactly why a product is unavailable without leaking internal R2 jargon to buyers.

4/ Testing:
- Existing Node tests and validation scripts are useful.
- Add regression tests around discarded/Waste Basket tombstones, private-delivery availability pruning, owner metadata actions, and campaign embedded-browser escape behavior.

5/ Everything else:
- There is active unrelated local owner/generated state; do not casually stage or revert it.
- R2 sweep locking is important because automation and manual owner work can overlap.

6/ My suggetions:
1. Add tests that prove discarded/Waste Basket photos cannot remain sellable in basket or checkout flows.
2. Add a validation mode that reports public catalog/media/owner-state mismatches in buyer-friendly terms.
3. Simplify Owner dashboard actions into explicit safe, repair, and destructive groups.
4. Add a small state-boundary document covering public catalog, local owner state, private media, and immutable uploaded assets.
5. Keep R2 sweep lock checks mandatory for all automated and manual cloud-media repair paths.
