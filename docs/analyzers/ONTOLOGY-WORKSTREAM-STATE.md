# Laptop-B supervision state

Aggregate branch: `analyzers/ontology-laptop-b`
Main checkout:   `$HOME/mcp/backbencher-brain`
Lane worktrees:  `$HOME/mcp/bb-lanes/<slug>`  (one per language, node_modules symlinked)
Corpus:          `$HOME/fixtures/repositories` (~6.1 GB, ~90 repos)
Shared contract: `docs/analyzers/ONTOLOGY-WORKSTREAM.md` (committed on the aggregate)

## Scripts

| Script | Purpose |
|---|---|
| `/tmp/opencode/setup-lanes.sh` | creates the 23 per-language worktrees + branches |
| `/tmp/opencode/launch-agent.sh <slug> <TITLE> <analyzer-stem> <BRANCH> "<missing types>"` | launches one co-agent in its own worktree |
| `/tmp/opencode/status.sh` | status board: alive / log age / signal / commits per lane |
| `/tmp/opencode/reprompt.sh <slug> [model] [message]` | re-prompt an agent that stopped to ask, or whose run was cut |
| `/tmp/opencode/merge-lane.sh <BRANCH>` | review-gate then merge one lane into the aggregate |
| `/tmp/opencode/AGENT-TEMPLATE.md` | the task template agents are launched with |

## Model — read this before relaunching anything

The task spec names `openrouter/stealth/space-bunny-alpha`. That provider's
**daily free quota is exhausted**; every agent died on
`Error: Rate limit exceeded: free-models-per-day-stealth` within a 90-second
window on 2026-10-02 ~21:50. All agent work was preserved on disk, uncommitted,
because of the per-lane worktrees — which is the argument for the worktrees.

Use **`opencode/space-bunny-free`** instead. It is a different provider
(OpenCode Zen, not OpenRouter) and is not quota-blocked. Verified working
before the relaunch.

Free models on Zen, as alternates: `opencode/big-pickle`,
`opencode/longcat-2.5-preview-free`, `opencode/mimo-v2.6-flash-free`,
`opencode/ling-3.1-flash-free`, `opencode/nemotron-3-ultra-free`.

Models that are NOT usable from this box, so do not spend time on them again:
`pollinations/*` (no credits on the account), `explabs/*` (organization balance
negative), `zenmux/moonshotai/kimi-k3-free` (model not valid),
`tokenrouter/*` (token has no access), `agentrouter/glm-5.2` (no channel),
`kimi/kimi-k3` (public API access forbidden), `nvidia/z-ai/glm-5.2` (server
error).

## Why per-lane worktrees

The first launch put all 7 agents in the main checkout. They immediately began
`git checkout analyzer/<LANG>` on a shared working tree and stomped each other —
`git branch --show-current` read `analyzer/ZIG` while the ZIG slot was one of
seven. That was a design error on the supervisor's part, not agent behaviour.
Fixed by giving every lane its own `git worktree`. Agents are now launched with
`--dir <their worktree>` and the template forbids checking out other branches.

## Queue — laptop B's 23 languages

Ordered heaviest-first. 7 slots, never more.

| slot | lang | analyzer | branch | handover gaps |
|---|---|---|---|---|
| 1 | Bash | real-bash-analyzer | analyzer/BASH | extends, implements, instantiates |
| 2 | F# | real-fsharp-analyzer | analyzer/F_SHARP | exports, imports, uses |
| 3 | Zig | real-zig-analyzer | analyzer/ZIG | extends, implements, overrides |
| 4 | Lua | real-lua-analyzer | analyzer/LUA | exports, implements, overrides, references, uses |
| 5 | Julia | real-julia-analyzer | analyzer/JULIA | exports, implements, imports, instantiates, overrides |
| 6 | Nim | real-nim-analyzer | analyzer/NIM | exports, implements |
| 7 | PHP | real-php-analyzer | analyzer/PHP | exports |
| 8 | PowerShell | real-powershell-analyzer | analyzer/POWERSHELL | imports |
| 9 | R | real-r-analyzer | analyzer/R | uses |
| 10 | Dart | real-dart-analyzer | analyzer/DART | references |
| 11 | SQL | real-sql-analyzer | analyzer/SQL | exports, extends, implements, imports, instantiates, overrides |
| 12 | GraphQL | real-graphql-analyzer | analyzer/GRAPHQL | calls, exports, extends, imports, instantiates, overrides, references |
| 13 | Protobuf | real-protobuf-analyzer | analyzer/PROTOBUF | calls, exports, extends, implements, imports, instantiates, overrides, references |
| 14 | JSON | real-json-analyzer | analyzer/JSON | calls, implements, instantiates, overrides |
| 15 | YAML | real-yaml-analyzer | analyzer/YAML | calls, implements, instantiates, overrides |
| 16 | CSS | real-css-analyzer | analyzer/CSS | calls, exports, extends, implements, instantiates, overrides |
| 17 | SCSS | real-scss-analyzer | analyzer/SCSS | calls, exports, extends, implements, instantiates, overrides |
| 18 | HCL | real-hcl-analyzer | analyzer/HCL | calls, extends, implements, instantiates, overrides |
| 19 | Make | real-makefile-analyzer | analyzer/MAKE | extends, implements, instantiates, overrides |
| 20 | TOML | real-toml-analyzer | analyzer/TOML | calls, exports, extends, implements, imports, instantiates, overrides, references, uses |
| 21 | XML | real-xml-analyzer | analyzer/XML | calls, exports, extends, implements, instantiates, overrides, uses |
| 22 | Markdown | real-markdown-analyzer | analyzer/MARKDOWN | calls, exports, extends, implements, imports, instantiates, overrides, references |
| 23 | Clean | real-clean-analyzer | analyzer/CLEAN | extends, overrides |

Slots 14–23 are expected to be mostly RULED. For those the deliverable is the
corpus measurement that makes the ruling defensible, not new edges.

## Corpus counts at handover

Measured after cloning. Nim had 0 files and GraphQL had 2; both were unusable.

| lang | files | lang | files |
|---|---|---|---|
| dart | 31397 | hcl | 557 |
| yaml | 11297 | scss | 492 |
| json | 10719 | css | 667 |
| markdown | 10412 | sql | 1025 |
| fsharp | 5476 | xml | 1292 |
| php | 4609 | toml | 1086 |
| nim | 3970 | graphql | 192 |
| zig | 3040 | clean | 164 |
| lua | 2421 | ps1 | 893 |
| julia | 975 | R | 739 |
| sh | 1444 | proto | 324 |
| make | 437 | | |

Added to the corpus for this programme: `nim`, `graphql-nim`, `graphql-java`,
`graphql-js-full`, `shopify-api-js`, `vega`, `yq`, `redis`, `sqlalchemy`,
`dbeaver`, `duckdb`, `dart-sdk`, `riverpod`, `flutter-packages`,
`nvim-lspconfig`, `rocks.nvim`, `kong`, `caddy`, `traefik`, `ggplot2`,
`usethis`, `PSScriptAnalyzer`, `apollo-server`, `redwood`, `wagtail`,
`hasura-engine`.

## Baseline measured before launch

`npx tsx script/m14/ontology-coverage-gate.ts bash` on the aggregate:

```
calls         EMITTED      40,172 edges
uses          EMITTED      58,969 edges
contains      EMITTED      27,156 edges
imports       EMITTED         534 edges
references    EMITTED         534 edges
exports       EMITTED       1,180 edges
extends       RULED-SOUND   grammar produced 164 node types, none expresses it
implements    RULED-SOUND   same ruling
overrides     EMITTED         121 edges
instantiates  RULED-SOUND   same ruling
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
```

Bash was the most advanced lane at handover. The gate also emitted
`[BB-HANG] parser stuck 120s` on `proxicall/functions/scripts/audit_money_domain.sh`
and `[BB-PARSE-ERR] ... memory access out of bounds` on the same file — a
parser-robustness finding outside any single lane, filed for the owner.

