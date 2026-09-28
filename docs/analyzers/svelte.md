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
why both types are classified `handled_verified` rather than silent. Measured across the **full 6,143-file corpus: 131 files (2.13%)** carry
recovery nodes — **1,002 ERROR** and **17 MISSING**, every MISSING being the
grammar's expected `>` tag terminator. Eight of twelve deliberately malformed
documents also produce ERROR.

An earlier version of this page said **410 sampled files, 10 files, 55 ERROR,
5 MISSING**. The *ruling* never depended on magnitude — it needed only "does
this occur" — so it stands. But the number was wrong by **~18x**: the sample was
representative of how *often* a file has a recovery node and wildly
unrepresentative of how *many* it has, because files with many errors were
undersampled. This is the same error the toml lane had made hours earlier, and
the generalisation is worth keeping: **a sample can be representative of
frequency and still useless for magnitude, and any ruling that turns on "never
happens" must be measured on the whole population, not on a rotation.**

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
| F3 fixtures | **37/37** |
| F4 mutation | **31/31 caught** (one class deliberately unmutated — see below) |
| F5 differential (60/corpus) | 100%, `MISSING=0`, `unexplained=0` on both corpora |
| F5 differential (400/corpus, rotation-pinned) | **100% · `MISSING=0` · `unexplained=0`** on both corpora |
| F6 fixture coverage | PASS — 34 handled, 78 types, 0 uncovered, 0 dead literals |
| Construct census | **PASS** — 20 runes, 5 non-runes, 10 `svelte:` builtins, 13 blocks, 10 carrier families, 7 rejected, 0 unclassified over 6,143 files |
| M12 hand-audited truth | **precision 1.000, recall 1.000** (81 facts, FP=0, FN=0) |
| SPEC A–H | **8/8** — 76 types classified, gap list 16 CLOSED + 1 open cross-lane |
| Regex census | **0** |
| Performance | **17.7 ms/file · 37.5 ms/KiB** — see the gap below; the pinned baseline disagrees |
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

## The construct census — the defect a differential cannot see

This lane had **no census**. html and toml each have one that consults neither the
analyzer nor the oracle, and svelte's 34 fixtures, 29 mutants and F5 were all one
author's reading of the Svelte spec — so a construct both sides forgot could not
appear as a disagreement.

**It found one immediately.** The rune filter did not recognise `$state.eager`
(15 corpus occurrences) or `$effect.pending` (11), so both leaked:
`$state.eager(0)` published `calls -> eager` and `$effect.pending()` published
`calls -> pending` — framework plumbing named in the graph as though the component
called it. The F5 oracle missed the same two runes from the same spec, so the two
**agreed** and the lane read 100%.

**The fix's effect is visible on the primary gate.** At 1,000 files per corpus the
svelte corpus's `unexplained` count went **2 → 0**, which is what identifies those
two rows as exactly this defect. Nothing else changed.

**Fixed as exact names, never leaf segments — and that is load-bearing.** The same
`$name.member` shape is how ordinary user data is written: `$order.scoops` (6),
`$value.foo` (6), `$a.foo` (5), `$formData.dob` (5), `$storeDeeper.items` (3), plus
SvelteKit's `$lib` (3,549) and `$app` (25) — 78 distinct dotted forms in all.
Adding the bare leaves would suppress `$my.eager` and `$my.pending`. That repair
was tried as a **negative control on the census and correctly failed**; the census
asserts in both directions.

The rule that gives the gate teeth: **a form whose base is a declared rune base
must itself be a declared rune.** A plain "classify everything" would be vacuous
with a user-data fallback; this is not, and it is what caught the omission.

### The second dimension: the reserved namespace

The census's first dimension asked "is every `$`-form ruled". The second asks the
same of the template, and it found the worst kind of defect there is.

The corpus carries `<svelte:selfdestructive x="{x - 1}"/>` in its own
`compiler-errors/samples/svelte-selfdestructive/` — a deliberate near-miss of
`svelte:self`, in a file the Svelte compiler **rejects**. The analyzer published
`instantiates -> svelte:selfdestructive` and reported **zero errors**, because the
grammar parses an unknown element name perfectly well. A name being *illegal* is not
a parse failure.

**And no gate could see it.** The oracle's condition is
`!ORACLE_HTML_TAGS.has(name) && !VUE_STYLE_BUILTINS.has(name)`, and that name is in
neither set — so the oracle derived the *same* edge. Both sides agreed, the
differential reported 0 missing and 0 unexplained, and the lane read clean. **The one
gate that compares the two sides is blind to this by construction** — which is the
whole argument for a census that consults neither.

**Ruling (`D11`): the `svelte:` prefix is reserved.** Only the ten declared builtins
exist; an undeclared `svelte:*` cannot name a component. The analyzer is fixed. The
oracle is recorded as gap `X4` — not fixable from here, since `differential.ts` is
under active parallel edit.

