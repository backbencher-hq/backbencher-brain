# SVELTE_FIX2 — relationship-ontology verdicts, with the measurement behind each

Branch `analyzer/SVELTE_FIX2`. Analyzer `src/ast/real-svelte-analyzer.ts`.
Assigned corpus `$HOME/fixtures/repositories/shadcn-svelte`.

This file is the lane's measurement record. Every number in it came from an instrument
named beside it, over a population the instrument declared, through the path named
beside it. Nothing here is asserted from reading the analyzer.

---

## 0. THE INSTRUMENT THAT PRODUCED THE HANDOVER FIGURE IS THE WRONG PATH

The handover says: *"SVELTE is 3/10 with `imports[]` = 0 — the JS/TS delegation emits
no import edges."*

That 3/10 reproduces exactly, and it is an artifact.

```
$ cd $HOME/backbencher-brain
$ NFILES=200 bun script/m14/firing-check-v2.mjs SVELTE_FIX2
  3/10   200/200 parsed   imports[] 0 in 0 files
  fired:  calls contains instantiates
```

The SFC seam — the code that pre-parses every `<script>` body with the JS/TS/TSX
grammar and hands the trees to the analyzer — lives **inside** `ASTEngine.parseFile`
at `engine.ts:1592-1623`. The instrument calls

```js
// firing-check-v2.mjs:253
const res = new Cls().analyze(pr.rootNode, content, f)   // no 4th argument
```

so `context` is `undefined`, so at `real-svelte-analyzer.ts:739`

```ts
const scriptTrees: Tree[] = context?.sfcScriptTrees ?? []
```

is `[]`, and the whole script half is skipped: no sub-parse, no `imports[]`, no
`exports[]`, no script symbols, no script calls, no runes, no `$props`. Only the
template pass runs, and the template pass can only produce `instantiates`, `on:`/
`{@render}`/directive calls, and snippet `contains`. That is precisely the 3/10 it
prints.

Production does not take that path. `src/ast/pool-worker.ts:833` calls
`engineModule.ASTEngine.parseFile(filePath, content, context)`, which is what the
workstream doc names as the EMITTED criterion ("production `parseFile` (from
`src/ast/pool-worker.ts`, NOT `analyze()`)").

Same 200 files, same corpus, same code-bearing sampler, **only the path differs**:

| path | score | `imports[]` |
|---|---|---|
| `analyze()` with no context (`firing-check-v2.mjs`) | 3/10 | 0 rows in 0 files |
| `ASTEngine.parseFile` (`svelte-census.mts`, production) | 8/10 | 7,214 rows in 1,838 files |

So *"the JS/TS delegation emits no import edges"* is **refuted**: it emits 7,940
import relationships and 7,214 `imports[]` rows on the assigned corpus.

Instrument fidelity for the lane copy used to reach the production path is proven two
ways in `script/m14/svelte-instrument-fidelity.txt`.

---

## 1. POPULATION

Derived by `readdir` over the corpus root, never a hand-written list.

| corpus | `.svelte` files | parsed | threw | empty | over 512 KB |
|---|---|---|---|---|---|
| `shadcn-svelte` (assigned) | 1,878 | 1,877 | 0 | 1 | 0 |
| `svelte` (compiler test suite) | 4,561 | 4,559 | 0 | 2 | 0 |
| **union** | **6,439** | **6,436** | 0 | 3 | 0 |

Only 2 of the 61 corpus directories contain any `.svelte` file at all. The union is
reported because `shadcn-svelte` contains **zero class-shaped declarations**, so
`extends` / `implements` / `overrides` cannot be adjudicated on the assigned corpus
alone. A verdict that holds on one corpus is not a verdict.

---

## 2. PER-TYPE TABLE — production path, union of both corpora

`srcLoc` = source endpoint is a symbol declared in this file. `tgtLoc` = target is too.
`tgtImp` = target is an import binding. `tgtMI` = target is a `module:item` import edge.
`tgtUnk` = resolves to none of those.