## Shared files the supervisor owns

Agents report a need; the supervisor makes the change.

- `script/m14/differential.ts`, `script/m14/mutate-analyzer.ts`, shared `script/m14/` machinery
- `validation/m14/differential-baseline.json`, `validation/m14/results/*.json`
- `validation/m60/ledger.json`, `validation/m60/results/rel-type-coverage*.json`
- `script/m14/ontology-coverage-gate.ts`, `script/m60/rel-type-coverage-gate.ts`
- `src/ast/types.ts`, `src/ast/engine.ts`
- `website/src/data/brain-languages.ts` — derived, regenerated, never hand-edited
- `package.json`

## Review checklist applied to every finished lane

Reject and re-run anything that is prose instead of evidence.

1. A number for every verdict, or the verdict is not accepted.
2. Read the diff: did it add an edge the language cannot express?
3. Do the fixtures actually assert the new behaviour (not just exist)?
4. Does the lane's ontology gate still report the same ruled/emitted shape?
5. Does the lane still pass mutation testing?
6. Are the measurements reproducible from a clean corpus?
7. Did it touch only files it owns? (`git diff --name-only` vs the owned set)
8. Does the commit message carry the measurement, not an adjective?
## Lane log

### BASH — merged as `78f465fdc`

Verdict: **accept**. One real defect class fixed, measured in both directions.

- **Fabricated edges removed.** 200 hash-ordered corpus files / 2,945 `calls`
  edges: 30 edges (1.02%) carried a POSIX reserved word — `fi`, `then`, `elif`,
  `esac`, `do`, `done` — as their call target. The grammar reads a keyword as a
  `command_name` on recovery, and the analyzer emitted an edge to it. Zero of the
  30 is a command any script could run (`./fi` is a command, and its name is
  `./fi`). After the fix: 400 files / 5,232 `calls` edges, 0 remain.
- **A guard was measured and REJECTED**, not chosen: the damage-region guard
  removes 108 edges but deletes real calls, dominated by `::log::status` (15).
  Recorded in `guard-ab-bash-calls.ts` so the next agent does not re-derive it.
- **Dead code removed.** `dirnameOf` existed only to feed `normalizeRelative`,
  the relative-`source` resolver BD9 reversed. Its doc comment still described
  the reversed behaviour, so the file asserted two contradictory things about
  one construct.
- 13 files, +2,247 / −155. Ownership clean. Banned vocabulary: none in the files
  the real gate scans.

**Gate note — read before blaming a lane for this.** `script/m14/verify-honesty.ts`
reports **23 failures on the pristine aggregate too**. All are evidence-freshness
(`M14.0.F1`–`F9` declared inputs changed since the commit each artifact names) plus
`freshness rule flags every artifact — it cannot distinguish current from stale`.
This is pre-existing and NOT introduced by any lane here. It is a shared-machinery
defect: the evidence artifacts predate the commits they name, and the freshness
rule cannot tell a stale artifact from a current one. Supervisor-owned; filed for
the owner.

### NIM — merged

Verdict: **accept**. The `implements` handling is the model for a GAP verdict
that does not become a fabrication.

- `implements` reported as **0 edges**, and the reason is a measurement, not a
  shrug: 216 `concept_declaration`s on the corpus and 0 refinements of a
  different concept. The construct is real (`nim/compiler/parser.nim:2268`,
  `doc/manual_experimental.md:1205`), so the GAP was closed in code and reported
  as corpus-silent rather than as emitted.
- Both spellings implemented per the manual: `concept x of B` off the grammar's
  `refines` field, and `x is B` in a body behind 3 guards. Of 125 corpus `is`
  expressions, **120 name a builtin or a generic parameter**, so the guard drops
  them rather than fabricating `implements -> int`.
- Two on-disk defects found and fixed: `childForFieldName("refines")` returned
  the refinement list *itself*, so both readers looked for a child of that type
  and the whole family silently read 0 while symbols stayed `interface`; and the
  `except` clause read as publication — the inverse of the construct.
- **Supervisor re-ran the mutant suite: 9/9 caught, 0 survived.** One mutant is
  named `concept-satisfaction-invented` — a deliberate guard against the exact
  fabrication failure this contract calls most expensive.
- 10 files, +2,491 / −110.

### ZIG — merged

Verdict: **accept**. Strongest lane so far on measurement discipline.

- **10/10 verdicts over the whole admitted corpus** (3,834 of 3,834 files, draw
  `sha256:2f3545f9`): 127,536 symbols, 392,086 relationships, 0 empty names.
- `extends`/`implements` RULED by **instrument A**: 0 of 28 inheritance words
  appear in the wasm grammar's own `Language.types` (239 entries) or
  `Language.fields` (16). Overturn condition stated: any UNCLASSIFIED header-slot
  child, or any of the 28 words present in either table.
- `overrides` RULED by **instrument B**, with the calibration shown (11/11 keyword
  calibration).
- **Z59 fixed**: 11,332 of 224,599 `calls`+`uses`+`instantiates` edges (5.05%)
  named a member of a local or anonymous container the analyzer publishes nothing
  for. After the fix **1 dangling source in 249,983 edges (0.0004%)**,
  re-measured by the supervisor from the committed artifact.
- **Two shared-machinery defects REPORTED, not edited**, which is the correct
  §8 behaviour: 168 zig declarations lost to the pool-worker name denylist
  (Self 97, unknown 28, root 24) across 130 files; and `parseFile`'s parse-error
  branch returning a regex fallback whose symbols carry no `kind` — 192 empty-kind
  symbols per full run, 7 regex `calls` edges, one with a fabricated
  `source: "this"`. The agent established these are NOT caused by its own change
  by measuring an identical 400-file draw on both sides (0/0 vs 192/7).
- Its censuses carry **positive and negative controls**, so they cannot be
  trivially true. Re-run by the supervisor: controls pass.
- DERIVATION findings: **0**. Gates: fixtures 8/8, mutations 50/50 caught.

### F_SHARP — merged

Verdict: **accept**. 9/10 EMITTED, `exports` RULED by instrument A.

- `uses` 1,666/157 files and `imports` 705/158 were GAPs at handover, implemented
  with confidence 1.0. **Constructs were measured before implementation**:
  29,441 `attribute` nodes across 2,492 files, 11,371 `import_decl` across 2,540.
- `exports` RULED: 353 distinct node types across 6,619 files and **none** of the
  six export-declaration node types appears. F# has no export *declaration*. The
  adjacency count (7,818 member-declaring scopes in 3,630 files) is what
  `contains` already carries at 100.0% resolution. Overturn condition stated.
- The agent **convicted its own earlier doc row** for denying emission without
  saying so — `verify-doc-truth-emissions.ts` flagged it as a FALSE_NEGATIVE and
  the agent corrected the row rather than the gate.
- `docs/DOC-TRUTH-EMISSIONS.md` is machine-generated; supervisor re-ran
  `audit:doc-truth-emissions` and confirmed the committed bytes reproduce.

### LUA — merged

Verdict: **accept**. The most edges added of any lane, and the payload cost was
declared rather than discovered later.

- Production `parseFile` over 3,250 corpus files from 120 repos:
  `uses` **0 → 133,189**/2,666 files, `references` **0 → 44,755**/2,340,
  `exports` **0 → 5,167**/2,137, `overrides` **0 → 66**/38.
  Four of the five types believed missing at handover were measured PRESENT.
- `exports` is the notable one: 5,173 export **names** were already published as a
  list, but no edge said so, so `bb_graph` could not answer "what does this module
  export".
- `implements` RULED by instrument A: 100 node types across 1,875 files, none of
  the six inheritance node types.
- `overrides` needs instrument B by construction — the grammar has no
  `override_specifier` and no redefinition node, so instrument A is silent *by
  construction* and only a tree count could falsify it. Correct choice, stated.
