# Visual Basic .NET — `vb`

**Support exists and is measured. It is not finished.** This page is the honest
state of the lane; every number on it has a command that produced it.

Before 2026-09-27 the product had no VB support at all, and failed *quietly*:
`.vb` was a routed extension and `vb` a declared language, but `engine.ts`
routed it to `__generic__`, so a `.vb` file was "analysed" by a regex generic
pass that cannot see a `Class`, a `Function`, an `Implements` clause or a call
site — and was reported as covered rather than refused. There was no VB.NET
grammar on npm to route to either.

---

## Quick facts

| | |
|---|---|
| Extensions | `.vb` (`language-detection.ts`) |
| Grammar | `tree-sitter-vbnet` — vendored + **18 repairs**, `grammars/tree-sitter-vbnet/` |
| Grammar pin | `validation/m14/grammar-pins.json` → `lanes.vb`; source↔wasm proof: 0 difference |
| Analyzer | `src/ast/real-vb-analyzer.ts` — 1,331 lines, **AST-only, zero regex** |
| Wired at | `engine.ts`: `SUPPORTED_LANGUAGES.vb`, `getParser` case, `getAnalyzer` → `RealVbAnalyzer` |
| Pin doc | [`grammars/tree-sitter-vbnet/PIN.md`](../grammars/tree-sitter-vbnet/PIN.md) |
| Lane review | [`reviews/vb/master-review.md`](../reviews/vb/master-review.md) |
| Analyzer doc | [`docs/analyzers/real-vb-analyzer.md`](analyzers/real-vb-analyzer.md) |

## How well it is doing

Measured through `ASTEngine.parseFile` — the product's own entry, so grammar
resolution, analyzer dispatch and the wasm load are all exercised.

**435 real `.vb` files** across four independent repositories:

| | |
|---|---:|
| symbols | **12,834** |
| relationships | **35,442** |
| imports | **1,157** |
| crash files | **0** |
| pipeline mismatches | **0** |
| empty symbol names | **0** |
| unknown symbol kinds | **0** |
| **relationships without a site line** | **0** of 35,442 |

### The analyzer's own differential (F5) — 100 % on a 120-file draw

A tree-derived oracle, written to diverge from the analyzer on every axis that
could hide a shared mistake (flat cursor sweep vs recursive walk, ownership by
byte range vs a push/pop stack, callee by document-order leaf vs the `function`
field), compared edge for edge against analyzer output.

| corpus | files drawn | truth edges | covered | missing | unexplained | heuristic |
|---|---:|---:|---:|---:|---:|---:|
| `P3D-Legacy` (primary) | 60 of 1,880 | 627 | **627 (100 %)** | 0 | **0** | 0 |
| `DISMTools` (second corpus) | 60 of 483 | 1,966 | **1,966 (100 %)** | 0 | **0** | 0 |

`analyzer-edges` equals `tree-truth` exactly on both, so the agreement is
edge-for-edge rather than a percentage that hides a compensating pair.

### The full-corpus number, and what it found

The draw above is 120 files, so the sweep was re-run over **the whole of
`DISMTools` — 483 files, 483/483 fresh, the entire corpus for that repo**:

| corpus | files | truth edges | covered | missing | unexplained | heuristic |
|---|---:|---:|---:|---:|---:|---:|
| `DISMTools` (full) | **483 of 483** | 13,689 | **13,666 (99.8 %)** | **23** | **0** | 0 |

**99.8 %, not 100 %** — which is the whole reason the full sweep was worth
running. The 23 are not noise, and they are two defects, not one:

**17 × `implements Initialize -> Initialize` — an oracle defect.** A method and
the interface member it implements share a name, so the oracle emitted a
**self-edge**: source and target are the same symbol. The analyzer drops
self-edges, correctly — an edge from a symbol to itself is not navigable and is
noise a consumer has to filter. The oracle has to agree, so this is a harness
fix.

**6 × lost call edges — and this one is a grammar defect with a large blast
radius.** `DISMTools/Panels/ISOFiles/NewTestingEnv.vb` publishes 4 calls where
the oracle derives 10. The parse error sits at `11:20-35`, and columns 20–35
are *inside* the identifier `NewTestingEnv_Load`. The cause:

> `_identifier_token` is declared `token(prec(-1, /\p{L}_[\p{L}\p{Nd}_]*/))`
> while the keywords are `prec(0)`. tree-sitter picks a token by **(1)
> precedence, then (2) match length**, so precedence is decided *before* length
> ever runs. The three-letter keyword `New` therefore beats the thirteen-letter
> identifier `NewForm_Load`, the method's name is destroyed, its declaration node
> closes at the signature, and **its body falls outside that node** — so
> `collectCalls` walks a node that does not contain the method and drops every
> call inside it.

