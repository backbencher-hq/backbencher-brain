# `bb_migrate` Reference

`bb_migrate` is a read-only migration planner. It accepts `symbolNames` for batch
planning and retains `symbolName` as a single-symbol compatibility alias.

Every number it prints is either **measured from the index** or **labelled as a
methodology constant**. The line between those two is the whole contract of this
tool.

## Output

- one plan per supported symbol, each carrying its `symbolId` and `sourceFile`
- `cohort`, a rollup of what the request resolved to — by file, by wave, by source
  language, and by refusal reason — plus `cohort.work`, what the call actually read
- `dependencyOrder`, a deterministic topological order with dependency nodes first
- `waves` — that order grouped into parallel-workable layers; `waves[0]` is what
  a team can start today
- `scope` — how much of the component's integration surface this request actually
  covers, and a sentence saying so
- `dependencyGraph` — resolved edges, unresolved dependencies, cycles, and
  `orderingStatus` (`complete`, `partial`, `cyclic`, `no-edges`)
- `relationshipEvidence` — per edge: id, type, both symbol ids, both external
  endpoint names, both files, **line**, **confidence**, **isCrossLanguage**,
  **bridgeMechanism**, `isCrossFile`, plus `endpointsResolved` and `isTestEvidence`
- `evidenceTotals` and a per-plan `evidenceBreakdown`
- `effort` — one authoritative total plus the arithmetic reconciling it with the
  per-plan view
- `dependencyProvenance` — **where the libraries came from**: the file the imports
  were read for, the standard-library / third-party / local / unclassified split,
  which libraries are mapped and which are not, and whether any name came from a
  canonicalization guess
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

| Input | Language | Result | Note |
|---|---|---|---|
| `@nestjs/core` | ts/js | `nestjs` | the dictionary is keyed by framework, i.e. the scope |
| `node:fs` | ts/js | *excluded* | a builtin is not an installable dependency |
| `@types/node` | ts/js | *excluded* | a type stub is not a runtime dependency |
| `./relative` | any | *excluded* | not a package |
| `drizzle-orm/node-postgres` | ts/js | `drizzle-orm` | npm subpath stripped to the package |
| `socket.io` | ts/js | `socket.io` | dots are KEPT — it is a real package name |
| `net/http` | go | `net/http` | no host, so it is a standard-library path and keeps every segment |
| `github.com/x/y/v2` | go | `y` | the REPOSITORY, not the module path — see below |
| `github.com/stretchr/testify/assert` | go | `testify` | an in-repo subpath names the repo's package, not a new library |
| `k8s.io/api/core/v1` | go | `api` | some hosts put the repository at a fixed position |
| `sigs.k8s.io/yaml` | go | `yaml` | undeclared host, so the last segment is taken — and that is reported |
| `package:flutter/material.dart` | dart | `flutter` | the PACKAGE is the first segment; the subpath names a library |
| `core.async` | clojure | `core.async` | namespaces are dotted paths, not modules |
| `asgiref` / `cryptography.fernet` | python | `asgiref` / `cryptography` | the first dotted segment is the module |

Canonicalization is **language-aware**, and has to be: the same text means
different things in different ecosystems. `core.async` is a whole Clojure
namespace and would be a truncated Python module. A single rule got all of these
wrong, which is what the audit measured.

### Go module paths: the repository, not the path

A Go import is a path, and the dictionary is keyed by a bare library name
(`gin`, `gorm`, `testify`, `net/http`). Reducing the wrong segment makes a
registered row unreachable, so which segment names the repository is decided by
the **host**, and each host's rule is declared with the layout it encodes:

| Host | Layout | Example |
|---|---|---|
| `github.com`, `gitlab.com`, `bitbucket.org`, `codeberg.org`, `gitea.com`, `sourceforge.net` | `<host>/<org>/<repo>[/<subpkg>...]` | `github.com/stretchr/testify/assert` → `testify` |
| `golang.org` | `golang.org/x/<repo>` else `golang.org/<repo>` | `golang.org/x/text/language` → `text` |
| `k8s.io` | `k8s.io/<module>[/<pkg>...]` | `k8s.io/api/core/v1` → `api` |
| `google.golang.org` | `<host>/<repo>[/<pkg>...]` | `.../protobuf/types/known/anypb` → `protobuf` |
| `cloud.google.com` | `cloud.google.com/go/<repo>` else `<host>/<repo>` | `cloud.google.com/go/storage` → `storage` |
| `go.uber.org`, `go.opentelemetry.io`, `nhooyr.io` | `<host>/<repo>[/<pkg>...]` | `go.opentelemetry.io/otel/trace` → `otel` |
| `gonum.org` | `gonum.org/vN/<repo>[/<pkg>...]` | `gonum.org/v1/gonum/stat` → `gonum` |
| `gopkg.in` | `gopkg.in/<repo>[.vN]` or `gopkg.in/<user>/<repo>` | `gopkg.in/src-d/go-git.v4` → `go-git.v4` |
| **anything else** | **last segment** — a guess, and reported as one | `sigs.k8s.io/yaml` → `yaml` |