- **Payload 119,606 → 302,783 edges (2.53×)**, declared in the commit. Of that
  total, 6 edges and 7 symbols come from pool-worker's regex fallback, which the
  agent demonstrated is **nondeterministic** — 7 files/9 symbols in one run, 6/8
  in the next, unchanged code, unchanged corpus — and tallied apart so none is
  attributed to this lane.
- Supervisor re-ran the lane suite: **9 fixtures / 96 assertions / 0 failing**.

### PHP — merged

Verdict: **accept**. The strongest A/B discipline of any lane.

- `contains` gained a namespace level. The lane emitted 4,442 `namespace` symbols
  and joined **none** of them, so every `contains` edge came from a member's
  `ownerName` and a top-level declaration had no owner. The agent justified this
  as convention, not taste: csharp sets `ownerName`/`ownerKind: Namespace` for a
  top-level type, and typescript does the same via `ScopeKind.Namespace`.
- The cause was two namespace forms spelled differently. `namespace A { }` nests
  declarations inside a `compound_statement`; `namespace A;` leaves them as
  siblings at program level. **The semicolon form is the common one, so the
  branch that worked was the rare one** — which is why it survived a reading.
- Behind it, a second defect: `qualifiedName` is derived from `metadata.fqn`,
  built from the same `ns`, so every declaration under the semicolon form carried
  the LEAF as its qualified name (`A` instead of `App\One\A`).
- **A/B over the same 4,621 files at matched worker count, whole corpus, no
  sampling**: `contains` 25,592 → 30,315, and **every other label exactly
  unchanged** (+0 on eight labels). TOTAL(9) +1.57%. No budget re-baselined.
- The agent **caught a regression its own change made reachable**:
  `emitInclude`'s owner was `ns || "global"`, which is wrong for the semicolon
  form, and an existing fixture (`php/include-paths`) caught it on 6 edges.
- `exports` RULED by instrument B. `overrides` EMITTED at 2 edges, both in test
  fixtures — a number small enough to be worth stating plainly.

### R — merged

Verdict: **accept**. This lane overturned its own prior ruling, which is the case
the ontology gate exists for.

- The handover note ruled `uses` inapplicable on a **prose argument about import
  bindings**. That argument does not reach a member read: `self$value` inside an
  R6 method depends on nothing, and no edge of any kind carried it. Instrument B
  over 1,890 files found 14,307 `extract_operator` nodes and 547 string-indexed
  `[[` subscripts that are not a call's callee — **all 14,854 produced nothing**.
  The prior verdict was RULED-UNJUSTIFIED, and the agent said so rather than
  quietly shipping the edges.
- `overrides` (13 edges / 2 files) and `instantiates` (1 edge) were also believed
  missing: implemented, did not fire, because the corpus had none of the
  constructs. The agent **widened the corpus from 4 repos / 637 files to 13 /
  1,890** rather than ruling on a thin corpus, and rejected 1 duplicate commit.
- `uses` 0 → 3,823; TOTAL 65,602 relationships / 22,479 symbols / **0 empty names
  / 0 unknown kinds**; 0 edges below 0.7; 95.15% at 1.0.
- **A/B over 2,027 files diffed PER LABEL**: 0 files differ on any type except
  `uses`. `corpus-percount.ts` is committed so the A/B is a diff, not an assurance.
- 15 declared limitations, each with its number.
- Shared machinery reported, not touched: `keepSymbol`'s UNIVERSAL denylist holds
  the node-type name `source_file`, which is **also an ordinary R function**
  (`r-testthat/R/source.R:18`) — 12 symbols deleted across 9 files; and
  `differential.ts` has no `LANGS.r`, so all of R's types are DERIVATION findings.

## Provider outages — do not misdiagnose these as agent failure

Three times, all 7–8 lanes died within a minute of each other while doing real
work, and the work was intact on disk each time because of the per-lane
worktrees. Different causes; none was an agent stopping to ask.

| when | symptom | actual cause | fix |
|---|---|---|---|
| 2026-10-02 ~21:50 | `Rate limit exceeded: free-models-per-day-stealth` | `openrouter/stealth/space-bunny-alpha` daily free quota exhausted | switched to `opencode/space-bunny-free` |
| 2026-10-03 ~00:20 | `Error from provider (Console): OpenCode's free tier can only be used from within OpenCode` | billing on the selected model | owner fixed billing |
| 2026-10-03 | agents wedged in a wait loop, log quiet ~17 min | agent's own `pgrep -f powershell/census` matched **the polling shell itself**, so the loop never exited | supervisor killed the loop, re-prompted |

Two supervisor-side lessons, both now fixed in the tooling:

- **`pgrep -f` is not scoped.** Any agent that polls for "is my census still
  running" will match its own polling command. An agent waiting on a completed
  job looks exactly like a working one.
- **The ASKING detector read its own re-prompt banner.** `reprompt.sh` appends a
  banner quoting phrases like "do not ask permission", so every re-prompted lane
  reported ASKING forever. `status.sh` now inspects only the text after the last
  banner.

### Supplied by the owner

Use `opencode/space-bunny-free`. The provider is working and billing is settled.

## WAVE 1 COMPLETE — 23/23 merged

Aggregate `analyzers/ontology-laptop-b`, 54 commits, 250 files changed. Every
language's ontology verdicts are landed and reviewed by the supervisor, who
re-ran the agents' own instruments rather than reading their reports.

| lane | headline | notes |
|---|---|---|
| BASH | 30 fabricated `calls` edges removed | reserved words read as command names |
| NIM | `implements` closed as corpus-silent | 216 concepts, 0 refinements of a different concept |
| ZIG | 10/10 verdicts, Z59 fixed | 11,332 dangling sources -> 1 in 249,983 edges |
| F_SHARP | 9/10 EMITTED, `exports` RULED | convicted its own doc row |
| LUA | 4 of 5 missing types measured PRESENT | declared its own 2.53x payload |
| JULIA | `overrides` EMITTED after overturning a "declined" ruling | 63 -> 17 -> 4 -> 3 as fabrications removed |
| PHP | namespace `contains` GAP | every other label exactly +0 in the A/B |
| R | **overturned its own prose ruling** | 14,854 constructs produced nothing; corpus widened 3x |
| SQL | 7/10 EMITTED, 3 RULED | its own oracle caught a CTE fabrication |
| POWERSHELL | `imports` was a mislabel, not a gap | all 4 forms already read, published as `references` |
| GRAPHQL | 4th verdict state: neither emitted nor ruled | construct occurs, per-file analyzer cannot reach it |
| CSS | `overrides` added; `imports` reported at 0% resolution | corrected its own instrument (1 -> 4) |
| PROTOBUF | a suite that can now fail | 8 own survivors found; "0 of 1,481 mutants were ours" |
| JSON | 8/10 EMITTED | its oracle emitted first-doc edges twice, invisibly |
| YAML | 3 GAPs; removed code measured at 0 occurrences | corrected a false "15 mutants caught" doc claim |
| SCSS | `exports` + `overrides`; 3 GAPs reported not patched | named the structural cause precisely |
| HCL | `overrides` retyped from `references`, cost 0 edges | 68 override blocks in `.tftest.hcl` |
| TOML | 1 EMITTED, 9 RULED | declined cargo's `workspace = true`: a tool rule, not TOML's |
| XML | 2 GAPs; overturned its own "category error" ruling | XSD 1.0 s3.4.2 |
| DART | **10/10 EMITTED**, 5,265 `references` added | type-variable gate never fired for a bounded generic |
| CLEAN | wave 2 | |

### Shared-machinery defects found by lanes, fixed by the supervisor

