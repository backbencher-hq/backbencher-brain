# `bb_migrate` Reference

`bb_migrate` is a read-only migration planner. It accepts `symbolNames` for
batch planning and retains `symbolName` as a single-symbol compatibility alias.

Every number it prints is either measured from the index or labelled as a
methodology constant. The line between those two is the whole contract of this
tool, and the sections below say which is which.

## Output

The normalized result includes:

- one plan per supported symbol
- `dependencyOrder`, a deterministic topological order over resolved plan
  relationships, with dependency nodes before their dependents
- `dependencyGraph`, reporting resolved edges, unresolved dependencies, cycles,
  and `orderingStatus` (`complete`, `partial`, `cyclic`, or `no-edges`)
- `effort`, the single authoritative effort figure, plus the arithmetic that
  reconciles it with the per-plan figures
- explicit `unsupported` entries, each with a typed reason
- explicit `truncation` metadata that separates deduplication from the cap
- the registered `freshness` envelope, and a per-plan `stale` flag

JSON is machine-readable; text preserves the legacy readable plan style while
adding ordering, methodology, unsupported cases, and truncation.

## Library mappings: evidence and guesses are different fields

A plan carries two dependency lists and they are not interchangeable.

- **`dependencies`** — libraries backed by an *indexed import*: the symbol's own
  recorded imports, or a third-party package reached through a relationship
  endpoint under `node_modules`. Each entry carries
  `provenance: "indexed-import"`. These are claims about the code, and they are
  the only kind that may move an effort or risk number.
- **`inferredDependencies`** — name-based guesses. A component named
  `fetchWidget` is guessed to use `axios`; one named `OrderRepository` is guessed
  to use `drizzle-orm`. Each entry carries `provenance: "name-heuristic"`, a
  `target` of `null` unless a dictionary row happens to exist, and a note saying
  it is not an observed import. **These are not evidence.** They never appear in
  `dependencies`, they never contribute to `effortEstimateHours`, and they never
  change `riskAssessment`.

`dependencyProvenance` states the counts and, when no indexed import evidence is
available, says so in words:

> No indexed import evidence is available for this component, so `dependencies`
> is empty. `inferredDependencies` holds name-based guesses that are NOT evidence
> and do not affect effort or risk.

An unmapped library in `dependencies` has `target: null`, `status: "uncertain"`,
an explicit `unsupportedReason`, and is never presented as a supported mapping.
It also carries the 6-hour research allowance. A guess never does.

### Known evidence limit

The index does not currently record per-symbol imports. `analyzePolyglotProjectFromDB`
reconstructs symbols with an empty `metadata`, so in practice `dependencies` is
usually empty and the tool says so rather than filling the gap with a guess. This
is a measured state, not a design choice: the previous behaviour filled the gap
with name heuristics, which produced plans claiming a Go component used `jest`
and a Python YAML file was planned as migratable program logic.

## Language vocabulary

The source language is resolved through the same alias table the indexer's
labels are checked against, and a resolved name is always a dictionary key.
`F#`→`fsharp`, `C#`→`csharp`, `C++`→`cpp`, `Objective-C`/`Objective-C++`→
`objectivec`, `Shell`/`sh`→`bash`, `TSX`→`typescript`.

Languages with no importable library surface are recognized and then **refused**
with `unsupportedReason: "unsupported-source"` and a reason in plain words, not
planned as an unknown language: `html`, `xml`, `css`, `json`, `yaml`, `toml`,
`hcl`, `markdown`, `make`, `sql`, `protobuf`, `clean`, `vb`, `nim`. A YAML
document is not migratable program logic, and the tool will not produce an effort
estimate suggesting otherwise.

A target is refused with `unsupportedReason: "unsupported-target"` when either

- the target language is not one this tool holds data for, or
- the tool holds **no route at all** from the requested source to that target
  (for example `go → haskell`, where no equivalence row exists in either
  direction). This is deliberately different from a route that exists but has
  gaps: a known route is planned and its gaps are named.

## Refusals

Every refused symbol appears in `unsupported` with `symbolName`, a `reason`
sentence, and an `unsupportedReason`:

| Reason | Meaning |
|---|---|
| `missing-symbol` | no indexed symbol has that name |
| `ambiguous-symbol` | more than one indexed symbol has that name |
| `same-language` | source and target resolve to the same language |
| `unsupported-source` | the component's language is not migratable program logic |
| `unsupported-target` | the target is unknown, or no route exists from this source |

`plans.length + unsupported.length` always equals the number of distinct names
the request resolved to. Nothing is dropped silently.

### Ambiguity is a refusal, not a guess

When a requested name matches several indexed symbols, `bb_migrate` produces **no
plan** and lists every candidate:

```
unsupported:
  execute: "execute" matches 2 indexed symbols (command.go, command.go); re-run
           against one file's symbol id or rename to disambiguate
    candidate: execute (go) in command.go
    candidate: Execute (go) in command.go
```

The previous behaviour returned a confident plan for whichever matching symbol
came first in the index and never mentioned the others. A migration plan is a
claim about one specific component; silently choosing one is the failure mode
this tool can least afford.

Each plan also carries `symbolId` and `sourceFile` from that exact symbol, and
staleness is judged from the plan's own file rather than from a separate
name-based lookup that could resolve to a different symbol.

## Effort: one number, reconciled

Two effort figures appear in a result and they are not supposed to be equal:

- **`effort.totalHours`** — authoritative. `baseHours + relationshipHours +
  missingMappingHours`, where relationship hours count each distinct indexed
  relationship **once across the whole request**.
- **`plan.effortEstimateHours`** — a per-plan view. It counts that plan's own
  evidence, so a relationship cited by two plans is counted in both.

`effort.perPlanSumHours`, `effort.sharedRelationshipHours`, and
`effort.reconciliation` state the difference explicitly, and the text output
prints the reconciliation rather than two totals that silently disagree. On a
two-symbol mutual-call request this reads:

```
total effort: 20h (per-plan effort sums to 28h; 8h of that is relationship time
on edges cited by more than one plan, counted once in the 20h methodology total)
```

The methodology constants, all labelled as methodology rather than measurement:

- 4 base hours per supported component
- 2 hours per unique indexed relationship
- 6 hours per indexed import with no registered equivalence
- 2 relationship hours only when the indexed relationship collection was
  available; unavailable evidence remains an explicit limitation

## Risk

`riskAssessment.level` is derived from measured quantities only:

- `High` — more than 5 unique indexed relationships on the component
- `Medium` — at least one indexed import has no registered equivalence
- `Critical` — the component is data-shaped (a table/schema/entity/model/dao/
  repository, or a symbol the index typed as a database entity)
- `Low` — none of the above

An evidence-free component is `Low`. It is not escalated by the tool's own
guessing, which is the behaviour that previously made every measured plan `Medium`
or higher for reasons unrelated to the code.

## Relationship evidence

`relationshipEvidence` carries a stable relationship identity, both symbol IDs,
both file paths, the relationship type, and `strength`.

**`strength` is not a measurement.** The index does not score relationships, and
the DB bridge writes the constant `0.8` for every row — measured as exactly one
distinct value over 500 relationships on every corpus checked. It is reported
because it is part of the evidence shape; read it as a placeholder, not a number.

Evidence is scoped to the exact endpoint symbol IDs, not to the file. A file can
contain several components, and counting every relationship touching that file
would charge one migration for its unrelated neighbours.

## Dependency ordering

`dependencyOrder` is a deterministic topological order in which a relationship
source (the dependent) is emitted after its target (the dependency). It is
derived from resolved directed edges, not from dependency counts.

`orderingStatus`:

| Status | Meaning |
|---|---|
| `complete` | every requested symbol was placed, dependency-first, no cycles |
| `partial` | at least one dependency could not be placed — it is outside the requested set, or sits in a cycle |
| `cyclic` | the resolved graph contains a cycle; the members are named in `cycles` |
| `no-edges` | the requested symbols have no relationships at all |

A cyclic or partial graph never reports `complete` and must not be read as a
dependency order. `partial` includes the case where *no* edge could be placed but
unresolved dependencies exist — that is the opposite of `no-edges`.

## Truncation

`truncation` reports the two independent reductions of a request separately,
because a caller needs to distinguish a merged duplicate from a dropped name:

- `requested` — names received after trimming
- `returned` — distinct names actually processed (cap 100)
- `deduplicated` — names merged because they were already present
- `capped` — names dropped by the 100-symbol limit
- `truncated` — true if either reduction applied

## Methodology limits

- Plans are estimates. The tool does not generate, replace, or compile
  target-language source.
- Library mappings are advisory equivalence guidance, not proof of semantic
  compatibility, and not translated source.
- Effort is a flat methodology constant per unit, not an estimate calibrated
  against completed migrations. A heavily-called function produces a large number
  because it has many indexed relationships, including test-file callers.
- Dependency ordering and mapping depend on the analyzer-extracted symbol and
  relationship graph. Reflection, dynamic dispatch, and cross-file relations the
  grammar does not model limit the completeness of the resulting plan.
- `dependencies` is empty on the current index because imports are not recorded
  per symbol. This is stated in `dependencyProvenance` on every affected plan
  rather than being papered over.

```json
{"symbolNames":["authenticate","authorize"],"targetLanguage":"go","format":"json"}
```
