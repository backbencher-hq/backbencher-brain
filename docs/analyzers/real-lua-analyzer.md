# real-lua-analyzer.md

M14 ontology workstream, lua. **Wave 2 — the adversarial pass.** Wave 1
established the ten verdicts and was merged; this pass re-ran pass 1's own claims
adversarially, against the two findings the aggregate says outrank any single lane,
and found two defects that pass 1's suite was green over.

Every number here is reproducible from the scripts named in §9. All production
counts come from `parseFile` in `src/ast/pool-worker.ts` — the production entry
point, not `analyze()`, which skips the pool-worker stages.

**Read §5 before quoting any count from this document.** `parseFile` is not
deterministic: two runs over a provably identical draw of all 3,252 corpus files
disagree, and §5 names the 12 files responsible. Every total here is a
single-run observation with its sibling run beside it.

## 1. Language and wiring

- Analyzer: `src/ast/real-lua-analyzer.ts`
- Parser: `tree-sitter-lua` WASM at `wasm/tree-sitter-lua.wasm`
- Grammar: `@tree-sitter-grammars/tree-sitter-lua` 0.4.1
- Corpus: `$HOME/fixtures/repositories`, **3,252 tracked `*.lua`
  files** across 19 repos, every one parsed through `parseFile`. Not a sample: the
  draw predicate is `git ls-files '*.lua'` per repo, sorted, no cap, so the file
  set is identical on every machine. Every run records a `drawDigest` over
  `repo \t path \t byte-length` and all 16 shards of all four runs in this document
  agree on `c990daa339a9…`. Largest repos: kong (1,312 files, 26,183 `calls`
  edges), nvim-lspconfig (863), luvit (199), luarocks (162), snacks.nvim (141).

## 2. What each relationship type means IN LUA

Not the general meaning of the ten labels — what each one can carry when the
language is Lua, which is what makes nine of them applicable and one not.

| Type | Meaning in Lua, and where the construct is written |
| --- | --- |
| `calls` | A `function_call`'s `name` field. The TARGET is the bare callee name — `create` for `coroutine.create`, never the path. The SOURCE is the enclosing function label, or `global` at file scope. |
| `uses` | A **bare** name this scope reads as a value. Since M60 LUA-47 this is exclusively bare names: `labelShape` is `{bare: 54,562}` over the whole corpus, with no dotted, colon, payload or other shape. A qualified access's FIELD is not a `uses` — it is `references` or `calls`, and publishing it twice was the defect §4 records. |
| `contains` | A declaration inside a container: `global` -> the file-scope name, or `owner` -> the member's own name. Synthesized from symbol pairs, so it carries the symbol's declaration line and no node. |
| `imports` | `require("module")`, `module("module")`, and `require` guarded by `pcall`/`xpcall`. The module path is a STRING in the tree, so the endpoint may be declared in another file; `import_based`, and the 0.4% resolution rate is that fact rather than a defect. |
| `references` | A member read WITHOUT calling it: `M.field`, `M:field`, `M["field"]`. The target is the member's own name. Since LUA-46 a member that is only **written** produces no `references` edge at all. |
| `exports` | A chunk-scope `return` that NAMES something. Lua chunks are not modules, so the source is the file's global scope — this analyzer's existing convention for `imports` and file-scope `calls` — and no symbol is invented from the filename. |
| `extends` | `setmetatable(D, B)`, the metatable relation, with a table constructor excluded as a target and both arguments required to be names. Lua's only type relation. |
| `implements` | NOT APPLICABLE — see §3. |
| `overrides` | Two constructs under two labels, never fused: `lua_redefinition` (the same name declared twice in one chunk, last-wins) at 1.0, and `lua_inherited_member` (a member of D that D also inherits from a base B through `__index`) at 0.95. |
| `instantiates` | `Table:new(...)` / `Table.constructor(...)` / `Table.new(...)` where `Table` is a table declared in this file. |

## 3. Verdicts, with the count or the measurement

`EMITTED` = production `parseFile` produced it on the corpus. `RULED` = a written
reason **and** a corpus measurement, with the instrument and the falsifying probe
named. All ten types are settled; the arbiter is not — see §3.3.

### 3.1 The table

Machine-graded: `bun run script/m14/verify-doc-truth-emissions.ts` reads the
"Emitted?" column of this table and compares it against the analyzer's
`ASTEngine.RelationshipType.*` references, with comments and string literals
stripped first. Wave 1's table was not in a shape the gate could read, so lua's
emission claims were `NO_CLAIM_TABLE` — checked by nothing. This table is
ordered `implements` first **because of a defect in the gate**, not for reading
order: `parseClaimTable` sets its `started` flag on the first *body* row and
`continue`s past it, so **the first data row of every claim table in the tree is
silently dropped**. With `calls` first, lua measured
`UNDOCUMENTED [lua] calls (relationship)`. The bug is invisible for zig, whose
first row is `extends` and which does not emit it. Putting the one type this
analyzer does **not** emit first means the dropped row claims `no`, which is
correct anyway — but the ordering is load-bearing and is stated here rather than
left to look like a preference. The gate is shared machinery and is reported, not
edited (§9).