| fix | found by | defect |
|---|---|---|
| `cf6cabece` | POWERSHELL, and independently PROTOBUF | `meta.<key>: null` asserted nothing — 16 expectation rows across 6 lanes could not fail |
| `760f0c501` | PROTOBUF | array comparison order-SENSITIVE for object elements (`sort()` with no comparator is a no-op) |
| `e787473c8` | PROTOBUF, and independently YAML | css/nim/protobuf mutants existed but were never imported — 71 mutants never ran |
| `b952a9a9c` | JSON | json's 15 mutants likewise never ran |
| `79e3a9d85` | JULIA | `completeness-inventory.ts` named a doc the lane deleted |

### Standing defects found and NOT fixed — for the owner

- `script/m14/run-fixtures.ts` **exits 0 without executing any fixture**, because
  its lane gate refuses `r` and `lua` for having expectation files with no runner
  lane in `LANGS`. 10 expectation files are evidence nothing executes.
- `script/m14/mutate-analyzer.ts` reports **9 surviving mutants**: java 1, groovy 2,
  scala 1, make 1, html 3 (other laptop) and
  `php/drop-external-override-guess` at 0 -> 0 failures, which means the php lane
  has no fixture that fails when the behaviour is removed.
- `ontology-coverage-gate.ts` `RULED_BY_LANG` has no entry for yaml, r, lua,
  graphql, protobuf, json, css, scss, sql, php, hcl, dart — it exits 2 rather than
  rule, so those lanes have no arbiter.
- `differential.ts` has no `LANGS` entry for `r` and `lua`, so every type those
  analyzers emit is a DERIVATION finding.
- `pool-worker.ts`'s `UNIVERSAL` denylist holds the tree-sitter node-type name
  `source_file`, which is also an ordinary R function: 12 symbols deleted across
  9 files. Same class drops `Query.me` in graphql (1 of 8,796).
- `pool-worker.ts`'s parse-error branch returns a regex fallback whose symbols
  carry no `kind`: 192 empty-SymbolKind symbols per full zig run.
- `filterNoiseRelationships` splits a target on `:` for Objective-C selector
  arity, so 1 legal TOML edge in 19,088 is dropped.
- `verify-honesty.ts` reports 23 failures on the PRISTINE aggregate (evidence
  staleness, M14.0.F1-F9).

## WAVE 2 — verification passes

All 23 lanes merged, so wave 2 is the other half of the job: the six questions
adversarially, DERIVATION debt as a number, and re-running pass 1's own probes to
check a ruling that may be wrong the way R's, JULIA's and YAML's were. Launched
from the aggregate tip so every lane sees the merged work.

Slots: `clean` (first pass, never run) + `bash fsharp zig css markdown powershell`
(pass 2).

### Wave-2 incident: SQLite write collision across lanes

The bash lane died on `Error: Failed to execute statement` with 52 GB free, so it
was not disk. Seven lanes run concurrently and two can resolve the same
`.bb-data` DB path; the loser gets a write-lock failure from its own census
script.

Consequence for the tooling: **a lane's census should use a lane-private DB path**
(e.g. under `/tmp/opencode/<lang>/`), not the repo-relative `.bb-data`. The
supervisor's re-prompt says so explicitly rather than letting the next lane rediscover it.

Note also that `grep -o 'Error'` on these logs is a useless liveness signal — the
logs are full of parser diagnostics (`Out of bounds`, `WASM`, `ErrorNodes`) that
are corpus findings, not agent failures. Liveness is the process, and a lane's
report is its final message.

## WAVE 2 — the two findings that outrank any single lane

### 1. `parseFile` is not deterministic, so per-lane numbers are run-dependent

The zig lane re-ran its census on a **byte-identical draw**
(`sha256:2f3545f9`, 3,834 files) and got different numbers than pass 1:

| | pass 1 | pass 2 |
|---|---|---|
| symbols | 127,536 | 127,429 |
| relationships | 392,086 | 392,550 |
| kindless symbols | 0 | 192 |

The draw is the same, so the difference is the run. `parseFile` carries cumulative
WASM state: one process over the draw printed `[BB-PARSE-ERR] memory access out
of bounds` on 2–3 files and self-destructed with `[BB-HANG]` on **3 different
files across 3 runs** (`assembly.zig` parses in 2.98 s alone). The catch silently
substitutes the regex `extractFallback`, whose symbols carry **no kind** — which
is where the 192 come from.

Sharded across 8 workers, every shard read 0 and 0.

**Consequence for this whole workstream:** any figure quoted from a single
long-running process is a figure about that run, not about the corpus. Several
lanes already noticed pieces of this independently — dart, powershell, protobuf,
xml and zig all reported `[BB-HANG]` or parse-fallback noise — but zig is the
first to state it as a property of the entry point and to withdraw a claim level
over it.

Two gates are needed and neither exists yet: a **sharded** census as the default
(so WASM state does not accumulate), and a **byte-identical-draw, two-run**
comparison as a standard check. Until then, per-lane relationship counts in this
workstream should be read as single-run observations.

### 2. A resolution RATE cannot detect a name collision

zig's census reports `calls src dangling 0.00%`, and 0.49% of named `calls`
sources are not callable at all. All 759 of them are a **named test colliding
with a declaration in the same file**. The census resolves by NAME, so the
collision resolves and the rate reads clean.

This is the sixth question ("Resolved") failing in a way the fifth question
cannot see, and it generalises: any lane whose resolution is name-based will
report 100% on a graph where a name denotes two symbols. CSS `references` at
66.8% both ends and `implements` at 43.6% intra-file in the clean lane are the
related shape — a rate that is neither 100% nor 0 is a rate that hides a
population, and reporting only the rate loses it.

### L5 withdrawn

zig was the only lane claiming L5. It withdrew it: the doc's claim table is now
machine-graded by `verify-doc-truth-emissions` (9 of 10 rows, 0 findings), the F8
section-b failure is recorded rather than papered over, and DERIVATION=0 is
annotated with what it is worth — `zig-truth.ts` mirrors the analyzer's own rules,
so the four wrong-edge classes above score as *agreement*.

## WAVE 2 RESULTS — 7 lanes reviewed

| lane | found | the part worth reading |
|---|---|---|
| ZIG | 4 wrong-edge classes, **L5 withdrawn** | its own census re-run on a byte-identical draw gave different numbers; `parseFile` is not deterministic |
| BASH | 2 more fabricated `calls` edges | grammar misparses `$(( ))` in 2 shapes; guard stops at the first `$(` so `v=$(( $(wc -l < f) + 1 ))` keeps its real call |
| POWERSHELL | 4 defects, 3 invisible to the census | `Export-ModuleMember -Function Measure*` published a wildcard as a symbol name; removing those edges RAISED the resolution rate |
| CSS | 2 defects + a **vacuous pass-1 probe** | pass 1 read `symbol.range.start.line`, but `parseFile` returns no `range` — so 0 violations was also what a broken probe returns |
| F_SHARP | 3 defects + **a latency claim withdrawn** | its +16% A/B was machine load; interleaved, the ranges overlap almost completely |
| CLEAN | `overrides` was a GAP | Clean has no `override` KEYWORD — it has typeclasses, so every keyword probe was blind |
| LUA/MARKDOWN/TOML/SQL | in flight | |

### Three patterns worth carrying to any future agent

1. **Removing edges that RAISED a resolution rate** is the signature of having
   removed edges that named nothing. Found independently in powershell (exports
   113 -> 106, corpusBoth 95.13% -> 98.11%) and used as a check in zig.
2. **A probe that cannot fail returns the same number as a clean one.** CSS's
   pass-1 containment check read 0 violations for 18 months' worth of reasons,
   one of which was that the probe was broken. Every probe needs a POSITIVE
   control that must fire, or its zero means nothing.
3. **A latency figure from a shared box is a statement about load.** F#'s +16%
   became "inside the run-to-run spread" once measured interleaved. Seven lanes
   share this machine.

### Ruling tables — the arbiter covers 2 of 23 lanes