**The ruling is a gate, not a comment.** Every `svelte:*` tag in the corpus must be a
declared builtin or carry a `REJECTED` ruling — and a `REJECTED` ruling that no
longer matches anything in the corpus **fails as stale**, so the rejection table
cannot become a place to hide a construct that has since become legal.

**Three more negative controls, each exiting 1:** dropping the `REJECTED` ruling for
`svelte:selfdestructive`; renaming a ruling to a name the corpus lacks; and
reverting the analyzer's rule (caught as *"an undeclared member of the reserved
namespace was PUBLISHED"*).

**Expected consequence, stated so the number isn't misread:** once the analyzer
stops publishing the edge, the oracle's row reads as **MISSING** rather than
agreement, because a differential charges the analyzer for the truth's mistake. So
svelte's depth figure is expected to read 1 MISSING on any rotation containing that
file, and that MISSING is `X4`, not an under-claim.

**Three negative controls, each exiting 1:** un-declaring `$state.eager`; adding
the bare leaves; declaring a non-rune absent from the corpus. The third control was
initially written backwards by me — I removed a declaration, but that check fires on
a *stale* one — and was corrected rather than counted.

**No mutant for this class, deliberately.** A harness transforms output; this defect
is a missing *suppression*, so reproducing it means adding an edge at a line the
transform cannot know without reading source. My first attempt removed the edge
instead and **survived**, because removing a fabricated edge makes a forbidding
fixture pass more. Deleted rather than shipped — the same call made for toml's
values-as-symbols mutant. The census's 20 positive suppression probes are the
instrument that can see this direction at all.

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

## The carrier space, and a finding I had to correct

Svelte carries behaviour and data through **attribute names**, and the lane
implemented only `on:` (D8) and `<svelte:component this={X}>` (H2). Ruling `D12`
gives the rest three obligations:

- **reads a member** → `uses` (0.95): `bind:`, `class:`, `style:`
- **invoked by the framework** → `calls` (0.85): `use:`, `transition:`, `in:`,
  `out:`, `animate:` — on exactly the D8 argument, since Svelte calls an action on
  mount and a transition on state change by the same mechanism that calls a handler
- **declares, does not read** → silent: `let:x` names a slot prop the component
  *accepts*

**I overstated this finding by ~7× and had to correct it.** I first reported eight
silent families at **~2,049** corpus occurrences including `bind:value` at 581. That
was wrong: only the five **invoked** families were actually silent — **292**
occurrences — while `bind:`/`class:`/`style:` were *already* published as `uses` by
the general attribute-expression walk, because the grammar wraps an attribute value
in an `expression` node that walk already visits. This work's contribution there is
**provenance**, not the edge: those reads now carry `metadata.carrierDirective`, so a
two-way binding is distinguishable from an ordinary template read.

The error was mine and the cause is worth keeping: my probe **imported** the
identifiers it then expected to read, and `uses` publishes only for a name that
resolves to a *declared component member* — so every read came back empty and I read
that silence as a missing carrier.

**What caught it was a census negative control that did not fire.** The carrier probe
asserted that a declared read family publishes a `uses` edge; with the read set
emptied, the census still **passed** — only possible if the read was already
published elsewhere. That control is now the standing regression test, retargeted on
the provenance flag rather than on mere presence, because asserting presence would
test nothing and let the false claim back in.

**Tailwind is the trap, twice over.** `md:grid-cols-2`, `dark:bg-background`,
`hover:text-primary` and `after:absolute` carry the exact `prefix:value` shape of a
directive and live inside quoted `class` values. Matching the *shape* would publish
all of them — the same failure the bare-leaf rune fix had. `after:*` is not a Svelte
directive at all.

**Three instrument defects in my own census, each of which manufactured a phantom
"undeclared directive"** — recorded because a census that measures the wrong thing is
worse than none: it never stripped **comments** (a `<!-- @migration-task: svelte:self
is deprecated -->` matched as an attribute); its non-greedy `<script>…</script>`
strip was truncated by a `</script>` inside a string, leaking a Tailwind prefix from
a JS string literal; and no regex over `[^{}]` can strip `class={cn(...)}` when the
arguments hold a `${...}`, because the braces are genuinely **unbalanced** across the
window (measured: 2 `{`, 1 `}`). Replaced with a balanced scanner that tracks quote
state. The four prefixes that genuinely remain are `xlink:`, `xml:`, `xmlns:` —
real XML/SVG namespaces — and `foo:`, an invented attribute in a compiler-error
sample.

**Three new negative controls, each verified:** dropping a carrier `REJECTED` ruling
exits 1; a declared read family that stops publishing its provenance exits 1; and a
declared-**silent** family that starts publishing exits 1 — the last one matters most,
because a census that only ever checked for presence would not notice a rule that
published everything.

## Performance — measured here for the first time

The lane had **no cost row at all**, and taking one on the production path
(`ASTEngine.parseFile`, so the script sub-parse and every seam are included)
disagreed with the pinned baseline by **2.5× to 4.7×**:

| corpus | measured | pinned baseline |
|---|---|---|
| `svelte` | 16.81 ms/file · 84.29 ms/KiB | **3.6** |
| `shadcn-svelte` | 42.10 ms/file · 27.99 ms/KiB | **16.7** |

**The two populations are very different.** svelte's own repo is mostly files under
0.5 KiB, where a large *fixed* cost dominates and ms/KiB looks terrible;
shadcn's files are larger and amortise it. A single mixed figure (37.54 ms/KiB over
410 files) is therefore less informative than the split.

**Within a population the cost is linear in size** — ms/KiB falls monotonically as
files grow (65.5 → 38.9 → 24.2 → 19.2 → 12.7), which is the signature of a constant
overhead rather than superlinearity.

**The gap cannot be explained from the artefact.** Both baseline rows record
`avgMsPerFile` and **no method**, no `filesMeasured`, no load figure. toml's rows
record all three. So the file cannot say whether it was measured on the production
path, on the analyzer alone, or on an earlier build. **The html lane fell into this
exact trap once** — 1.4 ms/KiB was measured calling the analyzer directly, omitting
the inline-block seam and its JS sub-parse, and the real figure was 4.7–5.3. A 4.7×
understatement has the same shape, and html's fix was to record the *method* so the
number can be read.

**Not rewritten here, deliberately.** `differential-baseline.json` is canonical
evidence written by the canonical sweep; overwriting a pinned baseline from a scoped
run would replace a claim with a smaller one — the rule the differential itself
enforces when it refuses to write `M14.0.F5` from a probe. Recorded as gap `X5`.

## The oracle half — and a rotation trap I fell into twice

svelte's F5 read `unexplained=21/3`, then `0/0` after the three oracle fixes, and I
was about to claim causation. **I was reading noise.** This harness
**rotates its sample on every wave by design** — the cold-pool rotation "deliberately
draws never-sampled files each wave" — so two identical commands give different truth
counts and different `sampleSetHash` values. Every before/after claim I had made today
without pinning the rotation was unsound, including the one I put in a commit message.

With the rotation state snapshotted and restored, the ablation is clean:

| pinned rotation | truth | unexplained |
|---|---|---|
| with the X7 fix | 383 / 2929 | **0 / 0** |
| without it | 360 / 2923 | **22 / 6** |

Same `sampleSetHash`, so the fix adds 23 + 6 truth rows and eliminates 28 unexplained on
one identical sample. X4 is verified by calling the exported
`deriveSvelteComponentUsages` directly — the shape occurs **once in 6,143 files**, so
no corpus sample can contain it and no ablation is possible — and in **both** directions:
the compiler-rejected `svelte:selfdestructive` now derives nothing, while a real
component still does.

**X2 nearly shipped as a serious regression.** Applying the *javascript* oracle's
nameability list to *typescript* is the obvious way to write it and the obvious way to
be wrong. A first comparison said the guard had removed **302 legitimate truth rows**.
That comparison was invalid — the samples differed. Re-measured on a pinned rotation it
removes exactly **1**, and a direct tree walk of vue-core finds exactly **2**
non-nameable constructors, both `parenthesized_expression`. The 302 was the same
rotation noise, caught the second time by the same discipline.

**And fixing the oracle exposed a defect nobody could see.** The typescript *analyzer*
publishes the same fabricated names: `new (e.constructor as any)(…)` →
`instantiates -> "constructor as any)"`, `new (getCtor())()` → `"(getCtor())"`,
`new (class {})()` → `"(class {})"`. The oracle had the identical bug, so both agreed
and the differential reported 100%. X2 converted that agreement into a visible
disagreement — typescript's `unexplained` goes **1 → 2** — and that is deliberate:
**reverting would restore an agreement that is wrong on both sides**, which is the one
outcome the differential exists to prevent. Recorded as `X8`, owner the typescript
analyzer, with the reproduction.

## Not closed

- The canonical F5 ceremony has not run at a stable tree, so
  `differential-baseline.json`'s svelte rows carry no truth totals and SPEC
  sections E/F rest on the scoped run rather than a pinned sweep. That is the
  user's ceremony, as for html and toml.
- `X1` above, owned by the javascript analyzer, and `X8` above, owned by the
  typescript analyzer. `X2`, `X4` and `X7` are **closed** — fixed in the oracle this
  session and each verified by a pinned-rotation ablation or a direct oracle call. Both are recorded with the fix specified rather than applied,
  because both live in files under active parallel edit.
- **F5 figures rotate.** Every number in this table is a single run on a rotating
  sample. A stability claim needs several pinned rotations recorded, not one run.
- `X5` above: the perf baseline is unreconciled, so SPEC section F's green rests on a
  number this lane cannot reproduce. The canonical sweep must record a method.
- The **2 unexplained** rows from the depth run, and any further depth rotation,
  need a stable tree — not on anything in this lane.