| Relationship type | Emitted? | edges | files | Repos, and where |
| --- | --- | --- | --- | --- |
| `implements` | no — RULED, instrument A: 100 distinct node types across 1,875 files and none of `implements_clause` / `extends_clause` / `superclass` / `interface_implementation` / `interface_declaration` / `trait_declaration`; Lua has no type declaration of any kind (§3.2) | 0 | 0 | — |
| `uses` | yes — emitted; 100% bare names by construction since LUA-47, 0.9 + `usage_contextual` on every edge, 26.9% of targets name-ambiguous | 54,562 | 2,371 | every repo with a bare read |
| `contains` | EMITTED | 55,028 | 2,473 | every file with a declaration; `global` is a scope label, not a symbol (§6) |
| `imports` | EMITTED; the target is a module-path STRING, which is why 0.4% resolve | 6,547 | 2,140 | `require` sites |
| `references` | yes — emitted since LUA-41 and narrowed by LUA-46, which removed 14,833 writes that were published as reads (§4) | 39,886 | 2,296 | every repo with a qualified read |
| `exports` | EMITTED; 4 of 5,108 sources resolve, because a Lua chunk is not a module and no symbol is named after the file | 5,108 | 2,105 | chunk-scope `return` sites |
| `extends` | EMITTED; instrument A is silent here by construction — `setmetatable(D, B)` is an ordinary `function_call` (§3.3) | 171 | 132 | `setmetatable` sites |
| `calls` | yes — emitted; 8 of 57,057 come from pool-worker's regex fallback and are tallied apart; 647 of 15,283 resolved sources are a `variable`, which is not itself callable (§6) | 57,057 | 2,559 | kong 26,183, snacks.nvim 7,221, luarocks 5,409, luvit 3,398, 13 more |
| `overrides` | yes — emitted since LUA-44; 65 `lua_redefinition` at 1.0 and 1 `lua_inherited_member` at 0.95; 64 of 66 targets name-ambiguous, so the 18.2% resolution rate is not the whole story (§6) | 66 | 38 | luvit 29, kong 23, luarocks 9, snacks.nvim 4, plenary.nvim 1 |
| `instantiates` | EMITTED; instrument A is silent here by construction — `Table:new(...)` is an ordinary `function_call` (§3.3) | 122 | 65 | snacks.nvim 36, luvit 33, plenary.nvim 19, trouble.nvim 13, kong 10, 6 more |

**Total 218,547 relationships and 83,585 symbols** over the 3,252-file draw
(`validation/m60/lua/wave2-census-run1.json`). Sibling run on the same draw:
**217,979 relationships, 83,381 symbols** (`wave2-census-run2.json`).

Wave 1 shipped 302,783 edges and declared the 2.53x payload increase honestly.
This pass **removes 82,424 of them (27.3%)** because two of them were wrong (§4).
Against the pre-ontology baseline of 119,606 edges the net addition is 1.83x.

### 3.2 The one RULED type: `implements`

- **Instrument: A, grammar inventory.** The pinned grammar produced **100
  distinct node types** across a 1,875-file draw, enumerated with per-type counts
  in `validation/m60/lua/grammar-inventory.json`. **None** of the six node types
  that would express it appears: `implements_clause`, `extends_clause`,
  `superclass`, `interface_implementation`, `interface_declaration`,
  `trait_declaration`. Lua has no `class` keyword, no `interface` keyword, and no
  declaration form for a type at all, so the construct has no grammatical shape for
  an edge to be derived from. This is a fact about the language's vocabulary: no
  corpus could produce one of those nodes.
- **Instrument B, for the relation Lua CAN express.** Probe B6 counted 1,295
  supertype links across 453 files and every one is the relation `extends` already
  publishes. Probe B8 split 501 links into four buckets: 79 `crossTable` (both
  sides declared tables), 45 `derivedIsSelf` (`setmetatable(self, …)` inside a
  constructor), 3 `selfLink`, 374 `unresolvedBase` (the base argument is an
  expression — `setmetatable(opts or {}, defaults)` at
  kong/kong/api/arguments.lua — so no name is written for it). Of the 79
  `crossTable` links, exactly 1 has a member declared on both sides, which is why
  `lua_inherited_member` measures 1 edge against 79 inheritance links.
- **A language with exactly one type relation cannot have a second one.**
  Conformance in Lua is duck typing: structural, undeclared, and with no written
  clause for an edge to carry.
- **What would overturn this ruling.** A non-zero count of any of the six node
  types above in the instrument-A artifact — which is what a Lua dialect with a
  `class`/`interface` declaration would introduce. Or a probe finding a
  constructor-like call immediately followed by a conformance test
  (`if type(x) ~= "table" then error(...) end`) at a rate worth an edge.

### 3.3 The arbiter does not run for lua, and this pass fixed the table it would have used