A major-version segment (`/v2`, `/v3`) is removed **before** the index is
resolved, because it sits in a different place per host. A host gets an entry only
when the last-segment rule was measured to be wrong for it; hosts where the last
segment *is* the repository are deliberately absent and still resolve correctly.

**The last row is the honest limit.** For an unrecognised host the repository cannot
be known from the path alone, so the name may be a *package* rather than a
library, and a row keyed by the real repository will not be reached. That is this
tool's guess, and it is reported rather than blended in:

```jsonc
"hostRule": "declared"   // derived from the host's declared module layout
"hostRule": "fallback"   // last segment taken; may name a package, not a library
```

and counted per plan in `dependencyProvenance.imports.fallbackHostNames` with the
names in `fallbackHostLibraries`.

### Imports are read from the index

`dependencies` is built from the imports the index already holds for the component's
file, in `brain_import` — written by `parallel-indexer` and read by `doc-engine`,
`analysis/dependencies`, `health`, `quick-answer`, `quality` and `edit-engine`. The
migration lane was, for a long time, the only module claiming it did not exist.

Measured across 40 indexed projects / 82,879 symbols / 13,351 import rows:

| Language | Files carrying imports | Rows |
|---|---|---|
| go | 96.2% | 91,826 |
| python | 95.8% | 44,810 |
| javascript | 89.6% | 2,320 |
| clojure | 88.8% | 9,516 |
| rust | 78.2% | 326,302 |
| **typescript** | **0.0%** (22 files) | **0** |

TypeScript is a real, separate analyzer gap and is declared as one rather than
averaged away. On cobra, 35 of 36 Go files carry imports.

Every plan reports the split:

```jsonc
"imports": {
  "declared": 6,            // specifiers considered
  "fromIndex": 6,           // ...of which the INDEX holds
  "suppliedByCaller": 0,    // ...supplied on the request
  "standardLibrary": 4,
  "thirdParty": 2,
  "localCrate": 0,
  "unclassified": 0,        // no rule declared for this language — not zero
  "mapped": 1,              // third-party with a registered row
  "unmapped": 1,
  "unmappedLibraries": ["pflag"],
  "stdlibWithoutRow": 3,        // `fmt`, `bytes`, `io`: visible, NOT libraries
  "stdlibWithoutRowLibraries": ["bytes", "fmt", "io"],
  "fallbackHostNames": 0,
  "fallbackHostLibraries": [],
  "classification": "available"
}
```

Four distinctions in that block each prevent a specific false conclusion:

- **Standard library is reported, not suppressed.** `fmt` has no dictionary row, but
  suppressing the lookup on "standard library" throws away a real mapping —
  `net/http → requests / httpx` is a row precisely *because* porting a Go service
  means choosing a Python HTTP client. Classification drives **reporting**; only a
  **local crate** is skipped, because a relative import is a graph edge rather than
  a library.
- **A standard-library name with no row is not a library to research.** It is
  listed and counted (`stdlibWithoutRow`) but it is **not** charged the 6h research
  allowance and raises no risk factor. Charging it turned a five-import Go file into
  30h of fictitious research.
- **A measured zero is a finding.** "Every import this file declares is standard
  library" and "the index holds no import rows for this file" are different facts,
  and the note says which one it is:

  > `dependencies` holds no LIBRARY: all 6 import(s) src/srv.go declares are
  > standard library or local crate. **A MEASURED zero, not missing evidence.**

- **Python has no stdlib classification**, so `classifyImport` returns `null`
  (UNKNOWN) for it rather than guessing. A guess would put `os` and `json` in the
  dependency list of every Python plan. `classification` is `unavailable` only when
  *nothing* in the split could be classified.

### Known evidence limit — the one that remains

