# `exports` vs `contains` — the ontology ruling

**Question.** Must an exported name be answered by a SYMBOL, or is `contains` membership
sufficient? `script/m14/run-fixtures.ts:1541` enforces the first reading on every fixture in
every language — "every export name must resolve to a TOP-LEVEL symbol — bare member names are
not importable; membership rides Contains" — and lua's `export-edges` and `export-shapes`
fixtures fail it:

```
$ bun run script/m14/run-fixtures.ts --lang lua
FAIL  lua/export-edges
      - export invariant violated: export(s) ["greet","farewell"] do not resolve to a top-level
        symbol (membership rides Contains)
FAIL  lua/export-shapes
      - export invariant violated: export(s) ["fromDoBlock","fromLoop","alpha","beta","gamma",
        "nested"] do not resolve to a top-level symbol (membership rides Contains)
```

**Ruling in one line.** `contains` is MEMBERSHIP, `exports` is the PUBLISHED SURFACE, and an
export name must NOT be required to resolve to a symbol: the invariant is keyed on LANGUAGE
where its own rationale is keyed on ROLE, and the role it refuses for lua is the role it
already ADMITS for JavaScript, in the same tree, today.

---

## 1. What the family already decided, and what they have in common

| lane | decision | instrument and counts |
|---|---|---|
| **fsharp** | **IMPLEMENTED** (FS-D13) | "the FS-D8 importable-unit set"; `contains` is **MEMBERSHIP**, `exports` is the **IMPORTABLE-UNIT SET**. Overlap priced, not hidden: of 2,143 OWNED surface entries, **2,143 (100%)** are pairs `contains` already carries, plus 392 file-scope module/namespace headers `contains` cannot carry at all. Gate: 847 edges, 820 resolved (96.8%), 27 ambiguous, 0 unresolved. |
| **json** | **IMPLEMENTED**, after a grammar ruling was removed | ruled out on a grammar inventory ("no `export_statement` node"), then EMITTED — a manifest publishes through ordinary keys (`exports`/`main`/`bin`); 37 edges on a 400-file stride. Its lesson is quoted by three other lanes: *"an inapplicability ruling is only as strong as the instrument that could have found the construct."* |
| **lua** (its own spec, BD-exports) | **IMPLEMENTED**, after the same removal | "`exports` was ruled inapplicable, which was true of the RELATIONSHIP and false of the FACT — the analyzer was already publishing 5,167 export names into `result.exports`". Now 5,167 edges in 2,137 files. |
| **sql** | RULED inapplicable | instrument A: 0 of 480 node types. "SQL's visibility scope is the DATABASE, and nothing in a SQL file enumerates what it publishes." |
| **toml** | RULED inapplicable | measured string population: 144 export-ish keys in 65 files, and they are crates.io's `publish = false`, Gradle's `include(...)`. "Every key in a TOML document is readable by a consumer that knows the dialect, so treating them all as exports would restate `contains` and assert a visibility TOML does not have." |
| **xml** | RULED inapplicable | instrument A plus a measured string population: 611 `export`-named elements are gtk-doc/Doxygen documentation payload. *"The surface that would carry an `exports` edge already exists and is measured: every symbol a document publishes is reachable as a `contains` target, and `contains` resolves at BOTH ends on 100.0% of its 77,721 edges."* |

**What they agree on.** `exports` names a PUBLISHED SURFACE — the set of names a consumer of
the unit can reach — and it is NOT membership, which is `contains`. Emitted where the language
has an enumerable publishing surface (fsharp's module surface, json's manifest keys, lua's
chunk `return`); ruled out where it has none (sql, toml, xml), and the xml row's proof is that
the surface is already reachable as `contains` targets. **Where they do not speak:** no family
decision says whether a published-surface NAME must itself be a symbol. That is the gap lua
walked into.

## 2. What lua's edges actually name, with counts

```
$ npx tsx script/m14/incoming-gate.ts lua lua 60
exports       87       26        9          1          52   (edges / resolved / amb(decl) / amb(kind) / unresolved)
TABLE 2 (pooled corpus): exports 87 28 18 41
```