`npx tsx script/m14/ontology-coverage-gate.ts lua` **exits 2 and refuses to
report**: `RULED_BY_LANG` has no `lua` entry, and the gate states it will not
report from an empty table because that would be a verdict about the table rather
than about the lane. So the ten verdicts above are established by this lane's own
instruments, not by the shared arbiter. That is a §8 report item.

Had a table been added from the committed
`validation/m60/lua/grammar-inventory.json` **as it stood**, it would have been
wrong on three of its four rows. The artifact computed
`instrumentASettlesIt: present.length === 0`, which asks "did any of these node
types appear in the corpus?" — and for three of the four types that is a question
about the grammar's vocabulary, so the answer is `true` whatever the corpus
contains:

| Type | old `instrumentASettlesIt` | correct | why |
| --- | --- | --- | --- |
| `implements` | true | **true** | no type declaration exists in Lua at all |
| `overrides` | true | **false** | a redefinition IS a second `function_declaration`; the grammar expresses it and cannot express its absence |
| `instantiates` | true | **false** | `Table:new(...)` is an ordinary `function_call` |
| `extends` | true | **false** | `setmetatable(D, B)` is an ordinary `function_call` |

So the gate would have reported `extends` and `instantiates` RULED-SOUND and been
contradicted by this lane's own 171 and 122 emitted edges, and it would have
reported `overrides` RULED-SOUND on a corpus where the ruling is false — which is
the exact failure the gate exists to prevent. The artifact now carries
`silentByConstruction`, `nodeTypesAbsentInCorpus` (the honest arithmetic) and
`instrumentASettlesIt` separately, plus `instrumentThatSettlesIt` and a `why` per
row.

## 4. Defects found by measuring rather than reading

### LUA-46 — a WRITE was published as a READ. 14,833 edges.

`emitMemberRead` excluded an assignment target with

    pt === "assignment_statement" && this.isSameNode(parent.namedChild(0), node)

but the wired grammar puts every target inside a `variable_list`. Measured on the
tree (`script/m60/lua-grammar-shape.ts`), `a = 1` parses as

    assignment_statement {name=identifier}
      variable_list {name=identifier}
        identifier "a"
      =
      expression_list
        number "1"

so a target's **parent is `variable_list`** and `namedChild(0)` of the
assignment_statement is that variable_list, never the target. The exclusion was
**dead code on every write in the language**. The method's own doc comment already
claimed "a member ASSIGNED TO is a write" — a comment asserting a behaviour is not
evidence that it exists, which this lane has now got wrong twice (LUA-30, and
here).

**Measured population**, 3,252 files: 84,354 assignment targets, of which 69,521
are bare identifiers (correctly not published) and **14,833 are qualified names**.
Each of those 14,833 published a `references` edge for a member that was written
and never read — `memberlist_protocol.fields = 1` at
docker/contrib/wireshark/memberlist.lua:41, `pinfo.cols.protocol = proto` at :126.
That is **6.9% of the 214,155 member-shaped nodes in the corpus** stating a read
that does not exist, and 4,461 of them duplicate a read of the same member on the
right-hand side of the same statement.

Reproduce: `npx tsx script/m60/lua-write-as-read.ts --full`.

### LUA-47 — a READ was published TWICE. 8,041 edges on a 400-file draw.

`emitNameRead` excluded `namedChild(0)` of a dot/method index expression, which is
the **RECEIVER**. The **FIELD** is `namedChild(1)` and also reached `uses`, while
`emitMemberRead` published the same member as `references` and `processCall`
published it as `calls`. One access, one span, two labels:

    local v = tbl.member      ->  uses -> member   AND  references -> member
    tbl:method()              ->  uses -> method   AND  calls      -> method
    local v = tbl.inner.member -> uses -> inner, uses -> member,
                                  references -> inner, references -> member

**Measured**, 400 corpus files: **8,041** member edges carry both a `uses` and a
`references` edge for the same member on the same line — **26.07%** of the corpus's
`uses`+`references` member edges. Corpus-wide the fix removes **77,874 `uses`
(−58.8%)** and **4,659 `references` (−10.5%)**.

Reproduce: `npx tsx script/m60/lua-uses-references-double-publish.ts --cap 400`.

**Why a green suite did not catch either one.** `lua/name-reads` is the fixture
that claims to pin this pair, and its forbid rows name `config` and `helper` —
both **RECEIVERS**. There is no row for `uses -> retries` or `uses -> record`,
which are both **FIELDS**, and no row for a write at all. The doc's §5 table said
"the head of a qualified name is not read on its own account; pinned for `config`
and `helper`" — true, and about the head. A suite that pins the head of a
qualified name and says nothing about its tail is green on a double publication of
the tail. `validation/m14/fixtures/lua/read-classes` now forbids all of those
cases, and `script/m60/mutate-lua-read-classes.ts` reinstates each defect in turn
and requires the suite to go red.

### The reserved-word class looks identical to bash's fabrication and has the opposite verdict