**Coverage, not reachability.** Once a specifier canonicalizes correctly it is
looked up, but most real libraries have no dictionary row — on cobra, 0 of its 5 Go
dependencies are keys, which is why the plans name `pflag`, `cobra`, `mousetrap`,
`md2man` and `yaml` as `uncertain` with confidence 0 and charge 6h each. That is a
dictionary-content gap, it is measured rather than assumed, and it is what
`unmappedLibraries` exists to make visible.

A candidate extraction from `target_external` (the `module:attr` form) was
measured against imports parsed from the source text and **rejected**: 43.5%
precision / 12.6% recall on Python, and zero signal on Go and Rust, where the
analyzers emit no external-target relationships at all. Shipping F1 19.6% as
"evidence-backed mappings" would have replaced an open fabrication with a subtler
one. See `reviews/migrate/REVIEW.md`.

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

## Asking about a module: `paths`, and the identity problem

Until round 6 the only way to ask about a module was to hand-type its symbol
names, and the result was indistinguishable from a deliberately chosen cohort.
"Plan the migration of `src/api`" is the question a team actually asks.

| option | meaning |
|---|---|
| `symbolNames` | component names; ambiguous names are refused, with the candidate ids |
| `symbolIds` | indexed symbol ids — the only unambiguous way to name a component |
| `paths` | project-relative **file or directory** paths; every indexed symbol in them joins the request |

`paths` and `symbolIds` **union** with `symbolNames` rather than replacing them:
naming a symbol *and* the file that contains it plans it once.

A path matches a file when it *is* that file or when it is a directory prefix of
it, compared on the project-relative path. `.`, `./` and an absolute path inside
the project all resolve to the same cohort; a path outside the project is refused
by name, because the boundary lives in the resolver rather than in the spelling.
The prefix is `LIKE`-escaped, so `%` and `_` in a path are literal.

### A name is not an identity

This was the deepest defect round 6 found, and it was found by running the
feature rather than by reasoning about it. Planning was **name-keyed**, so:

- a `paths` cohort could not plan two components sharing a name in different
  files — they collapsed to one entry, and the caller was never told. Measured on
  a one-file cobra cohort: **100 distinct names resolved to 209 symbols**, so a
  cohort could never plan more than 100 of what it covered, and 109 of them were
  unreachable with no report;
- the ambiguity refusal said *"re-run against one file's symbol id"* — a
  capability that **did not exist**. The advice named nothing the caller could do.

Both are fixed by making the request a list of **entries** — each either a name or
a symbol id — and by adding `symbolIds`:

- a `paths` entry is a symbol id, unambiguous by construction, and planned through
  `planMigrationById` with no resolution rule at all;
- an explicit name still goes through the planner's single ambiguity rule (same-file
  case variants resolve; cross-file collisions refuse and name their candidates),
  and that refusal now points at `symbolIds`, which exist.

An id no indexed symbol carries is a **refusal**, not an absence: it previously
vanished, and a typo'd id produced a clean, empty, successful-looking result.

### An empty plan set is never a clean success

Scoping a repository root on cobra plans **nothing**: the first 100 components by
file path are all `.github/workflows/*.yml`, and YAML is not migratable program
logic. The tool used to print `total effort: 0h` and leave the reader to work that
out. It now reports the refusal in the summary next to the totals:

```
cohort: NO PLANS: all 100 resolved component(s) were refused — 100 unsupported-source
  (e.g. "dependabot"). The cohort's language mix is 170 yaml, 253 markdown, 11 make,
  829 go; the 100 component(s) the cap let through were 100 yaml, so scope paths to
  the code you mean.
refused: 100 of 100 requested component(s) produced no plan — 100 unsupported-source;
  the reasons are listed under "unsupported" below  NO PLANS WERE PRODUCED
cohort languages: 829 go; 253 markdown; 170 yaml [100 processed: 0 planned, 100 refused]; 11 make
```

`cohort.byLanguage` covers the **whole resolved cohort**, not the capped slice.
My first version counted only what the cap let through and cheerfully reported
`100 yaml` for a repository that is 829 Go — true of the slice and false of the
cohort, which is worse than not reporting it.

## Cohort rollup

`cohort` rolls the request up by file and by wave, which is the shape a programme
is actually planned in:

