---
name: photosbyelie-requested-ai-proposals
description: Generate title and keyword proposal drafts only for PhotosByElie assets explicitly marked Request AI. Use for the nightly 02:00 Europe/Madrid pass, the Backstage Run AI pass now action, or a safe status or resume check of the requested proposal queue.
---

# PhotosByElie Requested AI Proposals

Generate bounded, auditable title and keyword drafts without changing canonical metadata, approval, Apple Photos, R2, or publication. Work only in the local PhotosByElie project because Owner.sqlite and the bounded previews are machine-local and Git-ignored.

## Run the pass

1. Work from `/Users/ecohen/MDev/PhotosByElie`.
2. Confirm the request queue and any active run:

   ```bash
   python3 scripts/requested_ai_proposal_pass.py \
     --repo-root /Users/ecohen/MDev/PhotosByElie \
     --status
   ```

3. Start or attach to the durable pass:

   ```bash
   python3 scripts/requested_ai_proposal_pass.py \
     --repo-root /Users/ecohen/MDev/PhotosByElie \
     --trigger scheduled
   ```

4. Report the final `requested`, `processed`, `proposed`, `skipped`, `failed`, and `remaining` counts.
5. Leave failed items in Requesting AI. The next manual or scheduled pass retries them.

If a run is already active, attach to it. Never start a competing run.

## Safety rules

- Process only assets whose editorial state is `requesting-ai`.
- Require an existing bounded JPEG preview captured when Request AI was selected.
- Use the signed-in local `codex exec`; do not require or store an OpenAI API key.
- Keep the sandbox read-only and make one proposal attempt per asset per pass.
- Write only separate proposal and run records in Owner.sqlite.
- Never change visible or canonical title or keywords, approval, fixture placement, Apple Photos, R2, or publication.
- Never load or approve proposals automatically.
- Preserve errors and attempt counts for the next pass.
- Honor cancellation between assets and retain completed checkpoints.

## Backstage behavior

- Backstage polls durable status and shows progress for manual and Scheduled passes.
- `X new proposals ready` is a persistent non-modal notice.
- Load proposals into editable drafts only.
- Load clean rows immediately and preserve manual conflicts until a deliberate replacement.
- Preserve list position, selection, scroll offset, editor focus, and keyboard focus.
