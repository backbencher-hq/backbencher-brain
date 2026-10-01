# `bb_migrate` Reference

`bb_migrate` is a read-only migration planner. It accepts `symbolNames` for batch
planning and retains `symbolName` as a single-symbol compatibility alias.

Every number it prints is either **measured from the index** or **labelled as a
methodology constant**. The line between those two is the whole contract of this
tool.

## Output

- one plan per supported symbol, each carrying its `symbolId` and `sourceFile`
- `dependencyOrder`, a deterministic topological order with dependency nodes first
- `dependencyGraph` — resolved edges, unresolved dependencies, cycles, and
  `orderingStatus` (`complete`, `partial`, `cyclic`, `no-edges`)
- `relationshipEvidence` — per edge: id, type, both symbol ids, both external
  endpoint names, both files, **line**, **confidence**, **isCrossLanguage**,
  **bridgeMechanism**, `isCrossFile`, plus `endpointsResolved` and `isTestEvidence`
- `evidenceTotals` and a per-plan `evidenceBreakdown`
- `effort` — one authoritative total plus the arithmetic reconciling it with the
  per-plan view
- `dependencyProvenance` — whether import evidence was available at all
- explicit `unsupported` entries, each with a typed reason
- explicit `truncation` metadata separating deduplication from the cap
- the registered `freshness` envelope and a per-plan `stale` flag

## Relationship evidence: everything here is read, not invented

`brain_relationship` carries fourteen columns. All the ones a migration plan needs
are read and surfaced:

| Field | Source column | Measured availability |
|---|---|---|
| `line` | `line_number` | 4738/5228 (90.6%) cobra, 6691/7072 (94.6%) flask |
| `confidence` | `confidence` | 100%, 6 distinct values on cobra |
| `isCrossLanguage` | `is_cross_language` | 118 cobra, 175 flask |
| `bridgeMechanism` | `bridge_mechanism` | `name-resolution` on both |
| `isCrossFile` | `is_cross_file` | 1541 cobra, 2016 flask |
| `sourceExternal` / `targetExternal` | same | 100% of rows carry a value |
| `endpointsResolved` | derived | both endpoints are indexed symbols |
| `isTestEvidence` | derived from file paths | — |
| `isIntegrationPoint` | derived from `relationship_type` | — |

There is **no fabricated constant** in this evidence. A previous version wrote
`strength: 0.8` for every row while the row's real confidence sat unread; that
field is gone and `confidence` is the index's own number.

### `endpointsResolved` — why some edges are not billed

An edge whose endpoint is not an indexed symbol cannot be located, planned, or
done. You cannot schedule work against it. Such an edge is **still shown** in
`relationshipEvidence`, still named via `targetExternal`, and still counted in
`evidenceBreakdown.unresolvable` — it is simply **not charged** 2 hours. A risk
factor says the port cannot be scoped from it.

### `isTestEvidence` — why the headline number is split

Measured on cobra: **55.3%** of a plan's evidence is test code. A flat 2h per edge
makes that dominate the total — `AddCommand` accumulated 147 test callers and 15
production ones, so a 328-hour figure said "this function is enormous" when it
mostly said "this function is well tested".

Both are charged (a port does have to update its callers) and both are reported:

```
evidence: 15 production edge(s), 147 test edge(s), 0 crossing a language
boundary, 0 with an unresolvable endpoint (not charged); 162 carry a line
```

Read the split, not the total.

## Library mappings: evidence and guesses are different fields

- **`dependencies`** — packages backed by an *observed* source: an import carried
  on the symbol, or a third-party package at a `node_modules` relationship
  endpoint. `provenance: "indexed-import"`. These may move effort and risk.
- **`inferredDependencies`** — name-substring guesses (`fetchClientRepo` → `axios`
  and `drizzle-orm`). `provenance: "name-heuristic"`, `confidence: 0`,
  `status: "uncertain"`. **Not evidence.** Never in `dependencies`, never in an
  effort or risk number.

A guess that happens to match a dictionary row is *still* a guess: the row's
target is offered, the status stays `uncertain`, and the note says the
equivalence is unverified. Promoting it to `supported` with the row's
authoritative prose is the same fabrication one level deeper, and the suite kills
that mutation explicitly.

### Package canonicalization

A specifier is canonicalized to the bare package name the dictionary is keyed by,
and **both** evidenced sources go through the same function — previously they used
two different rules, so one package produced two different names.