The BASH lane measured 30 `calls` edges whose target was a POSIX reserved word
(`fi`, `then`, `elif`) and **every one was a fabrication** — tree-sitter's error
recovery reads a keyword as a `command_name`. Lua's audit found 50 reserved-word
endpoints, which is the same shape. It is not the same defect.

Measured with an independent tree walk that shares no rule table with the analyzer
(`script/m60/lua-endpoint-attribution.ts`): **114 reserved-word occurrences across
35 files, of which 111 are a `string` node in the `field` position of a
`bracket_index_expression`** — a real member name written with bracket syntax —
and **3 are bare `identifier`s inside an `ERROR` node**. `references -> function`
is `kong/kong/llm/drivers/anthropic.lua:120`, `if v['function'] then`.
`calls -> true` is `plenary.nvim/tests/plenary/context_manager_spec.lua:94`,
`assert.is["true"](entered)`. Both state a fact the source writes. **111 of 114
(97.4%) are true; the fabrication signature is 3 occurrences, and this lane does not
claim them as fabrications because the edges are still true readings of text the
file contains.** The cost is that a reserved word can never resolve to a symbol,
which is a resolution fact and is in the table in §6.

### Two corpus files are not Lua, and the analyzer edges their bytes honestly

`plenary.nvim/scripts/vararg/rotate.lua` is a **Jinja template with a `.lua`
extension** — `{% for n in range(1, amount) %}`, 16 ERROR nodes. Every edge on its
lines 10–12 is derived from template syntax: `uses -> for`, `uses -> in`,
`calls -> range`, `calls -> A`, `references -> last`, `uses -> endfor`. The
analyzer parsed the bytes it was given correctly; the file is not the language.
Making the analyzer Jinja-aware would be a fabrication in the other direction, so
this is a **disclosure, not a fix**: 4 files of 3,252 carry a root-level ERROR
(`kong/spec/fixtures/invalid-module.lua`,
`nvim-treesitter/tests/indent/lua/{cond,func}.lua`, and `rotate.lua`).

### A probe that was measuring half the grammar

The first version of the attribution probe read only `identifier` nodes and
reported 3 reserved hits against the audit's 51 reserved-word **edges**. That was
not a contradiction of the analyzer; the probe was blind to `v['function']`, whose
name is carried by a `string` node. Fixed, and the fixed probe now reports both
node types separately so they are never summed into one claim. Recorded because a
probe that under-reports is more dangerous than one that over-reports: the
disagreement looked like an analyzer defect and was a defect in the instrument.

### A hypothesis of mine that the corpus falsified

Before looking at the tree I expected Lua's multi-target assignment
`a, b = b, a` to publish the second target as a `uses` edge, on the reading that
`namedChild(0)` only covers the first. **Falsified**: the corpus contains **0
multi-target assignments among 84,354 targets**, and the tree puts every target in
a `variable_list`, so `emitNameRead`'s existing `variable_list` exclusion covered
assignment targets all along. The fixture pins the shape anyway, from the contract,
because no fixture derived from real code can reach it — and that turned out to
carry the LUA-46 mutant (§7).

## 5. `parseFile` is not deterministic: 12 named files

Two runs over a **provably identical draw** (`drawDigest c990daa339a9…`, 3,252
files), sharded into 8 fresh processes so WASM state cannot accumulate across
shards — which is the mitigation the aggregate recommends, and it is **not
sufficient**:

| | run 1 | run 2 | delta |
| --- | --- | --- | --- |
| symbols | 83,585 | 83,381 | −204 |
| relationships | 218,547 | 217,979 | −568 |
| `uses` | 54,562 | 54,374 | −188 |
| `references` | 39,886 | 39,807 | −79 |
| kindless symbols | 33 | 37 | +4 |

`script/m60/lua-nondeterminism.ts` records a per-file digest and runs the same
shard twice, which turns the corpus-wide delta into a **named file set**:

> **12 of 3,252 files (0.37%) differ between two passes, and 12 of 12 differ
> because one pass returned pool-worker's regex `extractFallback` output and the
> other parsed normally.** A fallback file contributes **0 symbols and 0
> relationships** — it is not wrong, it is *absent* from the graph for that run.

The 12: `hledger/tools/pandoc-drop-toc.lua`,
`hledger/tools/pandoc-drop-html-blocks.lua`,
`kong/spec/02-integration/05-proxy/31-stream_tls_spec.lua`,
`kong/spec/02-integration/05-proxy/32-query-params_spec.lua`,
`kong/spec/fixtures/custom_plugins/kong/plugins/tcp-trace-exporter/handler.lua`,
`kong/spec/fixtures/custom_plugins/kong/plugins/tcp-trace-exporter/schema.lua`,
`luarocks/src/luarocks/fetch/git_file.lua`,
`luarocks/src/luarocks/fetch/git_http.lua`,
`nvim-lspconfig/lsp/earthlyls.lua`, `nvim-lspconfig/lsp/elixirls.lua`,
`nvim-treesitter/tests/indent/lua/string.lua`,
`nvim-treesitter/tests/indent/lua/table.lua`.