Six lines reproduce it, with no `Handles` clause and no Windows Forms involved:

```vb
Public Class F
    Private Sub NewForm_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        DoWork()
    End Sub
End Class
```

`DoWork()` is not published. The blast radius is **127 distinct `New*`
identifiers, 2,823 occurrences**, and the pattern is *contagious* in exactly the
codebase this corpus is: Windows Forms names event handlers `<Form>_<Event>`, so
a form called `NewForm` loses the body of **every** handler it has — silently,
with the file's symbol count still looking plausible.

Two fixes were built and neither is safe to land, so the grammar is unchanged:

- **Append `\b` to the `ci()` helper** so a keyword cannot match an identifier
  prefix. This is the textbook fix and it is *illegal*: `\b` is a zero-width
  assertion, and a tree-sitter token may not contain one — `Grammar error:
  Unexpected rule ExpandRegex(Assertion)`.
- **Drop `prec(-1)` from the identifier** so the length tiebreak runs. The
  generator accepts it (and reports *fewer* necessary conflicts, which suggests
  it does reduce ambiguity) but the lexer still picks `New`, so the change is not
  the fix it looks like.

The correct repair is keyword extraction or a restructure of how keywords are
declared, which is a grammar project rather than a one-line patch, and it
belongs to whoever owns `grammar.js` — not to a lane that has to re-pin a
digest-verified artefact. Both attempts were reverted; `grammars/` and the wasm
are byte-identical to HEAD and the pin gate is green.

**Read the 120-file draw as 120 files, not 2,660.** It is 4.5 % of the corpus,
drawn by a rotation that *prefers* never-sampled files, so it is fresh rather
than representative — and it reported 100 % on a corpus whose honest figure is
99.8 %.

The audited labels are `calls`, `contains`, `imports`, `extends` and
`implements`. `references` is deliberately **not** audited: the oracle does not
derive it, and comparing a label the truth side cannot produce counts every
analyzer edge of that label as fabrication — `references` is the analyzer's
largest class, so that would be a manufactured red.

> Re-measuring needs the pool frozen: the cold-pool rotation deliberately draws
> never-sampled files each wave, so two runs measure two different file sets.
> `BB_F5_FREEZE_POOL=1` replays one wave. Without it the sample hash changed on
> every run and coverage appeared to move 98.4 % → 92.4 % with no code change.

**Four defects came out of it, three of them whole kinds** — and none of them
was visible to a corpus-wide count, because in each case the count stayed
healthy while a class of output was absent or wrong:

1. **Constructors were absent from the index entirely.** `Public Sub New()` has
   no `name` field — the grammar lexes `New` as an anonymous token — so the
   "declaration without a name" guard returned before the naming contract was
   reached. The contract had been written and was dead code: 12,549 symbols
   across 435 files contained **zero** constructors. `isCtor` now has to be
   evaluated *before* the guard, since a check that can reject a declaration has
   to run against the contract, not in front of it. 285 constructors now, each
   with the class in `ownerName`.
2. **Callee resolution published expression text as a target.**
   `New AnimatedBlock()` parses as
   `(object_creation_expression type: (simple_name (identifier)))` — the type is
   in a `type` field, and the naming helper only followed a `name` field, so it
   fell through and returned the whole node. The target was the literal string
   `"New AnimatedBlock"`; 31 of them in one method. The rule is now the last
   `identifier` leaf at or under the callee, skipping any `type_argument_list` so
   `New List(Of Integer)` is `List` and not `Integer`.
3. **Containment was emitted per visitor, so a whole class of declaration had an
   `ownerName` and no edge.** A nested type recorded its owner on the symbol but
   nothing walked to it, so containment navigation stopped at the class. It is
   emitted once in `pushSymbol` now — the fix that cannot recur, because there is
   no longer a visitor that can forget.
4. **A construction with arguments was not a call at all.** `New Box()` is an
   `invocation_expression`; `New Box(1, 2)` is an `array_creation_expression`
   with a `type` field and no `function` field. The callee was read from
   `function`, so every construction with arguments published no edge — **15,577
   occurrences across 1,718 of 2,660 files**. The way this was found is the
   point: **F5 read 100 % with the defect live**, because the oracle derived
   `calls` from `invocation_expression` too. Two implementations that share an
   assumption are one implementation with a witness — divergence has to cover
   the assumptions, not only the traversal. The fixture and its mutant are what
   catch what the differential structurally cannot.
5. Five defects were in the **oracle**, not the analyzer, and each is recorded at
   the line that earned it: a field's unit is the `variable_declarator`, not the
   `field_declaration` (`Dim X, Y, width As Integer` is three members); a
   namespace is a declaration that contains its types; a dotted base type is ONE
   heritage name, not one edge per segment; a `(Of …)` argument is not a base
   type; an import is a name and a comment is not. Where a name is a contract
   rather than a derivation — a constructor — both sides read it from one helper,
   because a name that is right for a target and wrong for a source is still a
   wrong name.

