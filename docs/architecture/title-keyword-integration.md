# Title/Keyword Proposal Integration Ledger

Status: active integration branch

Base: `codex/david-pbb-43-review` at `dba4bfaa`

Integration branch: `codex/integrate-title-keyword`

This branch is the protected consolidation lane for the title/keyword proposal
ladder, bounded shoot batching, durable audit state, and native Owner controls.
The dirty primary checkout remains untouched; unrelated site, catalog,
publication, and date-picker work is not part of this integration.

## Canonical ladder

| Label | Project alias | Resolved model | Effort | Vision |
| --- | --- | --- | --- | --- |
| Free | `codex-gpt-5.4-mini` | `gpt-5.4-mini` | `low` | no |
| Luna Max vision | `codex-gpt-5.6-luna-max-vision` | `gpt-5.6-luna` | `max` | yes |
| Sol High vision | `codex-gpt-5.6-sol-high-vision` | `gpt-5.6-sol` | `high` | yes |

The aliases are project labels. The provider-facing model and effort are
stored separately so an audit can answer both “which model?” and “which
effort?” without treating `vision` as a fictional model suffix.

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