Mechanism: `pool-worker.ts:1148` catches a grammar-load failure and returns
`extractFallback`'s output as `{success: true, errors: [], fallback: true}`. It
fires under concurrency with `Incompatible language version 0. Compatibility range
13 through 15.` **Not fixed here** — `pool-worker.ts` is shared (§8).

**The nondeterminism floor is the instrument this pass used as its control.** The
labels the LUA-46/47 fix does not touch move by ±0.1% between runs — `calls`
+51 in one direction and −63 in another, `contains` +50 and −89 — while `uses` and
`references` moved by 58.8% and 10.5%. The fix's effect is two orders of magnitude
outside the noise, which is the only reason it can be claimed as an effect at all.

## 6. The six questions, per emitted type

**Exists / Fires.** Settled by construction for all nine: each has a producing rule
and a non-zero count over 3,252 files. `implements` is RULED (§3.2).

### Correct — there IS an oracle, and its blindness is structural

Wave 1's document stated "there is NO independent lua oracle". **That was false and
contradicted the repository's own committed artifacts.** `script/m60/lua-truth-oracle.ts`
is 1,418 lines, derives truth from the wasm **parse tree** rather than from the
analyzer's output, diffs two directions over a real corpus, and ships results at
`validation/m60/results/lua-truth-oracle-{kong-400,luvit}.json`. It is standalone
rather than a `lang === "lua"` case in `differential.ts` because that file is
shared and 14k lines.

Measured on kong, 150 files through the direct path:

| label | truth | observed | missing | unexplained | recall |
| --- | --- | --- | --- | --- | --- |
| `calls` | 6,849 | 6,849 | 0 | 0 | 1.0 |
| `contains` | 9,622 | 9,623 | 0 | 1 | 1.0 |
| `extends` | 64 | 64 | 0 | 0 | 1.0 |
| `instantiates` | 8 | 8 | 0 | 0 | 1.0 |
| `imports` | 1,029 | 1,029 | 0 | 0 | 1.0 |
| `exports` | 590 | 1,184 | 0 | 0 | 1.0 |
| `uses` | **0** | 9,720 | — | 9,720 | — |
| `references` | **0** | 6,644 | — | 6,644 | — |
| `overrides` | **0** | 3 | — | 3 | — |

**The oracle derives no truth for `uses`, `references` or `overrides`** — the three
types wave 1 added — so it scores them as agreement-by-absence. The decisive test
is to run it against the defective analyzer:

| analyzer | SPURIOUS | per-label verdict for the 6 covered labels |
| --- | --- | --- |
| pre-fix (LUA-46/47 present) | 11,278 | identical |
| post-fix | 7,009 | identical |

The aggregate moved by 4,269 — the LUA-46 writes — and the oracle **reported the
same per-label verdict for every label it covers**, because the defect lives in the
three labels it does not derive. **An oracle whose coverage stops where the newest
code starts cannot audit the newest code.** That is the workstream's named failure
mode ("both say nothing, and nothing agrees with nothing") reproduced inside a
single lane, and it is the strongest available statement of the oracle's limit: a
grammar bug shared by both paths is invisible to both, and here the *coverage* gap
is invisible too.

### Labelled — the confusable pairs and the rule that separates them

| Pair | Separation | Pinned at |
| --- | --- | --- |
| `uses` vs `references` | a qualified access's FIELD is `references`; only a BARE name is `uses`. `uses` `labelShape` is `{bare: 54,562}` corpus-wide | `lua/read-classes` |
| `uses` vs `calls` | a callee member is `calls`, under either spelling | `lua/read-classes` |
| `uses` vs `contains` | a `variable_list` child binds a name; a `parameters` child binds one | `lua/read-classes`, `lua/name-reads` |
| `uses` vs a table key | a `field`'s key is a declaration site | `lua/name-reads` |
| `references` vs a WRITE | an assignment target is in a `variable_list` and is not a read | `lua/read-classes` |
| `references` vs `calls` | a member that is called is not merely read | `lua/read-classes` |
| `references` vs a computed index | `tbl[key]` has no member name; `tbl["key"]` does | `lua/read-classes` |
| `exports` vs a value | `return "literal"` publishes nothing | `lua/export-edges` |
| `overrides` vs `extends` | one member shared or not; `Derived.stop` is pinned as NOT an override | `lua/override-shapes` |
| `overrides` vs a metatable | `mt` is a metatable, not a base | `lua/override-shapes` |

### Resolved — per type, plus the population the rate cannot see

Resolution here is **name-based** against the symbols of the file's own tree, which
is the limitation wave 2 raised: a name carried by two symbols in one file scores as
resolved. So the last two columns are the population the rate is blind to.