### Grammar parse profile — 2,660 files, and the error is mostly one upstream bug

| | files | share |
|---|---:|---:|
| parse clean, no error of any kind | **1,386** | 52.1 % |
| one error only, and it is the end-of-file artifact below | **950** | 35.7 % |
| at least one *real* syntax error | **324** | 12.2 % |

**The single largest cause of "errors" in this lane is a defect in the upstream
grammar, and it is not a source defect at all.** Upstream's end-of-file token is
`token(prec(-10, "$"))`; `token()` compiles that to a pattern matching a literal
`$` **character** (`src/grammar.json` records `{"type":"STRING","value":"$"}`), so
it can never match and at −10 precedence the lexer never offers it either. The
`_eof` branch of `_terminator` is therefore unreachable, leaving the literal
newline as the only branch — so **a `.vb` file that does not end with a newline
parses to a tree carrying a fabricated `MISSING "\n"` node**:
`Namespace N … End Namespace` with a trailing newline is clean; the same bytes
without one give `MISSING "\n" [3, 13] - [3, 13]`.

That artifact is reported by the engine as a zero-width
`Syntax error (missing node)` on the file's last line, and it is an **anonymous**
node, so it does not appear in the printed tree at all. It costs no symbols and
no relationships — it is why 950 files measure as errored while their symbol
counts are correct.

It is not fixed here, and the reason is worth recording. tree-sitter has no
end-of-file token, and a rule may not match the empty string, so the tolerance
has to be expressed at each of the 61 `_terminator` use sites. Doing that
required 31 declared GLR conflicts before the generator would even emit a
parser, and **the target case was still not fixed** when the experiment was
abandoned — while widening the grammar's ambiguity from 8 declared conflicts to
39 on a digest-pinned artefact. Reverted; the grammar is byte-identical to its
committed state. The 12.2 % of files with real errors is the honest remaining
defect surface, and its top classes are named below.


Grammar parse success, four corpora, **1,185 files**: **90.89 % clean, 0 crash
files** (from 38.67 % on Microsoft's own `Microsoft.VisualBasic.Core` when the
upstream grammar was first wired).

| corpus | files | clean % |
|---|---:|---:|
| `dotnet/runtime` → `Microsoft.VisualBasic.Core` | 75 | 81.33 |
| `P3D-Legacy/P3D-Legacy` | 600 | 93.00 |
| `CodingWonders/DISMTools` | 400 | 90.25 |
| `mikeoverbay/TankExporter` | 110 | 87.27 |

> **These two numbers measure different things, and the gap between them is the
> single most useful fact on this page.** The table above counts a file clean when
> it has no `ERROR` node; the 2,660-file profile below counts a file clean only
> when `parseFile` returns an **empty** error list. The 48-point difference
> between "90.89 % has no ERROR node" and "52.1 % has no error at all" is almost
> entirely the end-of-file `MISSING "\n"` artifact, which is an anonymous node and
> so never appears as an `ERROR` node in the first measurement. Any grammar
> number reported without saying which of the two definitions it used is not
> comparable to any other.

## What you get

**Symbols** — namespace, class, structure, interface, module, enum (+ members),
delegate, `Sub`/`Function` (with parameters, `ByVal`/`ByRef`, return type),
constructor, property, event, operator, field, `Const`, local-variable
declarations, and `Imports` — each with a 1-based range, an owner, VB's own
visibility, `Shared`/`Overridable`/`NotInheritable`/`ReadOnly`/`Partial`
translated to the keys the rest of the product uses.

**Relationships** — `contains` (ownership), `calls` (per call site),
`extends`, `implements`, `imports`, `references`, `overrides`. VB's two heritage
spellings are both read: the following `Inherits`/`Implements` line *and* the
header form `Class C : Inherits B, Implements I` / `Interface I : IDisposable`.

**Every edge carries a 1-based site line** on the node that names the thing, so a
call split across three lines is navigable to the line its callee name is
written on. This is enforced, not asserted: **0 of 35,442** published
relationships lack one.

**A constructor is published as `constructor`**, with the class in `ownerName` —
the name is a contract, not the source text, because `New` is a keyword that
collides across every class in a file. This matches csharp and typescript;
(java publishes the class name instead, so the product has no single convention
across all lanes — worth a cross-language ruling, and noted so the next lane does
not have to rediscover it.)

## Two encoding facts worth knowing

- **40 of P3D's 1880 `.vb` files are UTF-16 with a BOM** (Windows Forms Designer
  output). Decoded as UTF-8 they are `N.a.m.e.s.p.a.c.e` and are a whole-file
  error for *any* grammar. The lane's corpus reader strips the BOM.
