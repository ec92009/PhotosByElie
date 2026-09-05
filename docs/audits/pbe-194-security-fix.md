# PBE-194: private deliverable object authorization

Status: source fix verified; production deployment not performed.

The authenticated deliverable save path accepted private object pointers and caller-selected media IDs. Asset reads and delivery-link creation trusted those pointers. The patch requires the server-generated object key and R2 metadata binding gallery, deliverable, type, and a digest of canonical media identities. Completion is the binding writer; local rehearsal uses that same path. Manifest saves cannot replace assembly descriptors or change the identity of existing records. Pending local output records remain pending until completion; selection records remain usable.

Delivery tokens carry an identity version and are revalidated against the actual output at redemption. Earlier tokens and outputs lacking the binding fail closed with a regeneration error. Before production rollout, account for this deliberate compatibility change: existing Real Estate outputs must be regenerated and links reissued. Do not backfill authority from untrusted stored manifests alone. No private data, live outputs, or customer links were modified during verification.

## Verification

- Syntax checks and `git diff --check`: pass.
- Both added object-authorization regression tests fail against the original module and pass against the patch.
- Covers arbitrary private keys, another gallery, another record, leading-slash aliases, legacy outputKey, exact custom prefixes, PDF/MP4/WebM/ZIP completion, rename, media substitution, missing binding, old tokens, and altered token identities.
- `npm test`: 32 pretest Node checks and 273 main Node tests pass; 483 Python tests run with 481 passing and two existing native source-contract failures.
- Both Python failures reproduce on unchanged main: `test_culling_preview_is_bounded_and_collapsible` and `test_window_and_preview_layout_persist_between_launches`. No native implementation or Python test is changed by this patch.
- `PHOTOSBYELIE_OWNER_DB=/Users/ecohen/MDev/PhotosByElie/assets/owner-actions/Owner.sqlite npm run validate`: pass using immutable read-only authority.
- Fresh independent read-only security review: no concrete bypass or blocking regression found.

Related follow-up: PBE-197 separately owns passive MIME/origin protection. This patch does not claim deployed protection or complete that ticket.

## Public-main integration

The initial patch was developed against local main `21318d49`. The isolated fix was then rebased onto public main `a014aa6a`, preserving its paid-fulfillment/refund modules and required Worker release gate. No unrelated native/catalog history was imported. On the public base, 330 Node checks and the final focused 93-test suite pass; publication validation and `wrangler deploy --dry-run` including the required commerce gate pass. Production upload remains unperformed.

Final public-base full suite: `npm test` passes all 330 Node checks and 484 Python tests. The earlier native contract failures belong only to the divergent local-main baseline and are absent on the public integration base.
