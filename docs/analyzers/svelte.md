# Svelte Analyzer

The SFC analyzer for `.svelte`. It owns the *component*: the document-level
structure and the template, while every `<script>` block is delegated to the
JavaScript/TypeScript sub-analyzer and merged back with corrected positions.

## What it extracts

- **Symbols** — the SFC component (`class`, `isSvelteComponent`/`isSfc`, named
  from the file **stem**); `export let` props and `$props()` rune bindings
  (`property`); `$:` reactive targets (`variable`); snippets
  (`{#snippet name()}` → `method`) — plus everything the script sub-analyzer emits.
- **Relationships** — `instantiates` (non-builtin template component usages),
  `calls`, `contains`, and the script-side edges merged from the sub-analyzer
  (`imports`, `exports`, `uses`, `references`, and the rest).
- **Payloads** — complexity (script cyclomatic **plus** template decision blocks
  from `{#if}/{:else if}/{#each}/{#await}/{#key}`), plus the sub-analyzer's
  `comments` and `qualified_calls`.

## Architecture

Each `<script>` block is parsed by the JS or TS sub-analyzer per its `lang`
attribute, then merged with `line`/`col`/`index` offsets applied. Module-block
(`context="module"`) exports stay **module API** and are never props.

Three Svelte-specific passes run over the script tree: `$props()` destructure and
`$:` reactive targets become component-owned symbols (deduplicated against the
sub-analyzer's own copies, so each is declared exactly once), and — since the D7
ruling — a named function passed to an *invoking* rune becomes a `calls` edge.

The template pass reads tags, attributes, and template expressions. Expressions
arrive as opaque `svelte_raw_text` from the grammar, so they are read by a
character walk with quote states, comment states, and lexical shadow tracking for
`{#each}` / `{#await}` / `{#snippet}` / `{@const}` bindings — **not** by regex
(the regex census has no svelte row, which *is* the zero).

## Identity and naming

The component is named from the file **stem** (`Seam.svelte` → `Seam`), never the
filename, and it owns that name in its own file so relationships resolve to one
node. Every other component member is a script-side binding. A prop's *value* is
data, not an identity: `export let headline = "hi"` publishes `headline`, never
the source text of the default.

## Evidence tiers

Every relationship carries `metadata.evidenceClass`. Fixtures pin three:
`structural`, `import_based`, `usage_contextual`.

## Error recovery — measured, not inherited

Svelte's grammar is **ERROR- and MISSING-live on the real corpus**, and that is
why both types are classified `handled_verified` rather than silent. Over **410
sampled files of the 6,143-file corpus, 10 files (2.44%)** carry recovery nodes:
**55 ERROR** and **5 MISSING**, every MISSING being the grammar's expected `>` tag
terminator. Eight of twelve deliberately malformed documents also produce ERROR.

This is where the html and toml precedent points the *other* way — html ruled
MISSING silent after twelve malformed documents produced none, and toml ruled both
silent because its grammar never emits them. Applying either ruling here would have
been copying a conclusion whose measurement had not been run.

The analyzer reads both at the node's own span and reports
`Syntax <type> detected … bypassing this broken node`, alongside the engine's own
parse diagnostic. Two messages per site, both wanted: the analyzer says what it
skipped, the engine says what failed to parse.

**A read that was there and was not complete.** The error walk iterated
`namedChild`, and the expected `>` is an *anonymous* node — so the analyzer
reported `ERROR` and was blind to `MISSING`, the exact case it was written for.
The engine's own walk uses `children` and did report it, so nothing was lost
operationally; but the contract was honoured for one recovery type and silently not
the other, and a contract that depends on a caller to be complete is not a
contract.

Pinned by `svelte/error-recovery` and the mutant `svelte/recovery-stops-walk`. The
fixture arranges the damage so truncation cannot be faked: an unclosed `{#if}` makes
the parser's ERROR span swallow **the rest of the file**, so valid markup sits
*inside* the error region, and a walk that stopped there would publish the module,
one binding and one component — while the document still looked analysed, because
the component symbol spans the root. Nothing counts symbols-per-file against a
floor, so no count-based gate can see that class.

## Contract decisions

`D7` — **RULED: yes, a call edge.** A rune that *invokes* its argument turns a
named function reference into a real call site, on exactly the argument that makes
`on:click={inc}` one. Before this, `$effect(fn)`, `$effect.pre(fn)`,
`$effect.root(fn)`, `$effect.untracked(fn)` and `$derived.by(fn)` emitted nothing:
the delegate correctly suppresses the rune, but its argument is an ordinary
identifier and no edge was made for it — so a component's graph could not show that
it runs `fn` on every effect tick.

The set is the **invoking half** of the rune surface, and that split is the ruling
rather than an implementation detail. `$derived(count)`, `$state(0)`,
`$state.raw(v)`, `$bindable(v)`, `$props()`, `$inspect(v)` and `$effect.tracking()`
take a *value* and never call it, so an edge there would point a call at an
expression; the read is already a `uses` edge, so refusing the call loses no data
flow. An arrow argument is not a name and its body is already walked; a member
argument names a method this lane does not resolve. A user's own `$`-prefixed
function is not a rune.

`D8` — **RULED: yes, ratifying current behaviour.** `on:click={inc}`,
`on:submit={() => save()}`, `on:click={box.open}` and `{@render row(it)}` all emit
`calls`, with a dotted target resolved to its **last** segment — verified at three
depths (`box.open`→`open`, `helpers.row`→`row`, `box.deep.fn`→`fn`), which also
closes the older D4 note that render tags and `on:` handlers once answered the same
shape in opposite directions. The arrow-param form emits nothing.

**Cross-family disagreement, recorded rather than smoothed over.** The sibling vue
lane emits **no** calls for its equivalents: `@click="inc"` and `@submit="save()"`
both produce nothing. The two SFC siblings now differ on this ruling and on nothing
else measured. Vue's silence has the shape of the same under-claim, and it is not
changed from here — vue is not svelte's to edit. Aligning them is a separate ruling
against the vue lane.

## Known limitations

- **Style blocks are skipped entirely** (D1) — CSS belongs to the dedicated `css`
  analyzer; the SFC analyzer owns structure and script.
- **Template expressions are read from opaque `svelte_raw_text`**, because the
  maintained grammar exposes no full expression AST. Identifier-level semantics
  beyond the scanner's lexical model are a declared limitation.
- The SFC-level `typeParameters` and `apiContract` payloads are declared N/A (D5,
  D6); script-side TypeScript generics stay delegated to the TS analyzer.
- **A dedupe collapses repeated `(source, target, type)` pairs to one edge**, so
  two call sites invoking the *same* function leave a single row and the other
  site becomes invisible. Pre-existing and shared across relationship types; it is
  why fixtures give each call site a distinct callee, and it belongs beside the
  `#914` residual as a real loss of call-site resolution.
- **`<Comp.` (an unterminated tag) publishes `instantiates → Comp.`** — a name the
  grammar's own recovery produced, ending in a period. Every occurrence in the
  corpus is in one deliberately-unparseable parser test fixture, so it is recorded
  rather than changed, and it is deliberately **not** pinned by a fixture: asserting
  it would freeze a behaviour judged questionable, and forbidding it would assert a
  fix not made.

## Open gap carried by another lane

`X1` — **a `uses` edge is lost whenever an identifier is the *receiver* of a method
call.** `$: header = title.toUpperCase()` emits no `uses → title`, while
`$: o = title.length` and `$: o = fn(title)` both emit theirs, and the same
expression without the `$:` also loses it. Isolated by A/B on one line: property
access survives, a call *argument* survives, a call *receiver* does not. The shape
is common in real components (`items.slice()`, `data.map()`, `value.trim()`).

**This is not a svelte defect.** The svelte analyzer delegates its script to the
javascript sub-analyzer and a plain `.js` file reproduces it exactly, so svelte
inherits it. The `Card.svelte` M12 fixture shows the cost: it declares
`export let title` and reads it in `$: header = title.toUpperCase()`, and no edge
is produced. The fix belongs to the javascript lane, which is under active parallel
work — deliberately **not** changed here, because editing another lane's live code
to make this lane's gate green is the failure mode this project keeps naming. It is
deliberately absent from the M12 truth, because stating the missing edge as a fact
would make the gate permanently red on a defect this lane does not own.

## Verification

| Gate | Result |
|---|---|
| F1 grammar audit | PASS — 32 refs, 0 unknown, 0 unknown fields |
| F3 fixtures | **34/34** |
| F4 mutation | **29/29 caught** |
| F5 differential (60/corpus) | 100%, `MISSING=0`, `unexplained=0` on both corpora |
| F5 differential (**1,000/corpus**) | 99.7–99.9% — the only `MISSING` is gap `X2`, a typescript-oracle defect |
| F6 fixture coverage | PASS — 34 handled, 78 types, 0 uncovered, 0 dead literals |
| M12 hand-audited truth | **precision 1.000, recall 1.000** (81 facts, FP=0, FN=0) |
| SPEC A–H | **8/8** — 76 types classified, gap list 16 CLOSED + 1 open cross-lane |
| Regex census | **0** |
| PIPE store seam | 11 assertions against the real `brain.db` |

**Corpus:** 6,143 `.svelte` files — 4,462 in `svelte` and 1,681 in `shadcn-svelte`,
the largest SFC corpus in the project and comfortably over the 1,000-file floor.

**M12's 0.778 was a stale truth, not a bad analyzer.** The truth file had audited
symbols and five relationship types and had **never** audited `uses` or
`references`, so 18 genuine edges read as fabrications. Each was verified against
the source line it came from. Two limits are recorded rather than papered over: the
candidate set was seeded by the analyzer's own output, so that direction cannot
find a *missed* edge — `X1` is exactly such a miss; and ten further emitted edges
stay `unknown` because their targets are function locals, parameters or store
sigils rather than component members.

**The store seam was added because the lane had none**, which is the state html was
in when every payload a rewrite introduced was verified only against the
analyzer's return value. It exercises the component's stem-derived name, an
`export let` prop as a `property`, a `$props()` binding declared exactly once, a
`$:` reactive target, `instantiates`, and **both** new call sources — the D7 rune
invocation and the D8 template handler — told apart by target rather than by line,
because a dedupe on `(source, target, type)` would otherwise let one of the two be
lost and the seam would still pass. Negative control: demanding a second rune call
fails naming it.

## F5 at depth — the 60-file sample was not enough

The canonical differential measures **60 files per corpus**. Against a 6,143-file
corpus that is **2%**, and it *resumes from a journal* rather than re-measuring, so
it cannot see a shape the rotation never sampled. TOML, by contrast, was measured
across 100% of its pool. Running svelte at **1,000 files per corpus** found
something the 60-file draw never did:

```
[svelte]        files=1000 tree-truth=720 covered=719 (99.9%) MISSING=1  analyzer-edges=701 unexplained=2
[shadcn-svelte] files=1000 tree-truth=6954 covered=6954 (100%)  MISSING=0  analyzer-edges=6901 unexplained=0
```

The single `MISSING` is **`instantiates (expr) -> class { … }`** — a target that is
a span of source text. It is not a svelte defect. It is `X2`: the **typescript
oracle** reads `ctor.text` from a `new_expression` with no nameability guard, so
`const a = new class { foo = $state(0) }` publishes the anonymous class body as a
name. The **javascript** oracle already refuses exactly this, and its comment
records why — *"deriving their raw expression text fabricated unmatchable oracle
edges (lodash corpus)"*. The twins drifted: on this input the javascript grammar
emits no `new_expression` at all, so only the TS side is ever asked the question.

That direction matters more than the count. A truth-side defect is worse than an
analyzer defect, because a differential charges the analyzer for the oracle's
mistake — and it means the svelte analyzer neither produces the bad edge nor misses
a real one on this evidence.

Two honest limits. The figure **rotates** between runs (one read 2 MISSING /
0 unexplained, the next 1 MISSING / 2 unexplained), so a single run is not evidence
of stability in either direction. And the **2 unexplained** rows were not yet
identified when the shared tree went unstable — `real-typescript-analyzer.ts` is
mid-edit with syntax errors, and svelte delegates its scripts to it, so the depth
run cannot complete until that lands. Reporting 100% here would mean quietly
excluding the one disagreement that exists.

## Not closed

- The canonical F5 ceremony has not run at a stable tree, so
  `differential-baseline.json`'s svelte rows carry no truth totals and SPEC
  sections E/F rest on the scoped run rather than a pinned sweep. That is the
  user's ceremony, as for html and toml.
- `X1` above, owned by the javascript analyzer, and `X2` above, owned by the
  typescript oracle. Both are recorded with the fix specified rather than applied,
  because both live in files under active parallel edit.
- The **2 unexplained** rows from the depth run, and any further depth rotation,
  are blocked on a stable tree — not on anything in this lane.