`ontology-coverage-gate.ts` can rule for `bash` and `json` only. The other 21 exit
2 with no verdict, so those lanes' RULED verdicts have never been checked by the
arbiter at all — the same blind spot the gate exists to catch, wearing a
different hat.

`--coverage` now reports this instead of leaving it to be discovered one exit-2 at
a time. The tables are deliberately NOT written centrally: a ruling table encodes
one lane's own node types and corpus counts, so the lane that measured it writes
it, as `script/m14/<lang>-ruled.ts`, and the supervisor adds the import and map
entry. A centrally-authored table would be a ruling with nobody behind it.

## The noise-filter class — three lanes, one root cause

`pool-worker.ts`'s `filterNoiseRelationships` deletes edges on their way to the
index. Each rule was added to fix a real fabrication, and each has since deleted
legal edges in a language the rule was not written for:

| lane | rule | what it deletes | cost |
|---|---|---|---|
| objc | `split(":")` for selector arity | every message-send target — a selector ends in `:` | 12 of 30 M12 false negatives |
| bash | brace ban | every `${var}`-built source path | 21 of 23 import edges (23 emitted, 2 delivered) |
| css | "keep `contains` only" | `var(--x)` and `animation:` references | 2,170 edges, 1,437 resolving at both ends |
| **markdown** | identifier rules applied to a heading's **PROSE** | 1,765 of 40,794 edges (**4.33%**) — `leaf-brace-angle-backtick` 1,127, `leaf-starts-with-space` 480 | never reached the index |
| toml | `:` split (same as objc) | 1 legal TOML edge in 19,088 | reported by the toml lane |
| yaml | target containing `{` | every edge whose target was `'@{…}'` | the whole gap between `imports[]` 552 and `imports` 550 |

The markdown case is the sharpest instance of the shape. Its targets are HEADINGS,
which are prose by definition. `1. Setting up the File scalar` is a numbered-list
heading — its leaf starts with a space, so `leaf.startsWith(" ")` deleted it. A
heading containing `` `code` `` or `<span>` died on the brace/angle rule.

**The structural problem:** the filter is a universal identifier sanitizer applied
to targets that are not identifiers. It already carries per-language escape
hatches — `json`, `yaml`, `hcl`, `terraform`, `graphql` bypass entirely; `bash`
bypasses for path-shaped labels; CSS has an explicit no-type-filter branch with a
measurement behind it. Markdown, and to a lesser degree toml and yaml, have
neither.

**What a fix looks like, and why it is not the supervisor's to make:** the right
shape is the CSS branch — no type-based filter for a language whose targets are not
identifiers, with the fabrication class it would then admit pinned by an explicit
`forbidRelationships` row instead. Choosing which languages are exempt, and
admitting which fabrications in exchange, is a decision about what the graph is
allowed to contain. It belongs to the owner. Recorded here with the measurements.

## THE COVERAGE CORRECTION — source derivation is not evidence

A previous programme reported "14 lanes at 10/10" for a week. That number came from
**source derivation**: counting which `RelationshipType` symbols appear in an
analyzer's source. It answers only *"is this type constructible"*. It does not
answer *"does it fire"*.

`script/m14/firing-check.ts` now answers the second question. It drives the
**production** entry point (`parseFile`, not `analyze()`) and reports per type:
edges, files, whether the SOURCE is a symbol the run published or something
external, and how many resolve at both ends. It also counts `fallback: true` per
file and **refuses to publish a count from a degraded run** — a degraded parse
returns fewer edges with no error, so its count is about the fallback, not the
analyzer.

The sharpest instance of the gap is in this repo, from the markdown lane:
`emitInlineUses` resolved a heading's own inline with a **direct-child** lookup,
but the two heading forms hold their text differently —
`atx_heading > atx_hN_marker > inline` versus `setext_heading > paragraph > inline`
— so it returned early for **every setext heading in the language**. The source says
the type is emitted. It was not.

### Coverage is reported as APPLICABLE, never as a flat 10

| | meaning |
|---|---|
| **Complete** | `N/N` — the lane emits every type the language has, and the rest are measured-absent |
| **Incomplete** | `3/4`, `2/10` — a real shortfall, reported as one |

TOML emits 1 and has 9 measured-absent. That makes it **complete at 1/1**, not
broken at 1/10. Reporting `1/10` misrepresents finished work as broken work.

Two binding conditions:
1. The denominator may shrink **only** via a RULED verdict carrying a corpus
   measurement. Prose does not shrink it.
2. Numerator and denominator must come from **different sources** — numerator from
   what measurably fires, denominator from measured non-applicability. An agent
   supplying both is grading its own homework.

### A pin is not a rule

SQL pass 1 fixed a CTE-scope bug and pinned **one** of its four entry points. The
fixture was green and certified the entry point, not the rule. Pass 2 found three
more, each only after its own measurement. A fixture that pins one path into a
multi-path rule has measured the path.

This is the same shape as the CSS pass-1 probe that could not fail, and the proto
lane's two no-op mutants: a check that is narrower than the thing it checks reads as
coverage and is not.

### keepSymbol's denylist — three lanes, one register problem

| lane | node-type name that is also a real declaration | cost |
|---|---|---|
| R | `source_file` is an ordinary R function (`r-testthat/R/source.R:18`) | 12 symbols deleted across 9 files |
| graphql | `Query.me` | 1 of 8,796 symbols |
| sql | `program` is a legal SQL COLUMN name | 1 of 11,786 `contains` edges names nothing resolvable; 3 of 18,325 symbols dropped |

Each lane found it independently, which makes it a fleet-wide register problem
rather than three coincidences. `keepSymbol`'s UNIVERSAL denylist holds
**web-tree-sitter node-type names**, and a node type and a user identifier occupy
the same namespace in every language that allows keywords as names.

### No regex

`script/m12/verify-regex-census.ts` currently **FAILS**: 30 MISSING/STALE across 8
files. Laptop-B lanes in that failure: css 11, fsharp 6, julia 4, clean 2. A direct
scan of the 23 analyzers for regex-receiver calls finds **4 lanes non-zero** —
julia 8, css 8, php 1, scss 1 — and 19 already clean.

Most hits are trivial (`node.type.replace(/_statement/, "")`, `content.split("\n")`),
but the criterion is mechanical and the criterion is right: regex over source text
matches comments and string literals, misses nested syntax, and breaks silently on
the next grammar version.

## INCOMING — now part of the definition of done

An analyzer is done when the graph can walk **to** a declaration as well as **from**
one. `script/m14/incoming-check.ts` measures it.

`src/lsp/impact.ts` already does bounded reverse-dependency traversal, with declared
budgets, depth limits, truncation disclosure and verifier gates. It obtains its
reverse edges by **scanning outgoing edges and matching targets**. No inbound edge is
stored anywhere — the schema holds none. So the reverse walk is exactly as good as
the target-matching, and two consequences are the lanes' problem rather than the
traversal code's:

1. **A target resolving to more than one published symbol.** The reverse walk picks
   one by a rule nobody chose. Measured on 8 cloogle.org Clean files: **10 of 15
   `references` targets were ambiguous**, and `LogMemory` is both `:: LogMemory = …`
   (a generic type synonym, `CloogleServer.icl:313`) and `instance zero LogMemory`
   (a class instance of it, `:320`). Both are real declarations with the same name.
   An ambiguous target is **one** edge attributed to **one** declaration; counting it
   as N is how a name collision becomes a wrong refactor.
2. **A hopeless-string target** — an external package, a path, a builtin, a dynamic
   dispatch — is indistinguishable from a declaration that was never indexed. On the
   same 8 files, **273 of 320 `references` targets resolved to nothing at all**.

The orphan rate is reported but deliberately **not thresholded**: in a language
whose files are independent a high rate is correct, so a pass/fail there would be a
judgement about the language dressed as a measurement.