```
cohort: 213 indexed symbol(s) under 1 path(s), covering 1 file(s) in the plans
  returned (113 of 213 resolved components were dropped by the 100-component cap)
per file: command.go (88 sym, 2108h)
per wave: wave 1 = 61 sym, 670h; wave 2 = 1 sym, 26h; wave 3 = 26 sym, 1412h
```

`perPlanSumHours` per group is the sum of that group's **per-plan** effort, so a
relationship cited by two symbols in the same group is counted in both. It is
labelled the same way at the batch level, and the deduplicated figure is
`effort.totalHours`; the two are reconciled in `effort.reconciliation`.

Wave 3 above is **cycle members**. `computeDependencyOrder` cannot emit a symbol
that sits in a cycle — Kahn's algorithm never reaches indegree 0 for it — so those
symbols were simply **absent from the wave plan**. Measured on the one-file cobra
cohort: **25 of 100** planned symbols sit in cycles. A cycle is a group that cannot
be split, so its members are collected into one trailing wave, and the wave plan
accounts for every planned symbol.

Two same-named components in one file are still **one wave label**. `waves` is a
list of names, so when two plans share a name the label cannot say which file is
meant — `cappedNames` has the same ambiguity and resolves it by rendering
`name (file)`. Use `cohort.wavePlan` for the identity a caller can index: the same
partition keyed by `symbolId`, where every plan appears exactly once.

`paths` and `symbolIds` may name the same component. The union de-duplicates by
id, so it is planned once — the path loader's own de-dup cannot cover this case,
because it only sees paths.

### The cap bounds the work, and the work is observable

`cohort.work` reports what the call actually read next to what the project holds:

```
work: {symbolsLoaded: 100, relationshipsLoaded: 234, projectSymbols: 1263, projectRelationships: 5321}
```

This exists because my first bound was a **60-second wall-clock limit**, and it
*survived the exact mutant it was written for* — loading 1263 symbols'
relationships instead of 100's still finished inside it. A timing threshold is a
property of the load, not of the code; a relationship count is a property of the
code. That is why the number is reported.

Resolution is two-phase for the same reason: `resolveMigrationSymbols` resolves
names, ids and paths to symbols **without reading a relationship**, the cap is
applied, and only then does `loadMigrationContextForSymbols` read the edges of the
already-capped set. One pass instead would have read every relationship of every
component in the cohort to plan 100 of them.

### Truncation, measured per source

| field | meaning |
|---|---|
| `requested` | distinct **components** the request resolved to, before the cap |
| `returned` | entries actually processed |
| `deduplicated` | explicit **names** merged — never negative |
| `capped` | resolved components dropped by the 100-component cap |
| `pathSymbols` | how many processed components came from `paths` |
| `selection` | the deterministic order the cap applied |

The per-source split was not cosmetic. The original arithmetic measured
deduplication against the *resolved* set, so the first cohort request printed
`-212 duplicate` and `returned/requested = 100/0`. `deduplicated` is now measured
against the names it reduces and `capped` against the components it drops.

`selection` is `"first N resolved symbols by project-relative file path, then
symbol name"`. It is deterministic on purpose — the dropped set is a property of
the project layout, not of a query plan — but it is alphabetical, which is why
`.github/workflows/*.yml` comes first. The tool states the rule and reports what
the rule selected rather than quietly applying a heuristic that happens to look
smarter.

## "No route" meant 80% of all requests, and it was the wrong word

A target language with no dictionary rows **for that pair** used to be refused
outright as `unsupported-target`. The detail read:

> no library-equivalence data is registered for typescript → rust; this tool has no
> migration route between them

The first clause is true. The second is not. They were one statement, and the
false half is the one that decides the behaviour.

### How much it was refusing

Measured from the running module — `migrationDictionaryRows()` and
`hasMigrationRoute`, not a regex over the source, because the dictionary literal
contains duplicate source keys and a regex sees both:

| | |
|---|---|
| rows / sources / targets | 486 / 30 / 21 |
| pairs with a route | **126 of 630 (20.0%)** |
| pairs with no route | **504 of 630 (80.0%)** |
| of those, same-language (still correctly refused, as `same-language`) | 20 |

**Four out of five language pairs produced nothing at all** — no dependency order,
no effort model, no scope accounting, no waves. `typescript → rust` has no rows;
`kotlin → rust`, `swift → rust` and `zig → rust` do. A Node-to-Rust port was
refused because of which rows someone happened to write.

### What happens now

