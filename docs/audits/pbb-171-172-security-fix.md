# PBB-171 / PBB-172 local HTTP security fix

The retained Python helpers reject legacy unauthenticated mutation routes before
body parsing. The Sidecar library GET is also denied because it requests native
indexing and writes indexed state. Existing capability-authenticated PBE protocol
handlers remain unchanged; normal Backstage direct/SQLite operations remain intact.

A shared pre-dispatch boundary rejects foreign, duplicate, missing and deceptive
Host authorities for all verbs. Static GET and HEAD use explicit public-file and
public-tree allowlists, canonical paths, and no directory listing. Owner.sqlite,
private JSON, dotfiles, and symlink aliases remain inaccessible. The public catalog
and customer dependencies remain available.

Validation: full baseline after change passed 328 Node tests, 509 Python tests
and 386 Swift tests. The original handlers failed the new security regressions.
Independent review identified browser-triggered Sidecar GET indexing and two
missing public assets; both were corrected. Final focused suite passed 24 tests,
including foreign-origin indexing denial and public dependency availability.
No real Owner data, Photos state, or cloud objects were mutated by these tests.

Both helpers ship in the sealed OwnerRuntime. A signed installed release and
runtime hash validation are required before the installed-app tickets close.
