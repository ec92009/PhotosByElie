# Backstage maintainability review budgets

Run `uv run scripts/backstage_maintainability.py --check docs/architecture/backstage-maintainability-baseline.json` before integrating a native change. The command exits nonzero for new or increased over-budget production Swift metrics. `npm run audit:backstage` is the same check. Use `--output /tmp/backstage-metrics.json` for the full per-file/function report.

The tool pins Lizard 1.24.0, records the exact source revision and whether native source is dirty, and reports effective lines, cyclomatic complexity, parameter count and nested structures. It reads tracked and newly added first-party Swift under Sources; generated files and DEBUG-only preview fixtures are excluded, and DEBUG preview blocks are blanked before analysis. Tests and copied fixture databases are outside Sources. The parser's `ns` metric describes nested control structures, not a complete Swift cognitive-complexity measure. Inspect macros, conditional compilation, closure-heavy SwiftUI and parser limitations rather than treating a low number as proof of simplicity.

| Metric | Review budget |
| --- | ---: |
| Production source file | 1,000 effective lines |
| Function | 60 effective lines |
| Cyclomatic complexity | 15 |
| Parameters | 6 |
| Nested control structures | 4 |

The baseline records existing debt with an exact ceiling for each named function/file. It permits no growth above that ceiling and gives new functions only the normal budget. It is not an unlimited exception for large files. A baseline change needs an explicit review note identifying the responsibility, measured limit and reason further splitting would obscure correctness, or the bounded follow-up needed. Do not regenerate the baseline merely to make a failing check green.

Preserve transaction ownership when splitting persistence code: one connection, one outer transaction, the same validation order, and audit/undo snapshots in that transaction. Action-specific helpers must not open or commit another connection. Read-side extraction must preserve filtering before summary/page construction, exact identity fallback and tombstone exclusion. UI extraction must preserve observation, synchronous busy acknowledgement, captured inputs and existing authority gates.

For each bounded extraction: add or identify characterization tests before moving code, run the affected suite, inspect the metric delta, and complete the normal signed installed PBB cycle. Public PBE publication and Worker deployment remain separate.