Scope: a 60-file even stride over the whole lua population (3,250 `.lua` files across 19
repos), project-scoped resolution. So of lua's 87 `exports` edges:

* **26 resolve to exactly one declaration**, 9 are ambiguous, **52 name nothing in their own
  project (60%)**;
* of those 52, **11 are declared in another repository** of the corpus (project 52 vs pooled 41)
  and **41 are declared nowhere in the lua corpus at all**;
* **0 are "names that exist only as members."** A member symbol IS a declaration to the key
  space, so a member-named export resolves or is ambiguous; it can never appear in the
  unresolved column. Measured over the whole fleet below, `MEMBER` is 0 export names anyway.

The names are **keys of a returned table literal** — lua's module surface is the chunk's
`return`, emitted with `relationshipType: "lua_module_return"`. The concrete shape, from
`kong/db/schema/entities/routes_subschemas.lua`:

```lua
return {
  http = http_subschema, https = http_subschema, tcp = stream_subschema,
  tls = stream_subschema, udp = stream_subschema, tls_passthrough = stream_subschema,
  grpc = grpc_subschema, grpcs = grpc_subschema,
}
```

`http`, `https`, `tcp`, … are real module properties — a consumer writes
`require("…routes_subschemas").http` — and **no symbol is named `http`**, because a table key
is not a declaration in Lua. Elsewhere on the same draw the no-symbol names are `name`,
`fields`, `entity_checks`, `PRIORITY`, `VERSION`, `/status` (Kong's returned schema tables).
At the kong-only 40-file draw: **39 export entries, 30 answered by a symbol, 9 not** (23%);
at the corpus-wide 60-file draw the gate reads 60% unresolved.

The two failing fixtures are the same two shapes:

| fixture | name | what answers it |
|---|---|---|
| `export-edges` | `greet`, `farewell` | a symbol EXISTS (`kind: method`, `ownerName: "M"`, and `M` is a `variable`) — the name is a key of the returned table that happens to collide with a member |
| `export-shapes` | `fromDoBlock`, `fromLoop`, `alpha`, `beta`, `gamma`, `nested` | **no symbol at all** — keys of a returned table literal |
| `export-shapes` | `handler`, `positional` | chunk-scope locals — **TOP-LEVEL**, the invariant admits them |

## 3. Who consumes `exports`, and what breaks

| consumer | what it does with an `exports` edge |
|---|---|
| `src/intelligence/patterns/orphans.ts:77` | `NON_USAGE_TYPES = ["contains", "exports"]` — an export **never** makes a symbol "used" |
| `src/intelligence/analysis/complexity.ts:30`, `project-stats.ts:25`, `contracts.ts:195,621` | excluded from coupling / dependency metrics — *"`exports` and `contains` are index bookkeeping, not dependency"* |
| `src/intelligence/graph/graph-engine.ts:120` | `exports: 8` in `EDGE_KIND_PRIORITY`, second to last (only `contains` below it): module-level, not a dependency |
| `src/intelligence/edit/edit-engine.ts:799` | the aliased-import shape produced *"1 edge → `exports` ONLY"* and the engine **explicitly did not trust it**; it consults `brain_import` instead |
| `src/ast/parallel-indexer.ts:4297-4305` | the store's "defensive export filter" guards the **SOURCE** (private/protected/dot-named), not the target; the target binds by the ordinary qualified-name / unique-bare-name rule |

**Measured conclusion:** no consumer binds an `exports` TARGET to a symbol. The only place an
export name is required to resolve is the incoming arbiter's own resolution metric — and a graph
traversal simply has no endpoint when it does not. The cost of an unresolved export edge is
therefore real but narrow: it is the 52 in lua's `unresolved` column (2.3% of that lane's 2,222)
and it does not by itself decide any verdict.

## 4. The cost of each option, measured

The fleet census — `validation/m14/census/exports-ruling/export-name-status.ts`, which calls
the analyzer exactly as the runner does (`getParser` → `analyze(root, content,
"fixtures/<lang>/<file>")`) and applies the invariant's own admission rule verbatim:

