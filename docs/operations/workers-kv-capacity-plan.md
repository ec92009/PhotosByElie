# Workers KV capacity plan (PBE-97)

Status: Workers Paid was owner-approved and activated on 2026-07-10. This plan does not change billing.

Deployment: Worker version `aa789772-3df5-442f-82c9-1fa370e9392d` on 2026-08-06.

## Decision

Keep the Workers Paid plan. The production Worker uses one `ORDERS_KV` namespace for commerce records, aggregate analytics, and the remaining Owner connector/action coordination state. Access roles and sidecar state already live in D1, and raw analytics-event persistence remains disabled with `ANALYTICS_PERSIST_EVENTS=false`.

The free plan is not suitable for this workload: it allows 1,000 KV writes per day. Workers Paid has a $5 monthly minimum and includes 1,000,000 KV writes and 1 GB of stored data per month before usage charges.

Official references:

- [Workers KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [Workers Paid pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers KV metrics and analytics](https://developers.cloudflare.com/kv/observability/metrics-analytics/)

## Baseline captured on 2026-08-06

The read-only audit in `docs/rehearsals/pbe-97-kv-capacity.json` covers 2026-07-07 through 2026-08-06. Cloudflare documents these GraphQL analytics values as adaptive estimates.

| Measure | Baseline |
| --- | ---: |
| 31-day writes | 1,038,330 |
| Peak write day | 62,320 on 2026-07-29 |
| Most recent 7-day writes | 165,750 |
| Recent 30-day projection | 710,357, or 71% of the Paid included allowance |
| Latest storage | 245,847,762 bytes, or 24.58% of the included 1 GB |

The current API token can read Cloudflare analytics but does not have Billing Read permission. Paid-plan activation is therefore recorded from the owner's approved 2026-07-10 operational decision rather than independently changed or re-authorized by this work.

## Recurring write sources and reductions

Before this change, every connector poll wrote both a connector heartbeat and the connector index, even when nothing had changed. Two idle connectors polling once per minute could therefore generate about 5,760 writes per day. The Owner page also refreshed an interactive lease every 10 seconds, which could generate another 8,640 writes per day if left open continuously.

PBE-97 changes the behavior without slowing action delivery:

- Unchanged connector heartbeats persist at most once every five minutes. A connector capability, version, host, platform, or state change persists immediately.
- The connector index is rewritten only when its membership or order changes.
- Owner interactive leases carry a five-minute active window and are rewritten only when the persisted window has two minutes or less remaining. The Owner page can continue checking every 10 seconds, and connectors can continue checking for real actions every five seconds while the lease is active.
- Real Owner actions, checkout records, orders, and downloads are not coalesced.
- Raw analytics events remain disabled; only aggregate counters are retained.

For two continuously idle connectors, heartbeat writes fall from about 5,760 to about 576 per day, a 90% reduction. A continuously open Owner page falls from about 8,640 lease writes to about 480 per day, a 94.4% reduction. The normal recurring ceiling for those two sources is therefore about 1,056 writes per day, with ordinary use materially lower.

## Verification and monitoring

Run the read-only audit with a Cloudflare token that can query account analytics:

```sh
npm run cloudflare:capacity -- --output docs/rehearsals/pbe-97-kv-capacity.json
```

After deployment, rerun the audit after a complete UTC day and again after seven days. Compare daily writes with the pre-deployment baseline while confirming Owner action latency remains unchanged. Reconsider the design if the recent projection approaches the Paid included allowance or storage approaches 80% of the included 1 GB.
