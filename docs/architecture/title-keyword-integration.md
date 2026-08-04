# Title/Keyword Proposal Integration Ledger

Status: active integration branch

Base: `codex/david-pbb-43-review` at `dba4bfaa`

Integration branch: `codex/integrate-title-keyword`

This branch is the protected consolidation lane for the title/keyword proposal
ladder, bounded shoot batching, durable audit state, and native Owner controls.
The dirty primary checkout remains untouched; unrelated site, catalog,
publication, and date-picker work is not part of this integration.

## Canonical ladder

| Default label | Model | Effort | Vision |
| --- | --- | --- | --- |
| GPT-5.4 mini low | `gpt-5.4-mini` | `low` | yes |
| Luna Max vision | `gpt-5.6-luna` | `max` | yes |
| Sol High vision | `gpt-5.6-sol` | `high` | yes |

The provider-facing model and effort are stored separately so an audit can
answer both “which model?” and “which
effort?” without treating `vision` as a fictional model suffix. Owner may add,
remove, edit, and reorder any number of `{model, effort, vision: true}` rungs.
Known GPT-5.4/5.6 effort combinations are validated before save; unfamiliar
model identifiers are validated by Codex at execution. Backstage prefers Codex
Desktop's bundled executable, which supports Luna `max`, over an older CLI on
`PATH`.

## Source branches

| Source | Contribution | Disposition |
| --- | --- | --- |
| `f98c76b3` / `codex/pbb-66-model-ladder` | Native ladder selector and model metadata contract | Ported, then normalized to Luna Max |
| `e95f8aa3` / `codex/pbb-71-bounded-batching` | Shoot grouping, bounded chunks, resume state, per-item provenance | Ported; validation in progress |
| dirty primary checkout | Current site/catalog/publication/date-picker work | Preserved outside this branch |
| `codex/pbb-70` and detached connector worktree | Cloud/Owner preview experiments | Separate until independently accepted |

## Acceptance gates

- Owner.sqlite remains the durable source of truth for ladder selection and
  title/keyword queue state.
- Nightly title/keyword proposals and explicit Backstage Request AI proposals
  record the same model/effort/vision facts.
- Bounded batch chunks can split, retry, resume, and preserve per-photo
  provenance without changing canonical metadata.
- Native Review exposes the effective proposal model and effort while keeping
  proposal loading distinct from human approval.
- Synthetic/disposable-database tests pass before any live Owner database or
  real proposal run is touched.