```
$ npx tsx validation/m14/census/exports-ruling/export-name-status.ts --lanes=<47 lanes> --per=40
FLEET 1,400 files parsed (40-file even stride per lane; 34 lanes had a corpus present,
      13 checkouts are absent on this machine and are DECLARED, not measured)
TOTALS   export ENTRIES 17,655   top-level 17,469   MEMBER 0   NO SYMBOL 186
         export EDGES    3,924   top-level  3,440   MEMBER 0   NO SYMBOL 484
```

| lane | entries | top-level | MEMBER | no symbol | edges | no-symbol targets |
|---|---|---|---|---|---|---|
| JULIA | 203 | 66 | 0 | **137** | 201 | 136 |
| JAVASCRIPT | 44 | 12 | 0 | **32** | 44 | 32 |
| LUA (kong only) | 39 | 30 | 0 | 9 | 39 | 9 |
| ERLANG | 438 | 430 | 0 | 8 | 438 | 8 |
| FSHARP | 342 | 342 | 0 | 0 | 342 | **298** |
| MAKE | 108 | 108 | 0 | 0 | 108 | 0 |
| ZIG / CLEAN / R / GRAPHQL / HCL / SCSS / SOLIDITY / RUST / C / NIM / JSON / HCL / SCSS | — | all | 0 | 0 | — | 0 |
| the invariant's OWN family — JAVA_GRAILS / JAVA_GRAPHQLJAVA / GROOVY_GEB / KOTLIN_KX / SCALA_CATS / CSHARP_GQL | 305 | 305 | **0** | 0 | 461 | 0 |
| 13 lanes | 0 files parsed — corpus checkout absent, DECLARED | | | | | |

### Corrections to this table, stated rather than silently applied

Three things were wrong or missing when the table was first published, and the ruling's own
crux — `MEMBER` 0 — is one of them. All three are fixed above; the ruling does not change.

1. **The `MEMBER` reading was an artifact of the field read, and `MEMBER` 0 is the corrected
   one.** The first version of the probe walked `parseFile`, whose symbol rows rewrite
   `ownerName: s.ownerName || s.scope`; the invariant tests the analyzer's RAW `s.ownerName`,
   so an owner-less symbol read as owner-`"global"` and classified as a MEMBER. Measured: lua's
   62 entries read **top-level 0 / MEMBER 39 / NO SYMBOL 23** under the buggy read and
   **top-level 39 / MEMBER 0 / NO SYMBOL 23** under the corrected one (`analyze()` at
   `run-fixtures.ts:753`'s own call shape). The table above was built with the corrected probe
   and is now confirmed on 1,400 files: **MEMBER 0 after correcting the field read** — not a
   bare zero.
2. **The `make` lane was reported as a wiring error and excluded from the totals.** Its parser
   language is `make` and its analyzer file is `real-makefile-analyzer.ts`, and the lane table
   carried one field for both, so 47 real exports read as a zero. Re-derived: **40 files, 108
   entries, 108 edges, all top-level**. The first table's totals were therefore short by one
   lane: entries 17,242 → 17,655, edges 3,355 → 3,924 across all three corrections.
3. **The clause's own population was DECLARED ABSENT rather than measured.** The member clause
   exists for the JVM/C# family, and the five corpora its lanes name (`java-lib`, `kotlin`,
   `scala`, `groovy`, `csharp-sample`) do not exist on this machine — so the first table's
   `MEMBER 0` was a zero over lanes that never reach the clause. This machine DOES carry that
   family elsewhere in the corpus, and the re-derivation points the lanes at checkouts that
   exist, chosen by extension count: grails-core and graphql-java (`.java`, 200 each),
   kotlinx-coroutines (`.kt`, 200), cats-effect (`.scala`, 200), geb (`.groovy`, 200),
   gql-graphql-dotnet (`.cs`, 200). Measured: **305 entries / 461 edges, MEMBER 0.**

**`MEMBER` is 0 in every lane, INCLUDING the family the clause was written for.** The clause is
not vacuous: it is a regression guard whose violation is in the runner's own comment —
`java/groovy overloads emitted ["Svc","greet","greet"] before the JAD3/G3 member-export
reversal`. It reads 0 today because those lanes were FIXED, which is what a guard looks like
when it works. What is measured is that no lane on this population emits a member-named export,
so extending the ADMISSION beside it cannot collide with it.

