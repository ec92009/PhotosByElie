# Backstage Photos helper jobs

PBB-170 changes the local helper boundary in Backstage v249.1 build 315.
The loopback descriptor is transport information, not permission to use Photos.
A script launched independently cannot enumerate the library, fetch previews,
export originals, resolve identities or change Photos metadata through that IPC.

## Supported jobs

Start index refresh, bounded Photos sync, metadata give-back, requested AI and
fixture delivery/publication from Backstage. The accepted Owner action determines
which operations, Photos identities, index date range and exact metadata values
its bundled helper may use. Existing metadata chunks retain their 64-item and
16 KiB request bounds, order and per-item receipts. Tombstone give-back captures
current metadata and preserves the title, caption and unrelated keywords.

Backstage verifies its signed bundled runtime, resolves the job scope, and sends
a random job key only over the launched child's anonymous stdin pipe. Each
request signs its full byte representation, including its unique request ID.
The server checks scope, replay, expiry and the current local Owner session
before calling the Photos service. Jobs expire with the Owner access token or
after 15 minutes, whichever comes first, and are revoked when their connector
exits. Signing out or revoking this Mac locally revokes all active job keys.
Remote session revocation is observed on the next Owner session refresh; a cached
access session can remain valid until its existing expiry.

Helpers run with isolated system Python from the signed runtime. A synchronous
sealed child receives authority over another private pipe. The descriptor,
command arguments, environment and logs contain no job key. This boundary does
not claim protection against privileged process-memory inspection or compromise
of Backstage itself. The accepted Owner action and local Owner.sqlite remain
trusted workflow inputs, as in the existing native architecture. This change
does not authenticate database contents against a process able to rewrite the
Owner database: such a process can alter the identities or metadata a future
legitimate job resolves. Protecting all native workflows from local database
tampering is a separate data-integrity boundary.

## Requested AI and scheduling

Backstage captures missing requested-AI previews before starting the detached
proposal engine. The proposal engine receives only the selected asset IDs and
prepared files, never a Photos key. Newly queued assets wait for a later pass.
Only separate proposal/run records are written; approval remains explicit.

Review has **Nightly AI at 02:00 (Madrid)**. It is initially off: no installed
nightly schedule was found during migration, so an existing enabled state could
not be established. Enabling it runs one attempt per local calendar day while
Backstage is open and signed in, during 02:00–02:04 Europe/Madrid. Missed runs
wait until the next night or **Run AI pass now**; reopening the app does not
start a surprise catch-up. The setting and last attempted day persist in the
app's preferences. A repeated autumn DST hour cannot run a second attempt.

The old RAW-recovery CLI plan/sample/start/resume/index verbs are also retired:
invoking the signed executable is not a grant to read Photos. Batch status and
cancellation remain available for existing local receipts.

Retire external tasks that directly start the Photos preview/index/writeback
scripts. The historical identity-mapping migration script has no standalone
Photos grant. Read-only status commands remain available. Do not recreate a
long-lived helper token file or put a job key in an environment variable to
restore old standalone access.

## Verification

Synthetic socket and authority tests cover descriptor-only denial for all six
operations, an authorized preview, changed request bytes, wrong operation/asset,
metadata values, size bounds, concurrent replay, expiry, revocation, Owner
identity changes and index progression. Synthetic Python fixtures cover the
isolated stdin handoff, signed client framing, exact AI/delivery scope and the
credential-free detached proposal process. Schedule tests check opt-in behavior,
Madrid time, daily deduplication and the absence of late catch-up.

Installed verification must separately record the signed release identity,
launch, and descriptor-only denial. Real Photos writes, paid AI runs and
production publication are not substitutes for synthetic regression tests and
are not part of this security check.