| Type | Edges | Both ends resolve | Source | Target | Target ambiguous by name | of edges |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | 55,028 | **45.2%** | 25,069 | 54,788 | 16,028 | 29.1% |
| `extends` | 171 | **36.3%** | 108 | 117 | 2 | 1.2% |
| `uses` | 54,562 | **22.6%** | 17,667 | 39,526 | 14,654 | 26.9% |
| `overrides` | 66 | **18.2%** | 12 | 65 | **64** | **97.0%** |
| `instantiates` | 122 | **18.0%** | 22 | 122 | 2 | 1.6% |
| `calls` | 57,057 | **9.9%** | 14,387 | 16,742 | 2,523 | 4.4% |
| `references` | 39,886 | **4.7%** | 8,564 | 9,427 | 2,735 | 6.9% |
| `imports` | 6,547 | **0.4%** | 163 | 673 | 24 | 0.4% |
| `exports` | 5,108 | **0.1%** | 4 | 1,764 | 334 | 6.5% |

The CSS `references` reference point is 66.8% at both ends; lua's `references` is
4.7%. Three measured causes, none fixable by reading the tree harder:

1. **`global` is not a symbol.** Every file-scope edge is sourced from `global`,
   which is a scope label. That is most of `contains` at 45.2% despite 54,788 of
   55,028 targets resolving, and all of `exports` at 4 resolving sources of 5,108.
   The convention is pre-existing and load-bearing for `imports` and `calls`.
2. **Lua reads the standard library, not the file.** `string.format`,
   `table.insert`, `math.floor`, `ipairs`, `pairs` are members and functions whose
   declarations are in the C runtime and in no `.lua` file in the corpus. That is
   most of `references` and `calls`.
3. **`require` returns a name no file declares.** `imports` targets a module-path
   string; the module's own file declares symbols, not the path.

**Two populations a rate cannot see, both measured:**

- **Name collisions.** `overrides` resolves 65 of 66 targets, and **64 of those 66
  are ambiguous** — more than one symbol in the file carries the target name. The
  18.2% rate reads as a small shortfall; the truth is that 97% of the edges that
  "resolve" resolve to a name that denotes several symbols. `contains` is 29.1%
  and `uses` 26.9% on the same measure. A rate that is neither 100 nor 0 is hiding a
  population.
- **Sources that are not callable.** Of the `calls` edges whose source resolves,
  15,283 resolve: **14,377 to a `function`, 259 to a `method`, and 647 to a
  `variable`.** A `variable` is not itself callable, and whether it holds a
  function is written nowhere — 4.2% of resolved call sources. This is the shape
  the aggregate reported for zig (0.49% of named call sources not callable, hidden
  because the census resolves by name); lua's population is nearly ten times larger.

### Confident

`evidenceClass` and `metadata.relationshipType` are on **every analyzer-produced
edge**. Confidence distribution, whole corpus:

| Type | confidence | evidenceClass | relationshipType |
| --- | --- | --- | --- |
| `calls` | 1.0 × 57,049; 0.5 × 7; 0.4 × 1 | `structural` 57,049; **absent 8** | **absent 57,057** |
| `uses` | **0.9 × 54,562** | `usage_contextual` 54,562 | `lua_name_read` 54,562 |
| `references` | **0.9 × 39,886** | `import_based` 39,886 | `lua_member_read` 39,886 |
| `contains` | 1.0 × 55,028 | `structural` 55,028 | absent |
| `exports` | 1.0 × 5,108 | `structural` 5,108 | `lua_module_return` 5,108 |
| `imports` | 1.0 × 6,547 | `import_based` 6,547 | `lua_require` 6,547 |
| `extends` | 1.0 × 171 | `structural` 171 | `lua_metatable` 171 |
| `overrides` | 1.0 × 65; **0.95 × 1** | `structural` 66 | `lua_redefinition` 65; `lua_inherited_member` 1 |
| `instantiates` | 1.0 × 122 | `structural` 122 | `instantiates` 122 |

**Zero analyzer edges below 0.7.** The 8 sub-1.0 `calls` edges (0.4, 0.5) are
pool-worker's regex fallback, not this analyzer — they are the only edges in the
corpus with `evidenceClass: absent` and they are tallied apart in every artifact
(`fallbackFiles`, `fallbackEdges`). **Heuristic ratio: 54,562 + 39,886 = 94,448 of
218,547 = 43.2% at 0.9**, every one of them carrying `usage_contextual` or
`import_based` as the honesty contract §4 requires. The 0.9 is not a hedge: the
node proves a name is READ and the BINDING it denotes — local, upvalue, global,
stdlib, or a field of a module this file never read — is written nowhere.

`contains` and `calls` carry no `metadata.relationshipType`. That is not an
omission of a reason code: both are 1.0, and §4 requires a reason code for
anything **below** 1.0.

## 7. DERIVATION findings: 3, not 9 — and the correction is itself a finding

A DERIVATION finding is a type the analyzer emits that no differential audits.
Wave 1 reported **9 of 9**. That number was right about the shared harness and
wrong as a statement about the lane:

- `script/m14/differential.ts`'s `LANGS` has no `lua` entry, so
  `--lang lua` measures 0 lanes. Against the **shared** differential, all 9
  emitted types are unaudited.