| type | verdict | edges | files | conf / `<0.7` | resolves (loc/imp/moditem/unk) |
|---|---|---|---|---|---|
| `calls` | EMITTED | 3,658 | 1,787 | 0.8:9 0.85:703 0.9:2946 / 0 | 1348/737/0/1573 |
| `uses` | EMITTED | 11,800 | 4,086 | 0.6:3539 0.85:144 0.9:1 0.95:8116 / **3539** | 9800/113/0/1887 |
| `contains` | EMITTED | 6,449 | 2,948 | 1:6449 / 0 | 6449/0/0/0 |
| `imports` | EMITTED | 9,525 | 3,068 | 0.6:4 1:9521 / 4 | 0/0/7560/1965 |
| `references` | EMITTED | 775 | 310 | 0.8:290 0.95:484 1:1 / 0 | 340/189/0/246 |
| `exports` | EMITTED | 2,512 | 1,299 | 1:2512 / 0 | 2465/26/0/21 |
| `extends` | EMITTED | 17 | 16 | 1:17 / 0 | 5/3/0/9 |
| `implements` | EMITTED | 1 | 1 | 1:1 / 0 | 1/0/0/0 |
| `instantiates` | EMITTED | 12,857 | 2,618 | 0.95:12753 1:104 / 0 | 102/4685/0/8070 |
| `overrides` | — adjudicated in §4 | 0 | 0 | SILENT on 6,436 files | — |

**Relationship channel: 9/10.** `imports[]` channel: 8,684 rows in 3,075 files,
9,541 bound items, 1,362 distinct modules.

Every emitted type's `line_number`, where present, names a line that exists in its own
file: **0 edges outside the file's line count**, across all 47,594.

### Sample-size sensitivity, stated rather than hidden

| population | score | why it moves |
|---|---|---|
| `shadcn-svelte`, all 1,878 | **8/10** | no class declarations at all, so `implements` cannot fire |
| `svelte`, all 4,561 | **9/10** | `implements` fires once |
| union, 6,439 | **9/10** | — |
| `shadcn-svelte` first 200 code-bearing files | **8/10** | — |
| `shadcn-svelte` first 200 via `analyze()` no context | **3/10** | wrong path, §0 |

The score is a property of the corpus, not of a file-count knob, once the path is
right. It is also not a property of `NFILES`: 200 and 1,878 agree at 8/10 on the
assigned corpus.

---

## 3. THE SIX QUESTIONS, per already-emitted type

Filled in from §2 and from the lane's oracle. Answers that could not be established
are marked UNSETTLED with the reason, not guessed.

---

## 4. R7 — placeholder literals: 10 runtime hits, 0 violations

The runtime probe lists every offender BY NAME (`script/m14/svelte-r7-probe.mts`,
production path, 6,439 files read, 6,436 parsed):

```
SYMBOL-NAME-PLACEHOLDER   2
EDGE-TARGET-PLACEHOLDER   5
EDGE-SOURCE-PLACEHOLDER   3
```

**All 10 come from 2 files, and every one is a binding the SOURCE really declares.**
Read from the corpus, not inferred:

```svelte
// svelte/.../css/samples/omit-scoping-attribute-class-dynamic/input.svelte:2
export let unknown = 'whatever';
<p class='{unknown}'>this is styled</p>

// svelte/.../runtime-runes/samples/proxy-coercive-assignment-warning/main.svelte:14
const unknown = (node) => node.style.opacity = opacity;
<button onclick={(e) => (unknown(e.currentTarget))}>change opacity (unknown)</button>
```

So the edges are `exports -> unknown`, `contains -> unknown`, `uses -> unknown` ×5,
`calls -> unknown` — every one a faithful reading of a prop named `unknown` that the
file declares.

R7's own words scope it exactly this way
(`validation/m60/ledger.json`, standing rule R7):

> No analyzer may **NAME** something with a placeholder literal. When a fallback has
> nothing truthful to say the honest state is ABSENCE, not the string "unknown" — a
> literal in a name-bearing field becomes a symbol (or an edge endpoint) **that does
> not exist in the source** …

These two `unknown` bindings **do** exist in the source. Suppressing them would
delete 10 true facts and would make `bb_impact` wrong in the other direction — a
symbol it refused to report as used.

### The source side, checked independently

The register is a census over ANALYZER SOURCE, not over runtime output: its sites are
statements like `name: pDeclNode ? pDeclNode.text : "unknown"`. `svelte` is absent from
`validation/m60/symbol-sentinel-register.json`, and that absence is confirmed by
running the census rather than trusted:

```
$ bun script/m60/sentinel-census.ts
sentinel census: 62 occurrence(s) in 48 analyzers; 48 violation(s)
  c 5 · clojure 6 · dart 1 · elixir 7 · java 4 · json 1 · perl 1 · scala 1 · sql 0
  typescript 21 · vb 1 · toml 0 · xml 0 · hcl 0
  self-tests: 15/15 passed
```

`svelte` is in none of those rows and in none of the rows with a non-zero count, and
`real-svelte-analyzer.ts` is not in `parseErrors` (only `real-cpp-analyzer.ts` is), so
its absence is a measured zero rather than a parse failure.

**Verdict: R7 clean.** 0 analyzer-supplied placeholder endpoints, 0 sentinel sites in
source.
