# real-erlang-analyzer.md

## Language

- Analyzer file: `src/ast/real-erlang-analyzer.ts`
- Parser: `tree-sitter-erlang` (pinned `wasm/tree-sitter-erlang.wasm`; npm
  tree-sitter-erlang downloaded and verified behaviorally identical on the
  corpus via the production `parseFile` path — 11 vs 11 grammar-error files,
  0 fixed, 0 regressed — so no upgrade was warranted; tree:
  `-module`/`-export`/`-import`/`-include`/`-include_lib`/`-behaviour`/
  `-define`/`-record`/`-type` are `attribute` nodes; functions are
  functions are `fun_decl` → `function_clause` → `expr_args` + `clause_body`
  (a NEW `fun_decl` opens at every semicolon-separated clause, so merging
  clauses into one symbol is the analyzer's job — measured 2026-09-25); calls
  are `call` (`Module:func(...)` → `remote` → `remote_module` (atom) + the
  function `atom`; local calls are `call` with a bare `atom` callee);
  `#state{...}` construction is
  `record_expr`, `State#state{...}` update is `record_update_expr`,
  `State#state.q` access is `record_field_expr` (all three distinct node
  types); `receive ... end` is `receive_expr` with optional
  `receive_after`; the `!` send operator parses as `binary_op_expr`
  (the `send_expression` branch never fires in this grammar))
- Language detection: `.erl` → `erlang` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealErlangAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (paren strip, arity strip, record-name strip,
  type-name strip — pure char scans, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `-module` → module name (FIRST declaration wins, ER-D15); `-record` → record name; `-define` → macro name; `-type` → type name; `-opaque` → type name with `meta.isOpaque`; `-callback` → a Method symbol with the sig's arity and `meta.isCallback`; functions → the clause's `atom` name. Function IDENTITY is name + ARITY (#880/ER-D2): `pick/0` and `pick/1` are two symbols, and every semicolon-separated clause group of one name/arity merges into ONE symbol whose range spans every clause and whose `meta.clauseCount` states how many |
| kind | ✅ | `-module` → `module`; `-record` → `struct` (Erlang records are the record-struct analog); `-define` → `constant`; `-type`/`-opaque` → `type`; `-callback` → `method`; `-nifs`/`-on_load` entries → `function`; functions → `function`; fields of a record → `property` |
| complexity | ✅ | per SYMBOL: base 1 + case/receive/try arms (`cr_clause`, `catch_clause`), if arms (`if_clause`), a `receive_after`, `andalso`/`orelse`, plus one per extra clause (ER-D13). A clause HEAD is a match, not an arm |
| qualified/container name | ✅ | `ownerName` = enclosing module for records/macros/types/functions; record fields owned by their record symbol (`contains record -> field`) |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | from the `clause_head` variable children |
| visibility | ❌ (n/a) | Erlang has no visibility keyword — all functions are module exports or not; `-export` list recorded as metadata |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only: module → its records/macros/types/functions (`contains service -> handle_call`), record → its fields (`contains person -> id`). Sources the RECORD symbol, never the `#state` field text. | 1.0 |
| implements | ✅ | `-behaviour(gen_server)` → `implements service -> gen_server` (behaviour = the Erlang interface analog) | 0.9 |
| calls | ✅ | `call` nodes in EVALUATION contexts (a clause head is a pattern; type syntax is DECL-ONLY — ER-D3). Source = the named function, else the enclosing `-record` (a field default, ER-D12), else the module. Remote calls keep `module:function` (ER-D1) with STRUCTURAL extraction (the module atom of `remote_module`, the function atom of `remote`) and `?MODULE:` expands to the current module (ER-D14, `meta.macroModule`); local calls resolve against the file's declared name/ARITY set (forward references included). Self-recursion IS emitted. `meta.callArity` is the call's `expr_args` named-child count, comments excluded, and it is part of the edge identity: `f/1` and `f/2` sites are distinct edges (ER-D2) | 0.9 |
| instantiates | ✅ | `record_expr` (`#state{...}`) in BODY/guard position only → `instantiates run -> state`. Record literals in PATTERN position (function heads, `expr_args` before the guard/body) emit NOTHING. `record_update_expr` (`State#state{...}`) is a member WRITE, not a construction — no instantiates (ER-D4) | 1.0 |
| uses | ✅ | record member READ (`State#state.q`, `#state.label` index reads) → `uses -> <record>` AND `uses -> <field>`; record member UPDATE (`State#state{count = X}`) → `uses -> <record>` and → each assigned field. Evaluation contexts only: a head pattern emits nothing (ER-D7, closes ER-G4). `meta.context` is `record member read` or `record field update` | 1.0 |
| references | ✅ | module dependencies (`-include`/`-include_lib` path string, `-import` module); macro USES (`?TIMEOUT`, `?MODULE`, `?SERVER_HEADER` — emitted whether or not the macro is defined here, ER-D8, closes ER-G1); fun VALUES (`fun f/1` bare, `fun lists:map/2` qualified — a value is not an invocation, ER-D9, closes ER-G2); type dependencies from `-type`/`-opaque` to every NAMED type in the expression (atoms + applied call heads; vars are parameters, ER-D10, closes ER-G5). Body variable uses emit NOTHING | 1.0 |

## Noise-elimination contract (what produces NO edges)

- Record literals in pattern position (`#state{}` in function heads) — never
  instantiates.
- Variable uses (`Pid = spawn(...)`, `State` references) — no identifier
  reference edges; references are module deps only.
- `!` send operator — `binary_op_expr` in this grammar (the
  `send_expression` branch is dead); sends are not calls to any symbol.
- Attribute heads (`-export([...])`, `-spec`, `-record`, ...) — the attribute
  declares the symbol; its inner content is never a call.
- Macro uses (`?WITH_STACKTRACE(...)`, `?TIMEOUT`, `?MODULE`) — a `references`
  edge to the macro name (ER-D8), never a call edge; `?MODULE:` in remote-module
  position additionally resolves the call to the current module (ER-D14).
- Type syntax (`-spec`, `-callback`, `-type`, `-opaque`) — DECL-ONLY (ER-D3):
  `state()` there is a type application, never a call site. `-spec` records
  nothing standalone; `-callback` declares a Method symbol.
- Params/locals never become symbols.

## Complexity model (live, verified against emitted shapes)

Cyclomatic complexity counts decision points per ARM, per SYMBOL (ER-D13),
from the pinned grammar's actual emitted node types:

- `cr_clause` — one per case/receive/try-of arm (the grammar uses one node
  type for all three), `if_clause` one per if arm, `catch_clause` one per
  catch arm, `receive_after` one ("Receive with Timeout" pattern).
- `andalso`/`orelse` (`binary_op_expr`) — one each.
- One per EXTRA clause of a function (`meta.clauseCount - 1`); a clause HEAD is
  a match, not an arm.
- The symbol carries the total (`symbol.complexity`); the file total is base 1
  plus every symbol's arm contribution, so the two cannot drift apart.

Pinned by `validation/m14/fixtures/erlang/record-ops-er2.expectation.json`
(`expectComplexity`: transitions 7 = base 1 + 3 case arms + 2 receive arms +
receive_after; guarded 4 = base 1 + 2 if arms + andalso; heady/get_count/idx 1)
and by mutant `erlang/complexity-arms-flattened`.

The dead baseline entries (`receive_expression`, `after_clause`,
`send_expression`) and the dead `string_literal` include fallback are gone —
those node types are never emitted by the pinned grammar.

## Regex census

Baseline at M12.01: **4 usages**. After M12.24 (pure-AST rewrite): **0
usages** — all four eliminated with pure char scans:

| Old regex | Replacement |
| --- | --- |
| record-paren strip (`#state{...}` → `state`) | `stripRecordParens` char scan |
| arity strip (`name/2` → `name`) | `stripArity` indexOf slash slice |
| function-name strip | pure `clause_head` identifier extraction |
| parse-type strip | pure `type` node text, no regex |

Census total 82 → **78**. The census gate passes (0 missing, 0 stale, 0
unclassified).

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/erlang-complexity.json`):

- Fixtures: 2 files, 29 symbols, 40 relationships, ~236 ms
- Corpus subset: 225 files (rebar3@0c947d3b — the Erlang build tool itself),
  5,400 symbols, 19,207 relationships, ~7.3 s
- All loops single-pass over per-file structures; no nested symbol loops
  (verified by loop-structure scan — zero nested `for` over symbols).

## Corpus validation

`validation/m12/results/erlang-differential.json` (via
`script/m12/verify-analyzer.ts erlang`):

- Fixtures: `Service.erl` (positive) + `Negative.erl` (negative)
- **69/69 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
- Corpus error scan (`script/m12/erlang-corpus-errors.ts`): all 225 .erl files
  ≥ 1KB — **11 grammar-error files (4.9%), 0 crashes, 0 timeouts**. All 11
  classified honestly as grammar limitations, same category as Go's testdata:
  `?WITH_STACKTRACE(C,T,S)` macro expansion (arrow inside the macro body —
  unparseable without macro expansion; the macro test file itself parses fine)
  and 2 template files with `{{placeholder}}` syntax (not real Erlang).
- Shape-safety (`script/m12/erlang-node-types-compare.ts`): 9/9 analyzer
  node-type refs live against the pinned grammar's emitted types, 0 dead.

## Supported / unsupported constructs

Supported: modules, functions (multi-clause heads merged into one symbol,
arity-stripped), records (with fields), macros (`-define`, `?MACRO` use),
types (`-type`/`-spec`), behaviours (`-behaviour` implements), exports
(`-export`), imports/includes (references), module-qualified and local calls
(with forward references), record construction (`#r{}`) and update
(`State#r{...}`), `receive` with timeout, OTP pattern detection
(gen_server/gen_statem callback marking).

Not modeled (deliberately): `!` send (parses as `binary_op_expr` — no symbol
edge), macro expansion CONTENTS (unparseable by design — recorded as grammar
limitations), pattern-position record literals and member reads.

## Restoration record (ER1 + ER2, 2026-09-25)

The ER1/ER2 waves landed this contract on the working tree on 2026-09-18
(`reviews/erlang/m49-er1-arity-lines-dual-lens.md`,
`reviews/erlang/m49-er2-done-bar.md`), and their pins survived — the nine
fixtures, the identity verifier, `script/m14/spec/erlang-completeness.json`,
the review records and (part of) the mutant registry — while the analyzer
SOURCE did not: `git log --all -S record_field_expr --
src/ast/real-erlang-analyzer.ts` finds no commit that ever held it, and neither
did the differential oracle. Measured at HEAD before the restoration: 9 of 9
committed erlang fixtures FAIL, the F5 oracle derived only
calls/implements/instantiates, and 5,951 of 5,951 relationships on a 60-file
draw carried no line at all.

The contract above was therefore re-implemented against its own surviving spec
(fixtures first, rulings ER-D1..ER-D15) and re-measured:

| Witness | Result |
| --- | --- |
| `bun script/m14/run-fixtures.ts --lang erlang` | **9/9 PASS** (was 0/9) |
| `bun script/m14/verify-erlang-identity.ts` | PASS — 4 functions, 2 export arities, call-site arity + site lines on local and remote calls, **13/13 output mutations CAUGHT** |
| `BB_MUTANT_ONLY="erlang/" bun script/m14/mutate-analyzer.ts` | **20/20 CAUGHT** (9 recovered + 11 re-authored for the ER2 surface), each by its intended fixture |
| `bun script/m60/lane-surface-audit.ts --lang erlang --limit 60` | **0 unlined of 8,645 edges** (was 5,951/5,951 unlined); labels calls/contains/references/uses/instantiates/implements; 0 ghosts |
| `bun script/m14/differential.ts --lang erlang` | **rebar3 3,328/3,328 covered, MISSING 0, unexplained 0** · **otp 4,585/4,585, MISSING 0, unexplained 0** — with `uses` and `references` now COMPARED kinds |
| `bun script/m14/verify-corpus-census.ts --lang erlang` | PASS files=60 err=1 types=102 blind=0 |
| `npx tsc --noEmit` | clean |

The shape probes this round added are committed as evidence:
`script/m14/tmp/erlang-er2-shapes2.ts` (fun_decl/expr_args arity, the `?MODULE:`
module position, the guard's ancestry — the pattern-position boundary is
`guard`/`clause_body`, never the clause itself).