- The standalone oracle audits **6 of the 9** at recall 1.0 (§6, Correct).
- The **3 that remain unaudited by anything** are `uses`, `references` and
  `overrides` — exactly the 3 wave 1 added. Two of the two defects this pass found
  (LUA-46, LUA-47) live in those three labels, and the oracle scored both runs
  identically.

So: **9 DERIVATION findings against the shared differential, 3 against all
instruments combined.** The residual debt is `uses`, `references`, `overrides`, and
closing it needs truth derivation for those three in `lua-truth-oracle.ts` — which
is this lane's file and is doable, or a `LANGS.lua` entry plus a baseline row in
`script/m14/differential.ts`, which is shared (§8).

**Mutation.** `script/m60/mutate-lua-read-classes.ts` — 2 mutants, **2/2 caught**,
restore clean:

| Mutant | Defect reinstated | Caught by |
| --- | --- | --- |
| LUA-46 | `assignment_statement`/`namedChild(0)` in place of the `variable_list` exclusion | `forbidRelationships references -> a L80`, `references -> b L80` |
| LUA-47 | receiver-only rule, field exclusion removed | 7 rows: `uses -> member L42`, `uses -> inner L47`, `uses -> callee L52`, `uses -> plain L55`, `uses -> a L80`, `uses -> b L80`, `uses -> other L84` |

