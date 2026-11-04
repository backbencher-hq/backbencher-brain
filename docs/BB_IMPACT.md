<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written guide to bb_impact: what "what breaks if
  this changes" actually measures, the declared budgets and completeness machinery,
  the wall clock, and the refusal cases.
WHO IT IS FOR — anyone deciding whether a symbol is safe to change, and the gates
  that hold this page to the registry and the measured component.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_impact/descriptor.ts,
  src/mcp/tools/bb_impact/handler.ts, src/mcp/components/impact/*,
  src/lsp/impact.ts, script/tool-docs/curation/bb_impact.ts.
-->

# Impact analysis — what changes if this symbol changes

`bb_impact` answers the reverse-dependency question from stored relationship rows:
if this symbol changes, which symbols depend on it, through which relationship
kinds, and how complete is that set? It supports one mode, `impact`.

The tool never invents an empty answer. An unknown symbol, an ambiguous member
name with no usable `file` hint, an empty `relationshipTypes` list, or an option
the tool does not accept are all named errors with `isError` set — an empty impact
page would read as "nothing depends on this", which is the one claim the tool must
not make by accident.

## Parameters

| Parameter | Type | Meaning |
| --- | --- | --- |
| `symbol` | string (required) | Symbol name to compute impact for. `target`, `symbolName` and `query` are accepted spellings of the same option. |
| `relationshipTypes` | array of strings | Stored relationship kinds that count as dependencies. Default: `calls`, `instantiates`, `extends`, `implements`. The applied list is echoed in every answer, so a misspelled kind produces a visible empty set rather than a disguised one. An empty list is refused. |
| `file` | string | Defining-file hint for a symbol NAME carried by several stored symbols. It either identifies that copy or the answer is a named refusal — never a silent relabel to another copy. For a member name it resolves the walk through the owning declaration. |
| `refresh` | boolean | Set `false` to skip the bounded staleness repair and answer from the existing index. When omitted, stale files inside the answer are repaired within budget and the walk is re-run. |

## What an answer declares

- **The measurement rule** (`rule`): the relationship kinds that counted, the
  owner-cascade, the noise policy and the depth cap. Every count in the answer is
  a measurement of this same list.
- **The declared budget** (`budget`): node budget 200, depth cap 5 (an EXPANSION
  cap — direct dependents are `depth: 0`, so the deepest reported dependent is
  `maxDepth - 1`), the two wall-clock deadlines (`walkTimeCeilingMs` for the
  engine walk and `callDeadlineMs` for the component's own work), and the
  traversal bounds the engine applies.
- **Completeness** (`countVerification`): whenever truncation was declared or the
  walk reached the last expandable depth, the returned set is measured against an
  unbounded walk of the same rule. `complete: true` means the measurement proved
  the returned set IS the whole truth; `false` names a prefix or a declared
  unknown; `null` means no measurement was bought because the set is complete by
  construction.
- **The dependents**: every row carries its depth, per-edge evidence tier and
  confidence, cross-language flag, bridge, and its own position. `via` says how
  each row is a dependent — `exact`, `member` (owner cascade, with `viaMember`), or
  `range-folded` (the cascade RANGE widened). `evidenceAtDepth` distinguishes the
  measured shortest path from the row the engine stamped while walking
  depth-first; where no row can be attributed, every evidence field is `null`
  rather than quoted from a longer path.
- **The root resolution** (`rootMatch`): the name asked for, whether the match was
  exact, an exact-exempt-kind hit, a containment match, or a member→owner
  substitution, and how many stored symbols carry that name. An ambiguous
  traversable name is answered about the copy the engine resolves, with
  `nameMatches` disclosing the ambiguity.
- **Counts**: `directCount` (depth-0 dependents) and `totalCountIfKnown` (the
  transitive total under the same rule), each `null` when the measurement hit a
  declared ceiling, was refused, or stopped on its clock. Neither is ever smaller
  than `shownCount`; when the measurement proves the set complete they equal it.
- **Freshness**: a per-dependent `stale` flag (`true`/`false`, or `null` when the
  file is not in the index), a summary `freshness` envelope, and `rootStale` —
  a stale root with fresh dependents is still a stale answer.

## The wall clock, stated out loud

The walk is bounded in wall time by a declared deadline (`budget.walkTimeCeilingMs`).
A walk that reaches it is a SAMPLE, declared with `truncated`, a truncation reason
naming `walk-time-budget-exhausted`, the engine's returned and uncapped counts in
`traversal`, and `reproducible: false`. This is the honest response to a hub whose
answer would otherwise run past the tool's 5 s budget, not a hidden cut. The clock
is the one bound that is a property of the machine rather than of the index, so it
is always declared rather than inferred.

## Refusals

- Missing symbol, or a symbol not found in the index.
- An ambiguous MEMBER name with no usable `file` hint: the error lists candidate
  copies with file and line (bounded to 8, plus a count of the rest) and names the
  `file` option as the remediation.
- A `file` hint that does not identify the symbol — an unknown path, or a path
  naming a different copy than the walk would root at.
- `relationshipTypes: []` — an empty rule matches nothing, so the tool refuses
  instead of letting the engine substitute its default kind set.
- A root that resolves to a non-traversable kind AND is not the symbol asked for.
- Unknown options or wrong value types, rejected by the shared validator with the
  accepted options named.

## Limits a caller must carry forward

- Static impact reads stored relationship rows, not executed calls; runtime
  dispatch and reflection are invisible.
- Depth is an expansion cap: a declared total is the total under the declared cap
  (5 by default), and a chain deeper than the cap keeps a declared
  `caller-depth-cap-reached` truncation rather than claiming a bounded set is
  whole.
- The engine's row bounds are not truncations of the DEPENDENT set. When the
  completeness measurement proved the returned set complete, `truncated` stays
  false and those bounds remain visible in `traversal.engineTruncated`.
- The owner-cascade RANGE is a strict SUPERSET of the owner relation: it never
  loses a dependent the owner relation has, but it folds in siblings of a member.
  `cascade.rangeFolded` counts those rows, so the over-count is visible.
- A misspelled `relationshipTypes` kind is measured as an empty set with
  `truncated: false`, and `rule.relationshipTypes` echoes the misspelling so the
  mistake is auditable.
- `totalCountIfKnown` and `directCount` are both `null` when the counting walk
  hits its own ceiling, its circuit breaker, or the call deadline; the answer says
  which, and `reproducible: false` is published.

## Measured cost

Warm, five-run measurements on the declared tiers (raw runs in
`validation/tools/bb_impact/LATENCY.json`): p50 83.8 ms / p95 100.8 ms on
`test/fixtures/polyglot/ts-js`, p50 176.5 ms / p95 243.5 ms on the 100-file
synthetic fixture. On the reference large index (11,440 files, ~3.4 GB), measured
through the tool's byte-read-only open with the index files hashed before and
after (`dbUnchanged: true`), per-symbol p95 was 327.7 ms for the widest studied
hub, and the reported hub case (`getRawInstance`) answered p50 2 424–2 805 ms /
p95 2 450–3 148 ms across two baseline-protocol series, inside the 5 000 ms
budget. Fixture tiers are the regression baselines; absolute milliseconds belong
to the machine.

## Verifying this page

```bash
npx tsx script/verify-tool-docs.ts --only bb_impact
bun run script/m13/verify-impact-*.ts   # lane gates
bun run script/m48/verify-p1-impact-unity.ts
```