| Input | Result | Note |
|---|---|---|
| `@nestjs/core` | `nestjs` | dictionary is keyed by the framework, i.e. the scope |
| `node:fs` | *excluded* | a builtin is not an installable dependency |
| `@types/node` | *excluded* | a type stub is not a runtime dependency |
| `./relative` | *excluded* | not a package |
| `drizzle-orm/node-postgres` | `drizzle-orm` | subpath stripped |

### Known evidence limit — stated, not papered over

**The index does not record per-file imports.** No analyzer captures them, so
`dependencies` is normally empty and `dependencyProvenance.importEvidence` is
`"unavailable"`. This is materially different from "this component has no
libraries", and the difference appears in the risk field:

> Library dependencies are UNKNOWN, not empty: the index does not record the
> imports this component performs. Resolve them before estimating.

A candidate extraction from `target_external` (the `module:attr` form) was
measured against imports parsed from the source text and **rejected**: 43.5%
precision / 12.6% recall on Python, and zero signal on Go and Rust, where the
analyzers emit no external-target relationships at all. Shipping F1 19.6% as
"evidence-backed mappings" would have replaced an open fabrication with a subtler
one. See `reviews/migrate/REVIEW.md`. Closing this properly is an analyzer
change — another lane's work — not a planner decision.

## Language vocabulary

Source and target resolve through one alias table, and a resolved name is always
a dictionary key. `F#`→`fsharp`, `C#`→`csharp`, `C++`→`cpp`,
`Objective-C`/`Objective-C++`→`objectivec`, `Shell`/`sh`→`bash`, `TSX`→`typescript`.

Languages with no importable library surface are recognized and then **refused**
with `unsupportedReason: "unsupported-source"` and a reason in plain words:
`html`, `xml`, `css`, `json`, `yaml`, `toml`, `hcl`, `markdown`, `make`, `sql`,
`protobuf`, `clean`, `vb`, `nim`. A YAML document is not migratable program
logic, and the tool will not produce an effort estimate suggesting otherwise.

A target is refused with `unsupported-target` when it is unknown, **or** when the
tool holds no route at all from the requested source (e.g. `go → haskell`, where
no equivalence row exists in either direction). A route that exists but has gaps
is planned, and its gaps are named.

## Refusals

| Reason | Meaning |
|---|---|
| `missing-symbol` | no indexed symbol has that name |
| `ambiguous-symbol` | more than one indexed symbol has that name |
| `same-language` | source and target resolve to the same language |
| `unsupported-source` | the component is not migratable program logic |
| `unsupported-target` | the target is unknown, or no route exists from this source |

`plans.length + unsupported.length` always equals the number of distinct names
the request resolved to.

**Ambiguity is a refusal, not a guess.** When a name matches several symbols the
tool produces no plan and lists every candidate:

```
unsupported:
  execute: "execute" matches 2 indexed symbols (command.go, command.go); re-run
           against one file's symbol id or rename to disambiguate
    candidate: execute (go) in command.go
    candidate: Execute (go) in command.go
```

A migration plan is a claim about one specific component; silently choosing one is
the failure this tool can least afford. Staleness is judged from the plan's own
symbol, not from a second name-based lookup that could resolve elsewhere.

**One exception, and it is not ambiguity.** Go and many other languages permit
`Execute` and `execute` in the same file: two functions, one component, one
file. Measured on cobra: five such pairs, all single-file. If every candidate is
in the same file and exactly one matches the requested spelling, that is the
answer. If no candidate matches exactly, the collision is real and is refused
with both candidates named. The engine preserves the caller's spelling for this
to work — it used to lowercase before planning, so asking for `Dual` returned a
plan for `dual`.

## What is charged, and what is not

Two independent reasons an indexed edge is **not** billed as migration work:

1. **Its endpoint is not an indexed symbol** (`endpointsResolved: false`). You
   cannot locate, plan, or do an edge with no endpoint. The name the indexer saw
   is preserved in `targetExternal`, and the count is reported.
2. **It is structural** (`isIntegrationPoint: false`) — `contains` or `exports`.
   `contains` is emitted by the indexer as an auto-generated ownership edge
   ("owner contains member") whose `line_number` is the **member's declaration
   line, not a call site**. Billing 2 hours to "update the place that contains
   this function" is billing for nothing. Measured on cobra: 792 `contains` and
   8 `exports` out of 5321 edges, ~15% of all evidence.

