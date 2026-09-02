# PBB Sequential Cycle SOP

This is the canonical development loop for PhotosByElie Backstage (`PBB`). Its purpose is to keep product decisions, source, builds, installed behavior, and ticket state on one understandable line.

PBE is the customer-facing web application and remains a separate release line. This SOP does not merge PBE work into PBB.

## Invariants

- Use one permanent PBB worktree checked out on `release/backstage`.
- Keep the generated PBB architecture graph at `graphify-out/` in that permanent worktree, scoped to `native/PhotosByElieBackstage`. Treat it as local ignored analysis, not branch content.
- Keep exactly one PBB ticket active at a time.
- Do not create a branch or worktree per PBB ticket.
- Do not start the next PBB ticket while the current ticket is still being implemented, built, installed, or reviewed.
- Keep source tests, successful compilation, signed installation, and Elie's installed-app acceptance as distinct evidence on the same ticket.
- Preserve exact YouTrack state labels and fresh-read before and after every ticket mutation.

A short-lived safety branch is allowed only when an experiment could damage or obscure the canonical PBB line. Name the reason before creating it, keep it limited to the current ticket, integrate or reject it promptly, and remove it before selecting another ticket.

## The Cycle

### 1. Grab one ticket

Fresh-read unresolved PBB tickets from YouTrack and select the highest-value actionable ticket. Prefer correctness, data safety, blocked workflows, and operational reliability before polish.

Confirm that no other PBB ticket or worker is active. Mark the selected ticket `In Progress`.

At cycle start report:

```text
PBB-NNN — Short title
What it changes: plain-language behavior.
Why it is next: concise priority reason.
```

### 2. Clarify with Elie

Ask focused questions whenever product intent, visible behavior, consequences, or acceptance is ambiguous. Ask one decision at a time when an answer can change the next question.

Do not make Elie specify routine implementation details. Stop asking once the desired observable behavior is clear enough to build and test.

### 3. Code on the canonical line

Work directly in the canonical PBB worktree on `release/backstage`. Make small `photosbyelie:` commits and preserve unrelated state.

Use the canonical worktree's Graphify graph for architecture and impact questions before broad source searches, then verify its pointers in source and tests. If the graph is missing or predates the current PBB source, rebuild or update it in this same worktree; do not copy a graph from another branch or create a ticket worktree just to obtain one.

Keep the ticket `In Progress` throughout implementation, compilation, installation, and owner review. Do not move it to `Fixed` merely because source or tests are ready. A failed approach or rejected design is another iteration of the same ticket, not a reason to open a parallel branch or ticket cycle.

### 4. Test, compile, and deploy locally

Run ticket-focused tests and the proportionate Backstage regression suite. Then compile, sign, install, and launch the exact candidate build locally.

Record the source commit, visible version/build, test result, signature result, installed path, and launch result. Installation and launch are part of the normal authorized PBB cycle and do not require a repeated generic permission question. Any newly encountered destructive, account, credential, payment, publication, or unrelated production mutation remains a separate gate.

### 5. Ask Elie to try it

Present the exact installed behavior and the shortest useful acceptance exercise. Do not close the ticket merely because tests pass or the app launches.

- If Elie accepts it, proceed to closeout.
- If Elie rejects it or finds another defect in the intended behavior, keep the ticket `In Progress`, record the result, and return to clarification or coding.
- If the new observation is materially separate from the ticket's intended behavior, keep the current cycle coherent and create or update the separate ticket without starting its implementation.

### 6. Close, then repeat

After acceptance, independently verify the installed build and ticket evidence. Commit and push the accepted canonical line, add the commit/build/test/acceptance receipt to YouTrack, and move the ticket to `Verified`.

Fresh-read the closed ticket to confirm the mutation. Only then fresh-read the unresolved PBB queue and select the next ticket.

## Pauses and Blocks

If work cannot continue safely, leave the current ticket in its accurate nonterminal state and record the exact blocker and next action. Do not silently switch to another PBB ticket.

Moving to another PBB ticket while one is blocked requires an explicit decision from Elie to park or defer the blocked ticket. Once parked, the next cycle still starts from a fresh YouTrack read.

## Existing Branch and Worktree Cleanup

Historical PBB branches and worktrees may predate this SOP. Before removing one, audit it for uncommitted files and commits not reachable from `release/backstage`. Preserve or integrate wanted work, then remove the obsolete worktree and branch. Never delete first and investigate later.

The cleanup is complete when one canonical PBB worktree remains on `release/backstage`, no other PBB work is active, and any retained historical branch has a documented reason.
