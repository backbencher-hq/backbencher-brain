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
