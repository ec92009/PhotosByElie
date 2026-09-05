# Worker release compatibility

PBE's canonical Worker source is `main`. Backstage's `release/backstage` may
consume reviewed shared changes, but a Backstage release must not become the
only durable source of a production Worker capability.

## Required commerce checks

`npm run worker:release-check` runs the existing mocked integration contracts
for checkout, paid fulfillment, refunds, Owner API routing, and browser
checkout origins/progress. The checked-in Wrangler `[build].command` runs this
gate before bundling and upload, including ordinary `wrangler deploy` and
`wrangler versions upload`. A failed test or missing required module/test file
aborts the command. Local `wrangler dev` also runs the gate.

The gate must retain these accepted contracts:

- Signed-in checkout uses the authentication host; guest checkout retains its
  configured host. The public basket has bounded progress, mutation interlocks,
  timeout and retry restoration.
- Paid-session recovery preserves payment identity, amount/currency validation,
  lifecycle fences, failed-to-ready recovery and issued download capabilities.
- Refund preview/mutation routes require enrolled Owner authority. Confirmation,
  full-refund eligibility, stable attempt idempotency, monotonic webhook state
  and fulfillment/download exclusion remain tested with mock providers.

Do not remove this gate, weaken its tests, or use `--no-build` for an ordinary
production release. It verifies the checked-out source; it is not an attestation
of live service state and cannot protect an old checkout predating this policy.
The existing source review and explicit deployment authorization still apply.

Wrangler custom-build behavior is documented in
[Cloudflare's custom builds reference](https://developers.cloudflare.com/workers/wrangler/custom-builds/).

## Reconciliation provenance

PBE-184 promotes the reviewed PBE-182/PBE-183 public Worker changes onto the
PBE-180 public baseline, preserving their separate source history:

- Public baseline: `e1de2b1e9343cd375f42bc1edc3897bd203bad32`.
- Fulfillment extraction: `49644606426f91bdff69109a7f807107df887b2f`.
- Public portions of the refund change:
  `2e9b9e479be72dfc9df948258f78f3b85fa7588b`.
- Accepted refund-enabled Backstage/Worker source:
  `671c87fdb7c8b956f69c26096d282d7be9c3e213`.

The public promotion does not import Backstage UI or its build identity into
PBE. Reviewed main changes flow back through the shared-contract synchronization
procedure on the canonical Backstage line. Report source integration, test
results, Worker deployment, installed app provenance and live acceptance
separately. This document authorizes no payment, refund, replay or deployment.