**The cost figure does not move; the denominator does.** `NO SYMBOL` is **186 names / 484 edges**
in every one of the three readings (the first spliced table, the MAKE-corrected one, this
re-derivation). What moved is the population the share is taken against: 484/3,355 = 14.4% →
484/3,463 = 14.0% → **484/3,924 = 12.3%**.

**(a) Require a symbol.** Cost, measured by the same table: 186 export names and **484 export
edges** fleet-wide (484/3,924 = **12.3%**) would be refused or deleted. It is not a cleanup of lua alone — it
would delete **JavaScript's `plain`/`ref`**, which pass today (see §5) and be a **regression
against a documented, currently-green capability**; and it would delete lua's returned-table
surface, which the lane's own census says was 366 of Kong's 1,309 files and 33 of Luvit's 199
files publishing **nothing** before it existed. `exports` would then be emitted only where the
surface happens to be a symbol table, i.e. where `contains` already carries the pair (fsharp
prices that overlap at 100% of its owned entries).

**(b) Allow the role.** The two lua fixtures pass, 0 edges are deleted, and `MEMBER` stays 0, so
the invariant keeps its live clause intact. The price is stated rather than removed: the 484
no-symbol edges (52 for lua at the gate's draw) stay **unresolved against a symbol key space**,
because an `exports` edge currently publishes a *relationship* and not a *declaration*. Removing
that is a KEY-SPACE change — the export edge's own target admitted as a declaration — not an
analyzer change, and this ruling does not assume it.

## 5. The evidence that decides it: the same role is ALREADY admitted for JavaScript

```
$ npx tsx validation/m14/census/exports-ruling/export-name-status.ts --file=javascript:<repo>/validation/m14/fixtures/javascript/cjs-export-methods.js
EXPORT NAMES AND WHAT ANSWERS THEM
  run    TOP-LEVEL (no-owner)
  val    TOP-LEVEL (no-owner)
  plain  NO SYMBOL
  ref    NO SYMBOL

$ bun run script/m14/run-fixtures.ts --lang javascript
PASS  javascript/cjs-export-methods
summary: {"javascript":{"pass":74,"fail":0}}
```

`module.exports = { run(){}, val, plain, ref }` publishes four names; **two of them are answered
by no symbol**, and the invariant ADMITS them, because
`isJsModuleBinding` (`run-fixtures.ts:1531-1537`) accepts every export name in a file where any
entry carries `metadata.viaCommonJs` — the clause whose own comment reads *"CJS assignments
(`exports.x`, `module.exports.y`, `module.exports = {...}`) create live module properties
importable by name without a corresponding symbol. Both are bindings."*

That sentence describes lua's `return { http = …, grpc = … }` exactly. The rule is **the same
role**, admitted for `javascript|typescript|vue|svelte` and refused for `lua`, decided by
`lang ===` rather than by what the name is. A rule whose rationale is a role and whose code is a
language list is not a ruling; it is an accident of which lane hit it first.

## 6. The ruling

1. **`contains` is MEMBERSHIP; `exports` is the PUBLISHED SURFACE.** Both are needed and they
   are different relations: fsharp prices the overlap at 100% of its owned entries and still
   needs the label for the 392 headers `contains` cannot carry; xml rules `exports` out
   precisely because its surface is *already* `contains`; toml refuses it because publishing
   every key "would restate `contains`".
2. **An export name must not be required to resolve to a top-level symbol.** The requirement is
   language-keyed where its rationale is role-keyed, and the role it refuses for lua is admitted
   for JavaScript in the same tree and the same gate. The correct predicate is the ROLE:
   *a name a consumer of the unit can reach from the value it binds* — a module property.
3. **The admission set should be defined by that role, not by a language list.** Lua is the
   second member of the class; the JS family is the first. The clause stays: a name that is ONLY
   a member of a type is still refused — which is what the M49 invariant was written for and
   what has 0 hits fleet-wide at this draw.
4. **The unresolved column keeps its number.** An export name with no symbol cannot resolve
   against a symbol key space; lua reads 52 of 87 (60%) on the gate's own draw, and 41 of those
   are declared nowhere in the corpus. That is honest and priced. Making them resolve is a
   key-space decision (the export edge declares its own target), not something an analyzer can
   spell.
5. **This is not a licence to publish every key.** toml's and xml's rulings stand. Lua's own
   fabrication guards stay binding: positional entries publish nothing, a nested table publishes
   its own name only, and `return require("x")` / `return "s"` / `return setmetatable(...)`
   stay silent. The residual risk is named rather than hidden: under this ruling the fixture can
   no longer catch a lane that over-publishes table keys — at the kong draw 9 of 39 entries
   (23%) are no-symbol names, and `name`/`fields` are schema keys rather than surface names.
   That judgment moves to the lane's fixture (its `forbidExports` rows) where it belongs.

**The branch I did not take, and its cost.** If the ontology means instead that an `exports`
edge is a RESOLVABLE graph edge — a claim that a specific declaration is published — then the
change is the opposite: lua drops the returned-table-key surface *and* `javascript`'s CJS
exemption must be revisited in the same commit, because `module.exports = { plain, ref }` is
the identical shape and passes today. Measured, that branch removes 484 of 3,924 exports edges
fleet-wide (12.3%) and 186 export names, and it removes `exports` from every language whose
surface is a value rather than a symbol table — which is json's lesson repeating a fifth time.

## Recommendation

Rule that `exports` names a unit's published surface and that its target need not be a symbol;
extend the fixture invariant's admission from the `isJsFamily` language list to the ROLE it
already describes in its own comment ("live module properties importable by name without a
corresponding symbol"), so lua's returned-table keys are admitted exactly as `module.exports =
{...}` keys are; leave the member clause untouched because it has 0 hits fleet-wide and is the
only thing that stops a lane calling a type member an export; and record, without trying to
remove it, that such edges stay unresolved in the arbiter's symbol key space (lua 52 of 87 at
the gate's 60-file whole-corpus draw, 41 of them declared nowhere in the corpus) — since no
consumer binds an export target to a symbol, while making them resolve would require the key
space to admit an export edge's target as a declaration, which is a separate decision with its
own price.

## What would overturn this

* **A consumer that binds an `exports` target to a symbol for a correctness decision.** None was
  found: orphans and the coupling metrics exclude the type, the graph ranks it below dependency
  kinds, and `edit-engine.ts` explicitly does not trust it. If one appears, option (a) becomes
  the only sound reading.
* **A lane whose surface is a symbol table being over-published.** The ruling is about the
  ROLE, not about volume: if a value-module lane publishes a key that no consumer can reach,
  that is that lane's defect, and the census in §4 (`--lanes=… --per=N`) is the instrument that
  measures it.
* **`MEMBER` becoming non-zero.** The clause this ruling leaves untouched is the one the M49
  invariant was written for; a single member-named export would show it is live rather than
  vestigial.

## Reproduction

```
npx tsx script/m14/incoming-gate.ts lua lua 60
bun run script/m14/run-fixtures.ts --lang lua
bun run script/m14/run-fixtures.ts --lang javascript
npx tsx validation/m14/census/exports-ruling/export-name-status.ts --file=lua:<repo>/validation/m14/fixtures/lua/export-edges.lua
npx tsx validation/m14/census/exports-ruling/export-name-status.ts --file=javascript:<repo>/validation/m14/fixtures/javascript/cjs-export-methods.js
npx tsx validation/m14/census/exports-ruling/export-name-status.ts --lanes=BASH,FSHARP,ZIG,LUA,JULIA,NIM,PHP,POWERSHELL,R_LANG,DART,SQL,GRAPHQL,PROTOBUF,JSON_B,YAML,CSS_B,SCSS,HCL,MAKE,TOML_B,XML_B,MARKDOWN_B,CLEAN_B,JAVA_GRAILS,JAVA_GRAPHQLJAVA,GROOVY_GEB,KOTLIN_KX,SCALA_CATS,CSHARP_GQL,JAVASCRIPT,RUST,ERLANG,ELIXIR,C,SOLIDITY --per=40
```