Laptop C owns the resolution layer and the schema work. Laptop B's side is making
emitted edges resolvable and being honest about the ones that cannot be.

## Process defect found while supervising — agents waiting on jobs that finished

Three agents sat silent for 20+ minutes with **no child process running**. The cause
was always this shape:

```bash
setsid nohup npx tsx census.ts > out.log 2>&1 < /dev/null & disown
sleep 200; pgrep -f census >/dev/null && echo RUNNING || echo DONE
```

`pgrep -f census` matches **the polling shell itself**, because the pattern is in
that shell's own command line. The predicate is always true, so the loop always
prints RUNNING and the agent waits forever on a job that finished minutes ago.

This is the second time this exact bug has cost the fleet time — the supervisor's
own `status.sh` had it first, and it was fixed there while going unmentioned to the
agents. `anti-stall-brief.md` now tells every agent: run the census in the
foreground, or capture the PID and `wait $PID`, or anchor the pattern so the shell
cannot match itself. Never a bare `sleep N; pgrep -f <thing you launched>`.

## Fleet round 3 — findings that outlived the sessions that made them

All ten agents reached their session end. Their work is on disk; these are the
findings worth carrying forward, recorded here because the logs are not a durable
artifact.

### A JSON parse produces ONE symbol and 200,000 children

The json lane's depth probe reports, at depth 1 from the root, an `ERROR` node with
`childCount 200000`, and `symbols=1 rels=0`. Two timings on the same input: OLD
249,043 ms, NEW 347,114 ms.

This is the same shape as the parse-error branch other lanes reported — `parseFile`
substitutes a regex `extractFallback` whose symbols carry no `kind` (zig: 192
kindless symbols per full run) — but at a scale nobody has characterised. A root
with 200,000 children is not a parse, it is a failure to fail. It needs its own
measurement before anyone claims a json number.

### R cannot typecheck against its own analyzer's metadata

`FileMetadata.complexity` is required, and the scss analyzer's metadata object
omits it. This is a cross-lane type error in `src/ast/types.ts` — a file the
supervisor owns and no agent may edit — and it blocks a lane from building. It is
the third `types.ts` friction point in this wave, after the julia duplicate-doc
repoint and the `SymbolKind.Instance` merge note in the contract.

### Nim publishes symbol names that are its own internal scaffolding

`RootRef` in `graphql-nim/graphql/builtin/*_respstream.nim` and `RootObj` in
`graphql-nim/graphql/common/ast.nim` — these read as the analyzer's own working
names rather than source declarations. If they reach the store as symbols, the
graph carries names no Nim programmer wrote. Unconfirmed: the lane was checking
whether they are declared or synthesized when its session ended.

### Bash, Zig, Lua, Julia, SQL produced report-shaped output

Each reached a report before exiting. Lua has 3 commits on its branch, php 1. Those
are reviewable; the rest are read in the lane logs.

## MEASURED FIRING — 18 of 23 laptop-B lanes, production parseFile, 120 files each

This is the first table built from `script/m14/firing-check.ts` rather than from an
agent's summary. It is the number that matters, and it is **lower than what the
lanes reported**, which is the expected direction: source derivation over-counts,
because a branch guarded by a predicate the corpus never satisfies still greps.

| lane | fired | edges | files | degraded |
|---|---|---|---|---|
| fsharp | **9/10** | 12,517 | 120/120 | 0 |
| powershell | **9/10** | 13,967 | 120/120 | 0 |
| nim | 8/10 | 5,320 | 120/120 | 0 |
| php | 8/10 | 9,448 | 112/120 | 0 |
| r | 8/10 | 5,284 | 120/120 | 0 |
| zig | 7/10 | 8,445 | 120/120 | **1** |
| bash | 6/10 | 4,583 | 107/120 | 0 |
| graphql | 6/10 | 15,954 | 120/120 | 0 |
| json | 6/10 | 42,918 | 114/120 | **1** |
| julia | 6/10 | 18,579 | 120/120 | 0 |
| sql | 6/10 | 1,409 | 120/120 | 0 |
| css | 5/10 | 73,369 | 120/120 | 0 |
| hcl | 5/10 | 3,440 | 120/120 | 0 |
| scss | 5/10 | 510 | 120/120 | **1** |
| xml | 5/10 | 2,674 | 120/120 | 0 |
| yaml | 4/10 | 16,126 | 116/120 | 0 |
| protobuf | 3/10 | 2,069 | **10/120** | 0 |
| toml | 1/10 | 1,729 | 104/120 | 0 |

Not yet measured: dart, clean, markdown, graphql's tail, scss's tail. Protobuf
parsed **10 of 120** files — 2,069 edges from a tenth of the sample, so its 3/10 is
provisional and the parse failures need their own count before the number means
anything.

### Three lanes are DEGRADED and their numbers are provisional

zig, json and scss each had a degraded parse. The gate **refuses to publish a count
from a degraded run**, because a degraded parse returns FEWER edges with no error:
`parseFile`'s catch substitutes a regex `extractFallback` whose symbols carry no
`kind` and whose edges sit at 0.4/0.5. A degraded lane's count is a count about the
fallback, not about the analyzer.

The root cause was found and fixed — `resolveWasm`'s last fallback wrote each
grammar to a path shared by every process, so a concurrent reader got a truncated
file (see `7a7f0810f`). The residual degradation means other concurrent readers
still exist. **Ten lanes share this machine**; that is the load.

### Reading this table honestly

- **The high scorers are not thereby correct.** fsharp at 9/10 and powershell at
  9/10 have both had fabricated edges removed in this very wave — powershell
  published a wildcard as a symbol name, and a variable as a type name. Firing is a
  necessary condition and not a sufficient one.
- **A low score is not automatically a defect.** toml at 1/10 is CORRECT and is
  complete at 1/1: a config format has no call graph. css at 5/10 and scss at 5/10
  are close to their ceiling.
- **A high score with few files is a warning, not a result.** protobuf's 10/120 is
  the shape to distrust.

## The regex census, lane by lane

`script/m12/verify-regex-census.ts` FAILS. Current counts:

| lane | regex findings | status |
|---|---|---|
| **julia** | 0 | **CLEAN** — all 9 removed this wave |
| css | 11 | open |
| fsharp | 6 | open |
| clean | 2 | open |
| scss | 2 | open |
| sql | 1 | open |
| svelte / javascript / typescript / python | 4 / 2 / 1 / 1 | other laptop |

**julia is the method.** The lane did not add a census row saying its regexes were
acceptable — a census row is a verifier-written artifact (honesty contract 5.1), so
the only honest move was to delete them. All 9 were node-text normalisation and
became prefix/character tests: `stripSigil(text, "@")`, `unquoteOperatorMember`,
`collapseSpace`. The supervisor verified it against the gate rather than the
agent's word: the four remaining julia entries report as `ABSENT-IN-WORKTREE`, which
is the gate agreeing the literals are gone.

**A grep is not the gate.** A direct grep for `.replace|.split|.match` still finds
3 call sites in the julia analyzer, and both live arguments are STRINGS
(`"_statement"`, `"\n"`). Those are string methods, not regex. A naive scan
over-reports, and the census is the instrument that decides.

## keepSymbol — the register problem six lanes found

`src/ast/pool-worker.ts`'s `keepSymbol` denied 15 names on the stated grounds that
they are "never legitimate declarations in any language". Six lanes measured
counterexamples independently:

| lane | the name | what it actually is | cost |
|---|---|---|---|
| R | `source_file` | an ordinary R function (`r-testthat/R/source.R:18`) | 12 symbols / 9 files |
| lua | `root`, `this`, … | `local root` at `lazy.nvim/lua/lazy/core/loader.lua:497` | **236 declarations, 677 edges** |
| sql | `program` | a legal SQL COLUMN name | 3 of 18,325 symbols |
| graphql | `me` | `Query.me`, an ordinary field name | 1 of 8,796 symbols |
| hcl | `unknown` | a legitimately declared variable | filed as H10 |
| solidity | — | measured the denylist as a store-vs-analyzer divergence | — |