- A target language the tool **does not know** is still refused: `brainfuck`,
  `cobol` and `malbolge` all come back `unsupported-target`, naming the target.
- A **known** target with no rows for the pair is **planned**, and the gap is stated
  twice so it cannot be skimmed past:
  - `dependencyProvenance.note` — *"This tool registers no library-equivalence data
    for typescript → haskell, so no mapping can be offered for any library. That is
    **MISSING DATA, not an absence of libraries**."*
  - a **risk factor** — *"no library-equivalence data is registered for
    typescript → haskell, so this plan carries NO library mappings: every library
    will need its target-language equivalent chosen by a human"*.
- `dependencies` stays **empty** for an unrouted pair. That is the guarantee round
  1 bought by refusing, and it is kept: no mapping is ever invented, and
  `inferredDependencies` remains excluded from effort and risk.

A **routed** pair carries neither statement, so the warning still means something
the day it fires.

### How it stayed hidden for six rounds

`script/verify-visualize-migrate.ts` had been RED since round 1, for exactly this
reason — round 1 correctly stopped fabricating library mappings, and the refusal it
replaced was the only thing making that gate's `plans.length >= 1` assertion pass.
I had treated the reddened gate as collateral from removing the fabrication and
moved on. It was not collateral: it was the fabrication's last disguise, and
pointing at a refusal that was throwing away 80% of all requests.

## Scope: how much of the work this request actually covers

An integration point is **in scope** when its other endpoint is one of the
requested symbols. Everything else belongs to a component the caller did not ask
about — and a port that ignores it does not work.

This is not a formality. Measured on cobra, for a request of the top 1, 2, 4, 8
and 16 symbols by fan-in:

| symbols requested | integration points cited | inside the request | outside |
|---|---|---|---|
| 1 | 519 | 1 | **99.8%** |
| 2 | 680 | 3 | **99.6%** |
| 4 | 772 | 5 | **99.4%** |
| 8 | 835 | 5 | **99.4%** |
| 16 | 1017 | 14 | **98.6%** |

A single `bb_migrate` request for the most-connected function in a repository
covers about one in five hundred of its integration points. The tool now says so
on the line directly under the effort total, because a total read without its
qualification is the number most likely to be quoted in a plan and acted on:

```
total effort: 526h (per-plan effort sums to the methodology total)
scope: 0 of 260 integration points (0.0%) are inside this request; 260 belong
to components that were not asked for, so these plans alone are NOT a complete
migration
waves: 1[AddCommand, execute, getCommand]
```

`scope` carries `integrationPoints`, `inScope`, `outOfScope`, `unresolvable`,
`completeness` (the in-scope ratio, or `null` when no edges are indexed at all),
and the `statement` above. The wording follows the number: a request covering
under half its surface is told so, and a request covering nearly all of it is
not.

**This is a property of the request, not a defect in the tool.** Asking about
three functions will always cover a small part of a repository. The point is
that the tool states it rather than printing a confident total and letting the
gap be inferred.

## Waves: where to start

`dependencyOrder` is a total order; a team wants the first batch. `waves` groups
it by dependency depth: **wave 0 is everything with no unresolved in-scope
dependency**, wave 1 becomes startable once wave 0 lands, and so on.

An edge to a symbol *outside* the request is a scope gap, not an ordering
constraint, and does **not** push a wave. Treating it as one would park every
component behind a dependency nobody was asked to migrate.

Derived arithmetic over the same edge set the order uses — no new constants. A
relationship's **source is the dependent** and its target is the dependency, so
`middle` calling `bottom` puts `middle` in a later wave. If the graph is cyclic,
a cycle's members land wherever their other dependencies put them, so read
`orderingStatus` alongside: a cyclic graph does not decompose into waves.

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
- 6 hours per **third-party library** with no registered equivalence

That last constant was structurally zero for the whole life of the tool, and the
reason is worth recording. It was counted from `dependencies`, which was always
empty because the lane believed the index held no imports — so **every plan this
tool ever produced reported zero missing mappings**, including plans for Go
services carrying unported libraries. It is now counted from the measured import
split in `dependencyProvenance.imports.unmappedLibraries`.

Two rules keep the number meaningful:

- **Per library name, not per specifier.** A file importing `gin` and `gin/render`
  declares two specifiers for one library; charging both bills the research twice.
- **Third-party only.** A standard-library name with no row (`fmt`, `bytes`) is
  listed and visible in `stdlibWithoutRow` but is not a library a human must
  research, so it is not charged. Counting it turned a five-import Go file into
  30h of fictitious research.