- **1333 of 2548 `.vb` files across the four corpora carry a UTF-8 BOM (52 %).**
  That one does **not** break the grammar — tree-sitter skips it, measured, not
  assumed — but `readFileSync(path, "utf8")` does not strip it, so any surface
  that compares raw text sees a leading U+FEFF on half of all VB files.

## What is not done

Stated plainly, because a lane that hides its boundary is worse than one that
has not finished:

1. **The grammar parses 52.1 % of files with no error of any kind**, and 35.7 %
   more carry only the upstream end-of-file artifact described above. 12.2 % —
   **324 files** — carry a real syntax error, and the top classes are:
   - **single-line `If … Then … Else …`** (20 files, 35 sites). The rule allows
     it, but the expression parser never reduces: the tree comes out as
     `binary_expression(1, ERROR, 2)`. `If flag Then A = 1` is clean;
     adding `Else` is what fails. `ElseIf` on one line fails the same way.
   - **multi-line lambda arguments** — `.First(Function(x) … )`, `.Any(Function(…) …)`.
   - `For Me.opacityFade = 1 To 0 Step -0.005` (a dotted loop variable).
   The long tail is 324 distinct signatures, none above 5 files.
2. **The analyzer metadata is no longer discarded, but the engine's own
   capability claims still are not audited.** `parseFile` used to rebuild
   `metadata` from a fixed allowlist of thirteen fields, which dropped every
   other key — including the lane's `vbGaps`, its own disclosure — and
   overwrote `hasTypeInference`/`hasFrameworkIntelligence` with a literal
   `true`, publishing capabilities that seven lanes had explicitly said they
   lack. Fixed for all lanes; what is not done is a gate that would catch a
   future hardcode in the same place.
3. **423 members carry no `ownerName`** — and the attribution is decisive: 423
   inside grammar-errored files, **0** in a cleanly-parsed file. The ownership
   logic is correct; when the grammar collapses a class into an ERROR the class
   symbol is lost, and the members still recovered from inside that ERROR have no
   owner to name. Fixing this belongs in the grammar.
4. **No fixtures, no regression mutants, no F8 node-type spec, no F10
   parse-success floor, no closure-wave record, no completion-matrix tick.**
5. **`M14.0.F5` has no committed artifact for this lane.** The differential runs
   and is at 100 %, but a scoped `--lang vb` run deliberately refuses to write
   the canonical artifact: it belongs to the full 60-file, 30-language sweep,
   and writing a one-language claim there would replace a bigger claim with a
   smaller one. The sweep has not been run.
6. The general `:` statement separator (`a = 1 : b = 2`) is **refused, not
   overlooked** — ~0.4 % of files, and two designs were built and both were worse
   than the gap. The clause-head form (`Case 1 :`, `Else :`) works.

## Re-running the numbers

```sh
export PATH="$HOME/.local/bin:$HOME/fixtures/bin:$PATH"

# grammar: rebuild, run the 27 repro cases, run the corpus differential
$HOME/fixtures/grammar-repro/grammar-gate.sh

# the pin, and the proof that the pin gate can fail
bun run script/m14/verify-grammar-pins.ts
bun run script/m14/verify-grammar-pins.ts --self-test

# grammar conformance (F1) and the cross-file consistency gate
bun run script/m14/audit-analyzer-grammar.ts
bun run script/m60/verify-grammar-consistency.ts

# the analyzer's differential, on both corpora, on a FROZEN sample so the
# two numbers are comparable to each other and to the next run
BB_F5_FREEZE_POOL=1 bun run script/m14/differential.ts --lang vb --repo P3D-Legacy --sample 60
BB_F5_FREEZE_POOL=1 bun run script/m14/differential.ts --lang vb --repo DISMTools  --sample 60
BB_F5_SHOW_SAMPLES=1 BB_F5_FREEZE_POOL=1 bun run script/m14/differential.ts --lang vb --repo P3D-Legacy --sample 60

# the analyzer, through the product's own entry
./node_modules/.bin/tsx $HOME/fixtures/probes/vb-analyzer-e2e.ts
```

## Why the grammar is a local rebuild and not a pin of a release

There is no release to pin. `govindbanura/tree-sitter-vbnet` publishes no npm
package and no tagged release, and the `tree-sitter-wasms` bundle that supplies
39 of this repository's grammars ships no VB at all. So the pin records a build
of a source file this repository owns, with per-file digests over the vendored
tree and the offline proof that the committed bytes are a build of the committed
grammar. Its value is drift detection over *that* source — a hand edit to
`grammar.js` moves a recorded digest and fails the gate — not an upgrade path.