Of the 15 names, only `this`, `super` and `unknown` are reserved essentially
everywhere; `me` is legitimate in every language there is and `destructor` is a real
method name in C++/Rust/Go. **A node type and a user identifier occupy the same
namespace in every language that allows keywords as names**, which is why a
grammar-artifact denylist cannot also be a keyword denylist.

Fixed by splitting the set: `UNIVERSAL` keeps only names no lane produced a
counterexample for, and `RESERVED` is consulted per language. Verified with a
24-case table including the cases that MUST differ (`self`/php false,
`self`/python true; `program`/sql false, `program`/r true), and
`sentinel-census.ts` — the R7 enforcement — is byte-identical before and after.

## bash round 4 — the shape of a correct incoming fix

357 `uses` edges named a declaration the analyzer never published, because bash
binds names in four constructs the declaration collectors do not read (`for NAME
in`, `read NAME`, `mapfile`, `printf -v`).

**The `uses` total did not move: 7,802 before and after.** That is what
distinguishes this from a fabricated edge — the edges already existed and named a
real binding; only the declaration they named was missing. A fix that reduced the
count would have been deleting real edges.

`explained by a binding site` went 357 → **0**, and the unexplained residue stayed
at 1,563. A class closed, not a number shifted.

## Two gates that could not fail — found by the lanes that owned them

### R: the mutation gate reported 26 caught while executing none of them

`caught` was `code !== 0`. That is also true of a child that **crashed**. Under
bun, `process.execPath` is the bun binary, bun rejects `--import tsx`, so every
mutant child died before running a fixture — and all 26 pairs read `caught`. The
same battery under `npx tsx` reported **12 caught and 14 survived**.

A second rule was wrong in the same direction: a mutant counted as caught only if
**every** fixture rejected it. That scores the *fixture*, so `drop-uses` was recorded
as a survivor of a fixture that had no `uses` edge to remove.

Fixed: a result counts only when the child's own banner and tally line are present;
a missing banner is a **HARNESS FAULT**, counted apart from a survivor; and a mutant
is caught by **at least one** fixture.

Verified by the supervisor by running it under bun — the exact condition that
exposed the tautology:

```
mutants: 0 caught by >=1 fixture, 13 survived by every fixture,
         234 harness faults, of 234 mutant/fixture runs
parent runtime: bun — a runtime that cannot execute `node --import tsx`
makes every child fail and is reported as HARNESS, never as a catch
```

**234 faults, 0 false catches.** The guard is proven by the failure it was written
for.

### ZIG: an instrument with swapped buckets produced a clean negative

P12 keyed `instOtherAt` (= `isConstructorApplication`, `TypeName{…}`) while P11
keyed `isGenericTypeApplication` — which `real-zig-analyzer.ts:1482` pushes for a
call to an in-file `fn … type`. **The buckets were swapped**, because the
analyzer's own metadata name is a misnomer. P12 therefore reported **0 edges over
1,528 sites** and read as a clean negative about a class that fires at **100%**.

Two more in the same pass: P11/P12 matched on LINE while the edge keys on
`(line, target)`, and P13 counted edge *presence* where it printed a per-site
*percentage*. And the precondition `p13SelfSites > 0` asked Zig for a construct it
has no keyword for, so that verdict line read NO on all eight CLEAN runs — an
unsatisfiable precondition reporting as a result.

**This is the same failure shape three times in one programme**: CSS's pass-1
containment probe (which read `symbol.range.start.line`, but `parseFile` returns no
`range`), TOML's `references` probe (Gradle writes the ref inside an inline table),
and now ZIG's P12. A probe that measures the wrong thing returns a confident zero.
The defence is the same each time: a **positive control that must fire**, and a
precondition that is satisfiable.

### The shape of both fixes: the honest result is fewer confident claims

Both lanes ended with *fewer* things they could assert, not more. ZIG withdrew
three zeros. R withdrew a green. Neither is a regression in the work — it is the
first time these lanes could tell the difference between "measured" and "asked a
question my instrument could not answer".

## keepSymbol — verification of the blast radius, since it touches all 46 lanes

Moving 8 names out of the denylist makes MORE symbols survive for every language,
so the change needed measuring rather than asserting.

**Per-name, per-language, after the fix:**

| name | status |
|---|---|
| `this`, `super` | still refused in **every** language tested |
| `module_declaration`, `package_manifest`, `GlobalScope`, `SCSS_FILE_SCOPE` | still refused everywhere — these are names OUR analyzers mint, so no user program can declare them |
| `self`, `Self`, `me`, `My`, `destructor`, `root`, `source_file`, `unknown` | admitted |
| `program` | admitted EXCEPT in `sql`, where it is reserved |
| `self` | refused in `php`, admitted in `lua`/`r`/`python`/`typescript`/`zig` — verified to differ by language |

**The R7 risk, closed at runtime rather than in source.** Moving `unknown` out of
the denylist means a symbol named `unknown` now survives `keepSymbol` — and `keepSymbol`
only sees the symbol object, never the tree, so it **cannot** distinguish a DECLARED
`unknown` from a PLACEHOLDER one. `script/m60/sentinel-census.ts` is source-level and
was byte-identical, which is necessary and not sufficient.

So it was measured on real output: **840 files across 7 repositories, 246,074 symbols
published, 0 named `unknown`, 0 edges touching one.** The risk is closed empirically.
A placeholder named `unknown` is therefore prevented by the analyzers not emitting one —
which is what the sentinel census gates — rather than by `keepSymbol` silently dropping
every legitimate declaration of that name.

**A gate that printed 15 of 18 failures.** `verify-regex-census.ts` reported
"missing from census: 18" and printed 15. A reader counting rows saw 15; a reader
trusting the header saw 18; and the 3 in between (one xml, two extra svelte) belonged
to no lane in either accounting. Now everything prints, with `BB_REGEX_LIST_CAP` to
re-introduce a cap that says so rather than truncating silently.

**The real remaining debt: 18 regexes in HEAD.**

| lane | count | mine |
|---|---|---|
| css | 11 | yes |
| svelte | 3 | no |
| scss | 2 | yes |
| xml | 1 | yes |
| sql | 1 | yes |

Laptop B owns **15 of the 18**. julia is clean; two of php's census hits were doc
comments *describing* a regex that no longer exists, which is the same over-report the
gate's own scanner avoids.

## Infrastructure: the 98 GB database that was breaking agents

Agents kept dying on `Error: Failed to execute statement`. It was first read as a
`.bb-data` collision between lanes, which was **wrong**. The real cause:

```
~/.local/share/opencode/opencode-main.db     97.6 GB
~/.bb/projects/                               41 GB   (871 derived indexes)
```

opencode writes every message and tool call to that one SQLite file. At 98 GB with a
0.4 GB WAL, **ten concurrent agents contend on it** — so the disk pressure and the
write failures were one cause with two symptoms, not two problems.

Cleared with the owner's authorisation: `~/.bb/projects` staged, verified to contain
only `brain.db` derived indexes and one stale `.index.lock`, then deleted. Nothing was
held open by any agent at the time. **22 GB free → 62 GB free; `~/.bb` 41 GB → 391 MB.**

The opencode session database was left alone — it is the owner's session history
across every project and not the supervisor's to prune.

## R installed the language runtime to adjudicate the analyzer

16 of the R lane's 18 fixtures asserted **nothing**: the runner enumerates
`*.expectation.json` and F01–F16 had none, so the directory looked like coverage and
was 16 lines of comment.

Authoring the missing expectations required checking two of them, and both were
**wrong** — so the lane installed **R 4.6.1** and ran it:

1. F13 asserted "a function bound rightward is a declaration". It is not.
   `eval(parse(text="function() 1 -> x"), new.env())` leaves `ls()` empty, and
   tree-sitter-r agrees: the assignment nests inside the function body as
   `function_definition > binary_operator op="->"`. The analyzer publishing nothing
   was **right**; the fixture was wrong. The oracle that "verified" it was the wrong
   instrument.

2. F15 cited `R 4.4.3 accepts "..2dge <- 1; ls()"` as evidence. **`ls()` is the wrong
   oracle for a dot-prefixed name** — it hides those by default. On R 4.6.1
   `ls(env)` is empty, `ls(env, all.names=TRUE)` is `"..2dge"`, and
   `exists("..2dge")` is TRUE. The analyzer is right, and a fixture checked with
   `ls()` would have **found a defect that does not exist**.

**An oracle can be wrong in the SAME DIRECTION as the analyzer, and the two then
agree.** That is the differential's declared blind spot made concrete. A second
tree-sitter walker over the same grammar would have reproduced the same mistake,
because it would have inherited the same reading of what the construct means. Only
executing the language adjudicated it.

This is the strongest verification available in this programme, and it is the answer
to "how do you know the analyzer is right" for the cases where two parsers agree.

## "10/10" is population-dependent — PHP is the worked example

PHP's lane reports **10/10 EMITTED** and the arbiter agrees at whole-corpus scale.
But the supervisor's own `firing-check` reads **9/10** on a 120-file sample and still
**9/10** on a 1,112-file sample. Both numbers are true. The difference is `overrides`:

| population | `overrides` fires? |
|---|---|
| 120-file stride sample | no |
| 1,112-file stride sample | no |
| whole corpus, 4,588 files walked | **1 edge, 1 file** |
| whole corpus, 4,642 admitted (lane's census) | **2 edges, 2 files** |

The one file the supervisor's walk found:
`phpunit/tools/.phpstan/vendor/tomasvotruba/type-coverage/packages/type-perfect/tests/Rules/NoParamTypeRemovalRule/Fixture/SkipConstruct.php`
→ `SkipConstruct.__construct -> ParentConstructorClass.__construct`.

So PHP is genuinely 10/10 **at whole-corpus scale**, and `overrides` is a real PHP
construct that occurs in **0.04% of files** (2 of 4,642). A stride sample will miss it
reliably.

**This is the honest shape of a coverage claim, and it has three parts:**
1. the **numerator** — types that measurably fire,
2. the **denominator** — types the language has, established by measured
   non-applicability rather than by the ontology table,
3. the **population** — and the numerator is a function of it.

A claim that states only (1) and (2) is incomplete in a way that matters, because a
reader cannot tell whether a missing type is absent from the language or absent from
the sample. Every firing figure in this workstream now states its population for that
reason.

## The sharpest instance of a vacuous zero — PHP's own `define()` probe

PHP had RULED `exports` inapplicable on "0 `define()` calls in 4,642 files". That zero
was **structural**: the probe read `arguments.namedChild(0)` and tested it for
`string`, but tree-sitter-php puts an `argument` node between them —

```
function_call_expression
  name "define"
  arguments
    argument          <- what namedChild(0) returned
      encapsed_string <- the node the test wanted
```

No corpus could falsify it, because no corpus makes it non-zero. **The ruling's own
overturn condition was unreachable — falsifiable in form, unfalsifiable in fact.**

What caught it was a **positive control, not a bigger sample**: 7 synthetic files, one
per construct, each asserting its probe fires. `define("X", 1);` read 0 and located the
defect exactly. After the fix: **60 literal-name `define()` calls in 20 files**, 57 of
them at file scope. PHP is now 10/10 with 0 ruled.

That is the single strongest argument in this programme for the discipline the
honesty contract already demands: **a probe that cannot fail is not a measurement.**

## A latent shared defect: two files disagree on one enum value

Found by the zig lane via the bug it exposed in my `incoming-check` instrument.

```
                        src/ast/types.ts     src/ast/engine.ts
RelationshipType.Imports        brain_import        imports
```

Every other one of the 20 members agrees. This is a single-point divergence.

**Which is right?** `engine.ts`. Analyzers import `RelationshipType` from
`./engine`, the store's `relationship_type` column documents its vocabulary as
`"calls", "extends", "implements", "uses", "imports", "exports", etc.`, and
`brain_import` is the name of a **separate table** that holds import records with
their own columns (`import_path`, `imported_name`, `is_external`). So the two
strings mean different things and `types.ts` has conflated the table name with the
edge label.

**Severity: latent, not active.** No analyzer imports `RelationshipType` from
`./types` — checked across all 50 — so nothing currently emits the wrong label and
no stored row is wrong today. It becomes active the moment one does.

**Not fixed here, deliberately.** `types.ts` is one of the two files the supervisor
owns, so this is squarely in scope — but the fix needs a decision about whether the
`brain_import` TABLE should also be reconciled, and a wrong guess there would change
what every import query in the product returns. It is recorded with the evidence and
left for the owner.

**What it already cost:** my own `incoming-check` keyed its table on `brain_import`,
so it reported `imports` as **0 in every language in the fleet** — a confident zero
from a table that could never match. Fixed in `e9096830f` by accepting both
spellings through an alias map rather than by picking one. Measured after:
clean 153 import edges, haskell 55.

That is the generalisable lesson: **a table keyed on a string that is wrong in a way
which always reads zero is worse than no table**, because the zero looks like a
finding about the language rather than a defect in the instrument.

## Dart: the documented command did not reproduce the documented table

The lane's verdict table is a 2,735-file measurement and the command printed beside
it was `BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/census.ts` — but the
harness defaulted to `BB_DART_PER_REPO=250` and so sampled **1,250** files.

Re-running the documented command reproduced **22,436 `calls` against the table's
43,042** — about **52% of every count**, with nothing in the output saying the two
disagreed. The default is now 600/repo, which is the sample the table describes, so
the printed command reproduces the printed table.

**This is the cheapest and most embarrassing class of defect in the programme: a
number and the command that produces it, side by side, disagreeing by half.** Nothing
detects it unless someone actually re-runs the command, which is why the lane did.

Two more fields the doc cited and the harness never emitted: `tgtSample` was
accumulated since the settled-phase fix and never written out, and there was no
target-in-repo field at all — so the doc's sample/repo figures for `calls` and `uses`
had **no instrument field behind them**.

## Latency measured by alternating the blobs, not by trusting the artifact

The declared complexity artifact **cannot** answer the budget question: it is sealed
at 2026-09-14, predates every change in this wave, and `analyzer-complexity-gate`
scores dart `unscorable` because its corpus row carries no load data (40 of that
gate's 44 lanes share the state). Its row is also not reproducible from the primary
corpus — 707 ms/file on /tmp/dart-corpus against 129–165 ms/file on real files.

So the lane measured directly, alternating the two analyzer blobs so the load
condition is SHARED rather than assumed — 300 files, runs in the order
AFTER, BEFORE, AFTER, BEFORE:

```
  this wave's HEAD    49,450 / 50,111 ms   mean 49,781   165.9 ms/file
  pre-M14 8286c7391   49,390 / 48,532 ms   mean 48,961   163.2 ms/file
  delta                        +820 ms     +2.7 ms/file    +1.67% wall
  symbols 15,154 both — unchanged
  relationships 47,882 -> 48,306  +424 (+0.89%), all of them `references`
```

Against the declared 400-file budget of 600 s, 400 files at the measured
165.9 ms/file is **66.4 s — 9.0x inside budget**. Stated as a **projection**, not as
a measurement of the declared `corpus_subset`, whose file set the lane cannot
re-derive.

That is the honest form: it says what was measured, over what, and what is
extrapolated. Note also that the fsharp lane withdrew a +16% latency claim for
exactly the opposite reason — non-interleaved A/B on a shared box. Alternating the
blobs is the fix both lanes converged on independently.