Recorded because it is not obvious: **LUA-46 is caught by exactly two rows, and
not by the `references -> member L71` / `references -> inner L75` rows**, because
`member` and `inner` were already published at L42 and L47 and `addRelationship`
dedupes on type+source+target, so the write's edge never reaches the store to be
compared. Those rows are correct contract rows that cannot fail on this file; the
two L80 rows carry the mutant. That is why the multi-target shape is pinned even
though the corpus contains none of it. `mutate-lua-node-identity.ts` (wave 1's) is
still caught, 8 forbid rows.

## 8. Declared limitations

Lua is Turing-complete and dynamically typed. For a language in that class a blank
limitations list would be a defect, so these are the specific things this analyzer
does not do, each with its number.

1. **Every count in this document is a single-run observation.** §5 names the 12
   files that are absent from the graph in any given run. A rerun will differ by
   roughly ±0.25% on relationships. The digest is published so a reader can tell
   whether two runs used the same draw; it cannot make the run deterministic.
2. **3 types have no oracle.** `uses`, `references`, `overrides` are derived by the
   analyzer and compared against nothing (§7). Both defects this pass found are in
   that unaudited set, which is the strongest argument for closing it.
3. **A binding is not derivable.** `uses` fires on a bare name read; which binding
   that name denotes is written nowhere. Hence 0.9, `usage_contextual`, and 22.6%
   both-ends resolution.
4. **A reserved word can be a real name and can never resolve.** 111 bracket-literal
   keys corpus-wide (`v['function']`, `assert.is["true"]`) produce correct edges
   whose target no symbol can ever carry. 50 such edges reach the graph.
5. **4 of 3,252 corpus files are not parseable Lua**, one of them a Jinja template
   with a `.lua` extension whose edges are derived from template syntax (§4). The
   analyzer is not making the language more tolerant of this, on purpose.
6. **`setmetatable(self, …)` is not resolved.** 45 sites across 42 files
   (B8 `derivedIsSelf`). The derived table is only reachable by evaluating the
   constructor. This is why `lua_inherited_member` measures 1 edge against 79
   inheritance links.
7. **An expression base is not resolved.** 374 sites across 218 files
   (B8 `unresolvedBase`), e.g. `setmetatable(opts or {}, defaults)`. No name is
   written, so no edge target could be.
8. **Inheritance is a convention, not a keyword.** `extends` and `overrides` read
   `setmetatable`/`__index`. A table that inherits by another runtime mechanism — a
   C library's metatable, `middleclass`/`class()` from a third-party module — is not
   seen. `class("Name")` calls are recognised as a class DECLARATION (a symbol) but
   the library's own inheritance convention is not inferred.
9. **The module surface is only what a chunk-scope `return` names.** Four shapes
   carry no written name and stay silent, disclosed in `ctx.unpublishedSurface`:
   `return require("x")` (a re-export), `return "literal"`, `return function() end`,
   and a positional `return {1,2}`. Naming any of them would mean inventing a name.
10. **Aliasing and metaprogramming are invisible.** `local alias = M.run` then
    `alias()` is a `calls` edge to `alias`, not to `M.run`. Same for
    `for k, v in pairs(M)` and any table key read through a computed index.
11. **No module identity, and no cross-file resolution.** A Lua chunk is not a
    module, so file-scope edges are sourced from `global` and no symbol is named
    after the file. Every endpoint is resolved against the symbols of its OWN file,
    which is why `imports` sits at 0.4%. Both are deliberate refusals to fabricate
    rather than gaps.
12. **`overrides` rests on 66 edges in 38 files**, of which 65 are redefinitions and
    1 an inherited member. A number that small does not support a strong claim, and
    97% of its targets are name-ambiguous (§6).
13. **The suite's own reach is bounded.** `script/m14/run-fixtures.ts` **exits 0
    without executing any fixture** for `lua`, because its lane gate refuses `lua`
    for having expectation files with no runner lane in `LANGS`. This lane's 10
    fixtures and 167 assertions only run under `script/m60/run-lua-fixtures.ts`.
    Reporting a lane's fixture suite as passing without naming the runner would be
    reporting a number from a script that executes nothing.

## 9. Verification

| Gate | Command | Result |
| --- | --- | --- |
| Lane fixtures | `npx tsx script/m60/run-lua-fixtures.ts` | **10 fixtures, 167 assertions, 0 failing** |
| Mutants (wave 2) | `npx tsx script/m60/mutate-lua-read-classes.ts` | **2/2 caught**, 11 failing rows, restore clean |
| Mutants (wave 1) | `npx tsx script/m60/mutate-lua-node-identity.ts` | caught, 8 forbid rows, restore clean |
| Types | `npx tsc --noEmit -p tsconfig.json` | clean |
| Doc-truth emissions | `bun run script/m14/verify-doc-truth-emissions.ts` | **0 findings for lua** (was `NO_CLAIM_TABLE`). The gate as a whole still exits 1 on 7 FALSE_NEGATIVE and 40 UNDOCUMENTED belonging to other lanes |
| Honesty gate | `bun run script/m14/verify-honesty.ts` | 22 failures, **none naming lua**; all are the pre-existing shared freshness defect (`freshness rule flags every artifact`) |
| Ontology arbiter | `npx tsx script/m14/ontology-coverage-gate.ts lua` | **exit 2, refuses to report** — no `RULED_BY_LANG.lua` (§3.3) |
| Shared differential | `npx tsx script/m14/differential.ts --lang lua` | 0 lanes; no `LANGS.lua` |
| Shared fixtures | `npx tsx script/m14/run-fixtures.ts` | executes nothing for `lua` (limitation 13) |

Instruments, each committed and each independent of the analyzer's rule table:

| Script | What it measures |
| --- | --- |
| `script/m60/lua-wave2-audit.ts` | the census. Sharded, with a `drawDigest` so two runs are comparable on a *provable* draw. `--shard i/8` then `--merge` |
| `script/m60/lua-nondeterminism.ts` | per-file digests over two passes, naming the files that differ |
| `script/m60/lua-write-as-read.ts` | LUA-46's population: assignment targets by shape, and genuine member reads |
| `script/m60/lua-uses-references-double-publish.ts` | LUA-47's population: `uses`/`references` pairs on the same member and line |
| `script/m60/lua-grammar-shape.ts` | the parse-tree shape behind each exclusion, printing tree AND edges per case |
| `script/m60/lua-endpoint-attribution.ts` | reserved-word and literal endpoints by node type and role, with `insideError` |
| `script/m60/lua-grammar-inventory.ts` | instrument A: the 100 node types, and per-type `silentByConstruction` |
| `script/m60/lua-edge-where.ts` | attributes one edge to the source line that produced it |
| `script/m60/lua-truth-oracle.ts` | the independent oracle (§6) |
| `validation/m60/lua-trace.sh` | the two-run determinism comparison, end to end |

**Complexity.** One iterative AST walk, plus three whole-file pre-passes
(`collectErrors`, `collectDeclaredTables`, `collectSupertypeLinks`). Relationship
identity uses a set; declaration, owner and member decisions read the current frame
and pre-pass maps. No per-symbol scan of the symbol or relationship arrays and no
O(n²) resolution path. The two fixes added one parent-type test each and no new
traversal: `emitMemberRead` gained one `if`, `emitNameRead` split one `else if` into
two branches. An analyzer regex census reports **0 regexes** in
`real-lua-analyzer.ts`; every rule reads the AST.

## 10. Symbols

83,585 symbols over the 3,252-file draw: **74,556 `variable`, 4,788 `method`,
4,208 `function`, and 33 with kind `undefined`** — all 33 from pool-worker's regex
fallback (§5), none from the analyzer. **0 empty names.**

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `local name = value` | `variable` | `variable_declaration` -> `assignment_statement`, simple identifier |
| `name = value` | `variable` | module-level `assignment_statement`, simple identifier |
| `function name(...)` | `function` | `function_declaration` whose name field is an identifier |
| `function Table.method(...)` | `method` | name is a `dot_index_expression`; the table is the owner |
| `function Table:method(...)` | `method` | name is a `method_index_expression`; the table is the owner |
| `local function name(...)` | `function` | the same declaration carrying a `local` token |
| table-valued declaration | `variable` with table metadata | RHS is a `table_constructor`; field keys come from AST fields |
| `class("Name")` | `class` | a library class declaration call |

Function parameters retain identifier/vararg information; ranges are byte-precise
from the declaration node. Function-local variables are emitted as scoped
variables; parameters, anonymous function expressions, field/index mutations and
local reassignments are not declarations. No synthetic Love2D hooks, anonymous
coroutine symbols, or anonymous table classes are generated.