On cobra the figure is now live: 12h for 2 unmapped libraries, and the per-plan
view carries the same charge — otherwise the two effort views would disagree and
their difference would come out negative, which is round 3's defect reintroduced
through a different door.

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

## The dictionary, and what is actually in it

The equivalence knowledge is a hand-written table: **486 rows** across **30
source languages** and **21 target languages**, covering **126 of the 630
possible source→target pairs (20%)**. It is audited by
`script/m20/verify-migration-dictionary.ts`, which fails if:

- any row cannot be reached by an import in its own source language, unless the
  key is in the declared non-import class below;
- a declared non-import key no longer exists, or has become reachable;
- `hasMigrationRoute` disagrees with the row set for any pair (it is what refuses
  an unroutable target, so a disagreement either refuses data the tool has or
  plans data it lacks);
- a triple is claimed twice, a row maps a language to itself, or a row names an
  empty target.

**56 of 486 rows (11.5%) are in the declared non-import class** — real,
useful knowledge that an import-specifier lookup can never reach. They are kept
and named rather than deleted, and each carries its reason:

| Class | Rows | Why unreachable |
|---|---|---|
| API/idiom (`pool.query`, `Date.now`, `jest.fn`, …) | 5 | a file *calls* these; it never imports them. Needs call-expression detection. |
| Framework (`asp.net`) | 1 | a framework, not an import. Needs manifest-level detection. |
| Flutter widget/type names (`Container`, `Scaffold`, `Text`, …) | 16 | Dart imports `flutter`, not a widget class |
| Display names with a space (`react context`, `redux toolkit`, …) | 6 | no import specifier contains a space |
| Dart library paths (`flutter/material`) | 1 | collides with the reachable `flutter` package row |
| Mis-keyed `dart → typescript` block (`axios`, `prisma`, `zod`, …) | 9 | a Dart file cannot import an npm package; the same mapping is already reachable from the TypeScript side |

Only **2 keys** remain that canonicalization itself makes unreachable:
`flutter/material` and `shadcn/ui`. Both are the compound-name cases above.

**What the audit cannot do:** verify that a reachable mapping is *correct*.
`express → fastapi` is a claim, and a wrong claim is perfectly reachable. The
audit proves the table is internally consistent and that its rows can fire; it
does not make the advice true.

## Known limits

- **Planning is bounded to 100 components per request.** `paths` does not lift the
  cap; it makes hitting it likely. `truncation` names what was dropped and
  `selection` states the rule.
- **The cap's rule is alphabetical.** A repository-root cohort on cobra plans
  nothing, because the first 100 components by file path are YAML. Reported, not
  worked around — a heuristic that quietly prefers "migratable" sources would hide
  the fact that a third of the repository is not code.
- **Two components sharing a name are planned separately only when reached by
  `paths` or `symbolIds`.** A bare `symbolNames` entry for such a name is refused,
  with the candidate ids, because a name genuinely does not identify a component.


- Plans are estimates. The tool does not generate, replace, or compile
  target-language source.
- Library mappings are advisory equivalence guidance, not proof of semantic
  compatibility.
- **Dictionary coverage is the binding limit on mapping quality.** Imports are read
  from the index and canonicalization reaches the rows, but most real libraries have
  no row — 0 of cobra's 5 Go dependencies are keys. Each unmapped third-party
  library is named at confidence 0 and charged 6h of research; none is ever
  `supported`. See `imports.unmappedLibraries`.
- **Go canonicalization falls back to a guess for undeclared hosts.** The name may
  be a package rather than a library, so a row keyed by the real repository is not
  reached. Counted and named in `imports.fallbackHostNames`.
- **TypeScript import coverage is 0%** over the 22 indexed files measured — a
  separate analyzer gap, declared rather than averaged away.
- **Python has no stdlib classification here**, so its split is `unclassified`
  rather than a guess. `os` and `json` are not listed as dependencies.
- Ordering and mapping depend on the analyzer-extracted graph. Reflection,
  dynamic dispatch, and cross-file relations the grammar does not model limit
  completeness.
- A cross-language flag exists on 118 of cobra's 5228 edges; where the indexer did
  not mark an edge cross-language, the plan does not claim it is.

```json
{"symbolNames":["authenticate","authorize"],"targetLanguage":"go","format":"json"}
```