Every other type — `calls`, `uses`, `references`, `imports`, `instantiates`,
`extends`, `implements`, `overrides` — is an integration point and is charged.
**An unrecognised type is charged**, not waved through: assuming a new kind of
edge is structural would understate the work, and that is the worse error.

`evidenceBreakdown` partitions every cited edge into exactly one bucket:

```
evidence: 14 production + 147 test integration points, 1 structural, 1 unresolvable
```

## Effort: one number, reconciled

- **`effort.totalHours`** — authoritative:
  `baseHours + relationshipHours + missingMappingHours`, counting each distinct
  indexed relationship **once across the whole request**.
- **`plan.effortEstimateHours`** — a per-plan view, counting that plan's own
  evidence, so a relationship cited by two plans is counted twice.

`effort.perPlanSumHours`, `effort.sharedRelationshipHours` and
`effort.reconciliation` state the difference, and the text prints it:

```
total effort: 20h (per-plan effort sums to 28h; 8h of that is relationship time
on edges cited by more than one plan, counted once in the 20h methodology total)
```

Methodology constants, labelled as methodology rather than measurement:

- 4 base hours per supported component
- 2 hours per **chargeable** indexed relationship (resolvable AND an integration
  point), deduplicated across the request
- 6 hours per indexed import with no registered equivalence

The batch total and the per-plan figure use **one** chargeability rule, declared
once. When they diverged, the tool printed a "shared relationship hours" figure
of **minus four** — a negative number in a field meant to be a saving. The
reconciliation now reports `INTERNAL MISMATCH` rather than printing it, and a
claim asserts the gap is never negative.

These are flat per-unit figures, not estimates calibrated against completed
migrations. Read the evidence split before reading the total.

## Risk

`riskAssessment.level` derives from measured quantities only:

- `High` — more than 5 resolvable indexed relationships
- `Medium` — at least one unresolved import, or at least one integration point
  crossing a language boundary
- `Critical` — the component is data-shaped (a table/schema/entity/model/dao/
  repository typed as a class, struct, interface, type, table or enum)
- `Low` — none of the above

The **text output prints every factor** with a `why:` prefix, because a band
without its reason is not actionable. An evidence-free component is `Low`; it is
not escalated by the tool's own guessing.

## Dependency ordering

`dependencyOrder` is a deterministic topological order with a relationship's
source (the dependent) emitted after its target (the dependency), derived from
resolved directed edges rather than dependency counts.

| Status | Meaning |
|---|---|
| `complete` | every requested symbol placed, dependency-first, no cycles |
| `partial` | at least one dependency could not be placed — outside the requested set, or in a cycle |
| `cyclic` | the resolved graph has a cycle; members are named in `cycles` |
| `no-edges` | the requested symbols have no relationships at all |

`partial` includes the case where *no* edge could be placed but unresolved
dependencies exist — the opposite of `no-edges`. A cyclic or partial graph never
reports `complete`.

## Truncation

- `requested` — names received after trimming
- `returned` — distinct names processed (cap 100)
- `deduplicated` — names merged as duplicates
- `capped` — names dropped by the limit
- `cappedNames` — **which** names the cap dropped, in request order
- `truncated` — true if either reduction applied

Without `cappedNames` a caller learns only that 30 names vanished and cannot
tell which, so a migration wave that silently excluded a component is
indistinguishable from one that included it.

A caller can always tell a merged duplicate from a dropped name.

## Cost

Work is bounded by the requested symbols' own fan-in and fan-out, not by
repository size. The loader reads the requested symbols, the relationships that
touch them, and the display names of those relationships' far endpoints — it does
not load or reconstruct the project. Measured: a 1-symbol request on a
1216-symbol / 5228-relationship repository cites a small fraction of the edges,
and a 12-symbol request stays in the same order of magnitude.

## Limits

- Plans are estimates. The tool does not generate, replace, or compile
  target-language source.
- Library mappings are advisory equivalence guidance, not proof of semantic
  compatibility.
- The index does not record per-file imports, so `dependencies` is usually empty
  and library risk is UNKNOWN. Stated on every affected plan.
- Ordering and mapping depend on the analyzer-extracted graph. Reflection,
  dynamic dispatch, and cross-file relations the grammar does not model limit
  completeness.
- A cross-language flag exists on 118 of cobra's 5228 edges; where the indexer did
  not mark an edge cross-language, the plan does not claim it is.

```json
{"symbolNames":["authenticate","authorize"],"targetLanguage":"go","format":"json"}
```
