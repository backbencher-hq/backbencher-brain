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
| relationships | **39,125** |
| imports | **1,157** |
| crash files | **0** |
| pipeline mismatches | **0** |
| empty symbol names | **0** |
| unknown symbol kinds | **0** |
| **relationships without a site line** | **0** of 39,125 |

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

**99.8 % on the first pass, and the 5 rows that remain are all one grammar
defect.** The first full run found 23 missing. Eighteen were the analyzer's and
are fixed; the surviving 5 are a single root cause that a lane cannot fix.

### What the 23 were, and what they actually were

I first read the 17 majority as an *oracle* defect — a self-edge, where a method
and the interface member share a name. That was half right, and the half that was
wrong mattered. `Public Sub Refresh() Implements IThing.Refresh` produced **no
edge at all**, for `Refresh` as much as for `Initialize`: `visitHeritage` was
called from exactly one place, the *type* visitor, so **no member's heritage
clause was ever read** — the whole member-level form, on every member in the
language. The oracle was right that a relationship exists; it was wrong about its
*shape*, because last-segment reduction turns `IThing.Refresh` into `Refresh`,
which is the method's own name, and the edge collapses onto itself.

So both sides were wrong in different ways, which is the case a differential is
for. The fix, on both sides:

- the analyzer collects member-level clauses, and their target **keeps its
  qualifier** — `implements Refresh -> IThing.Refresh`, not `-> Refresh`. This is
  the one place the last-segment naming rule does not apply, because the member is
  identified *by* its interface; reduced to a segment, the edge is a symbol
  pointing at itself and cannot answer "where is `IThing.Refresh` implemented?".
- the oracle derives the same qualified target.

Corpus-wide through `parseFile`, 435 files: `implements` **56 → 176**,
relationships 38,312 → **38,432**, symbols unchanged, 0 crashes. The full-corpus
figure is now **13,684 / 13,689 = 99.96 %, 0 unexplained**.

### Both corpora, in full, with all seven labels audited

| corpus | files | truth edges | covered | missing | unexplained |
|---|---:|---:|---:|---:|---:|
| `P3D-Legacy` | **1,880 of 1,880** | 23,356 | **23,353 (100 %)** | 3 | **0** |
| `DISMTools` | **483 of 483** | 15,689 | **15,685 (100 %)** | 4 | **0** |

**39,045 audited truth edges, 39,038 covered, 7 missing, 0 unexplained.** The
audited set grew from 878 to 23,356 on the primary corpus when `references` and
`overrides` joined it — 3,073 edges that were previously published and agreed
with by nobody.

All seven missing rows are dropped constructions:

| file | row | cause |
|---|---|---|
| `MainMenuScreen.vb` | `calls … -> GetGameModes` | `Sub New*` — the grammar defect below |
| `MainMenuScreen.vb` | `calls … -> OfflineGameWarningScreen` | inside `Sub NewGameButton` |
| `SoundManager.vb` | `calls … -> SoundContainer` | **not** `Sub New*` — unexplained |
| `NewProj.vb`, `NewTestingEnv.vb` ×3, `NewUnattendWiz.vb` | 5 rows | `Sub New*` — DISMTools |

Six of the seven are the one grammar defect, which is now confined to 2,823
`New*` identifiers in the grammar. The seventh — `SoundManager`, in a file with no
`Sub New*` at all — is genuinely unexplained and is recorded as such rather than
folded into the class it resembles.

### The `New*` grammar defect, and why a lane cannot fix it

All five `DISMTools` survivors, and two of the three `P3D` survivors, are `calls`
edges inside a method whose *name begins with `New`*:

| file | missing |
|---|---|
| `Panels/ISOFiles/NewTestingEnv.vb` | `calls … -> SetColors`, `-> Clear`, `-> Beep` |
| `Panels/Prj_Ops/NewProj.vb` | `calls … -> SetColors` |
| `Panels/Unattend_Files/…/NewUnattendWiz.vb` | `calls … -> PostInstallScript` |
| `Screens/MainMenu/MainMenuScreen.vb` | `calls … -> OfflineGameWarningScreen` (in `Sub NewGameButton`) |

The grammar mis-lexes any `Sub New*`. The trigger is exact, and five controls pin
it down — all of these parse **CLEAN** on the unmodified grammar:

```
Public NewItem As Integer        (a field)          CLEAN
Dim NewItem As Integer           (a local)          CLEAN
Public Function NewGet()         (a Function)       CLEAN
Public Sub New()                 (a real ctor)      CLEAN
Public Sub Load() Handles …      (no New prefix)    CLEAN
Public Sub NewForm_Load()        (a Sub)            BROKEN
```

Only `Sub New*` breaks, because `Sub` is the single thing that can be followed by
the constructor form. `constructor_declaration` is `prec(100, seq(ci("Sub"),
ci("New"), …))` against `method_declaration`'s `prec(1)`, so the parser commits to
the constructor branch, and the member's body ends up outside the declaration
node — which is why the *calls* go missing rather than the method.

**127 distinct `New*` identifiers, 2,823 occurrences** in the corpus, and the
pattern is contagious in exactly the code this corpus is made of: Windows Forms
names handlers `<Form>_<Event>` and names buttons `New<Thing>`, so a form or a
button called `New…` loses the body of **every** handler it has — silently, with
the file's symbol count still plausible.

### A proven negative result, not four failed guesses

This is settled by measurement now, and the full working is in
[`grammars/tree-sitter-vbnet/PIN.md`](../grammars/tree-sitter-vbnet/PIN.md).

**The mechanism.** The token stream for `Public Sub NewForm_Load()` is
`member_modifier "Public"` + `identifier "Form_Load"` — the head is gone — while
`Public Sub Ordinary_Load()` parses clean. So the fault is **purely lexical**:
`_identifier_token` is `prec(-1)` and every `ci()` keyword is `prec(0)`, and
tree-sitter resolves a token choice by **precedence first, match length second**.
Precedence is settled before length is consulted, so the three-character keyword
`New` beats the thirteen-character identifier — always, whatever the parser wants.
Confirmed by disabling the constructor's `New` alternative entirely: the
identifier was *still* split, so the parser's preference for
`constructor_declaration` is a consequence of the split, not its cause.

**The precedence space is exhausted.** There are exactly three settings and each
breaks something:

| identifier precedence | `Sub NewForm_Load()` | `Sub New()` | `New Foo(1,2)` |
|---|---|---|---|
| `prec(-1)` — current | **broken** | works | works |
| `prec(0)` — tie | broken | **broken** | **broken** |
| `prec(1)` | fixed | broken | works |

At a tie the identifier wins the *exact* match, so `New` stops being a keyword and
real constructors stop parsing; above the tie the same happens and
`Handles MyBase.Load` breaks too. **No precedence distinguishes `New` from
`NewForm_Load`**, because what distinguishes them is a word boundary and not a
priority.

**And both obvious repairs are closed off, by measurement:**

- `\b` on the `ci()` helper is the textbook fix and is **illegal** — a tree-sitter
  token may not hold a zero-width assertion (`Unexpected rule
  ExpandRegex(Assertion)`), and the generator then rejects the whole grammar.
- **Keyword extraction** — the mechanism that exists precisely for this, where the
  lexer matches the `word` token and promotes it on an *exact* text match — does
  not rescue these tokens, because `ci()` returns an inline `new RegExp(...)` and
  the generator indexes keywords by literal text. Converting `New` and `Handles`
  to plain string tokens was measured and changed **nothing**: extraction is
  decided for the grammar's token set as a whole, and the other 285 `ci()` call
  sites keep it off.

**What the repair therefore requires:** replacing `ci()`'s inline case-insensitive
RegExps with named token rules the extractor can index, across **287 call sites**,
and re-pinning the digest. That is a grammar project for whoever owns
`grammar.js`, not a change a lane should make to a digest-verified artefact.

Every experiment was reverted; `grammars/` and the wasm are byte-identical to HEAD
and the pin gate is green.

**Read the 120-file draw as 120 files — and in fact as 60.** Two rotations of a
60-file draw, one per corpus, was the sample. It reported 100 % on a corpus whose
honest figure is not 100 %, and it kept reporting 100 % on the *same* 60 files
however many rotations were requested, because the rotation was not rotating. See
the section on that below: the fix, and what the number means now.

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
written on. This is enforced, not asserted: **0 of 39,125** published
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

## The node-type census (F8) — and what it found

`script/m14/vb-node-type-census.ts` walks every named node the grammar produces
over the corpus and checks that each type is **accounted for**. It is the check
that makes "every construct is handled" a number rather than a claim.

The first run, over 2,660 files and 3,041,677 named nodes:

```
distinct named types     146
classified                45   (19 declaration + 26 silent)
UNCLASSIFIED             101
```

**The "every node type is classified" claim was 29 % true, and nothing had ever
measured it.** Two whole kinds of defect were in the unclassified 101, and both
had been invisible to every other check in this lane:

**An interface's members were never visited.** `interface_method_declaration`,
`interface_property_declaration` and `interface_event_declaration` were in
*neither* the declaration set nor the silent set — which is the whole defect:
nothing dispatched them, so **every interface was published as an empty shell**,
a name with no members, while the class implementing it had all of them. DISMTools
and P3D are both Windows Forms applications whose designer emits an interface per
dialog, so this was not a rare shape.

**No operator was ever published**, for two independent reasons.
`operator_declaration` has no `name` field — the operator is an anonymous token —
so the same empty-name guard that hid constructors hid every operator. And
`visitOperator` then skipped that very token, because `isKeyword` returns `true`
for any token that does not start with a letter, which was written to reject `(`
and also rejected every operator *symbol*. Word operators (`Operator CType`) fail
a second time: the keyword and the word are inlined away and exist nowhere in the
tree, so there is no node to name from. So the name is the contract literal
`operator` — the same shape a constructor takes — and the symbol is recorded in
`metadata.operatorSymbol` wherever the grammar kept it.

The census is now **145/145 classified and exits 0**, and it fails when a node
type appears that the analyzer has not accounted for. The classification is
four-way, because a two-way split is what hid both of these:

| set | meaning | count |
|---|---|---:|
| `DECLARATION_NODES` | a symbol is published | 19 |
| `RELATIONSHIP_SOURCES` | no symbol, but a relationship is derived | 7 |
| `RELATIONSHIP_CANDIDATES` | silent today; a real relationship a future wave could derive | 8 |
| `SILENT_INTERNAL` | nothing published, no candidate | 111 |

`RELATIONSHIP_SOURCES` and `RELATIONSHIP_CANDIDATES` are new, and they exist
because "classified" and "handled" are different words. `array_creation_expression`
sat in neither set, which is what let the analyzer read a construction's callee
from a `function` field the node does not have; `implements_member_clause` sat in
`SILENT_INTERNAL`, which is a claim that the node carries nothing when it carries
a relationship. And the candidates — `constructor_initializer` (`: base(...)`),
`add_handler_statement`, `raiseevent_statement`, `event_member`, the property
accessors, `lambda_expression` — are recorded as *known* rather than left to read
as *nobody has looked*.

`ERROR` is reported separately as parse health (86,945 nodes) and is explicitly
not treated as a type: it is the parser's name for a span it could not read, and
filing it as unclassified would have swamped the report with a number that is not
a classification question.

The census also refuses to conclude anything on an empty corpus. Its first run
found zero files (a wrong default path) and printed *"all 0 node types in the
corpus are classified"* — a vacuous pass, exit 0, on the strength of having
measured nothing. A gate that can pass by measuring nothing is worse than no gate.

```sh
bun run script/m14/vb-node-type-census.ts    # every node type is classified
bun run script/m14/vb-node-type-yield.ts      # every declaration yields something
bun run script/m14/verify-field-reads.ts      # no repeated field read as singular
```

## Three structural gates, and why a count cannot see a missing thing

Every gate in this lane was built after a defect was found, and each of the last
several defects had the same shape: **something that should have been published
was not, while every count stayed healthy.** A metric that counts what exists
cannot report a class that does not exist. So the lane now has three structural
gates that ask about *coverage* rather than output.

| gate | asks | would have caught |
|---|---|---|
| `vb-node-type-census.ts` | is every node type the grammar produces **classified**? | `array_creation_expression` in neither set; `implements_member_clause` filed as silent |
| `vb-node-type-yield.ts` | does every declaration node type **publish something**? | constructors, operators, interface members — all classified, all visited, all silent |
| `verify-field-reads.ts` | is every **repeated** field read by a walk, not a singular accessor? | the modifier read |

### The yield audit is the one that finds whole missing kinds

A node type can be classified, have a dedicated visitor, and still publish
nothing. Three of this lane's largest defects were exactly that:

- **constructors** — classified, visited, and the empty-name guard returned before
  the naming contract, so 12,549 symbols contained zero of them;
- **operators** — classified, visited by a dedicated `visitOperator`, and produced
  nothing twice over: the same guard, plus an `isKeyword` test that returned true
  for the operator's own symbol;
- **interface members** — three node types in neither set, so nothing dispatched
  them and every interface was an empty shell.

It works by walking the corpus twice over the same trees — once counting
declaration *nodes* by type, once running the analyzer and counting the symbols it
publishes by their own recorded `grammarNode` — and reporting any type that
appears as a node and yields no symbol.

Two results are worth having on the record:

**The yield is exactly 1:1.** Over the covering sample, every type's symbol count
equals its node count — method 665→665, constructor 19→19, interface method
42→42, property 50→50. The single exception is `field_declaration`, which yields
*more* symbols than nodes, and that is the declarator rule working: `Dim X, Y,
width As Integer` is one field node and three members.

**It costs 7 files, not 2,660.** A first version drew the first 600 files and
reported two types as "not exercised by this sample" — the audit admitting it knew
nothing about the very types the interface fix was about. So the sample is now a
**greedy set cover**: a cheap parse-only pass finds which files contain which
declaration types, and the analyzer runs only on the files needed to exercise all
nineteen. Total type coverage, 1/380th of the cost, and a rare construct can no
longer hide behind an unlucky draw.

### Every gate here has been made to fail on purpose

A gate that has only ever passed is not evidence. The first attempt at
self-testing the yield audit **did not work**: the fault I injected was
`if (opName === "__never__") return`, a condition that is never true, so the gate
correctly reported green on an analyzer I believed I had broken. Re-injected
honestly — `visitOperator` returning immediately — the gate reports
`operator_declaration 14 nodes, 0 symbols — DEAD VISITOR` and exits 2.

That is worth writing down, because it is the same failure mode as the surviving
mutant: a test that cannot fail is worse than no test, and the only way to know is
to try to break it on purpose and check that it noticed.

The census has the same property and records it too — its first run found zero
files and printed "all 0 node types in the corpus are classified", a vacuous pass
at exit 0. It now refuses to conclude on an empty corpus.

## The rotation was not rotating, and every "100 %" was one file set

This is the most important thing found in this lane, and it was found by a
measurement that should not have been possible.

I ran a frozen A/B and an unfrozen run minutes apart. They reported the same
`sampleSetHash` while their truth counts differed — 911/911 and then 930/34. The
same hash is a hash of the drawn file paths, so two different file sets cannot
share one. Something was wrong with the sampling, and it turned out to be this:

```ts
h = Math.imul(h ^ (h + i), 2246822519)
const j = Math.abs(h) % (i + 1)
```

The seed hash is fine. The **shuffle** is not: `h ^ (h + i)` perturbs only the low
bits of `h` and then spreads them upward, so two completely different seeds
converge. Measured over 1,880 items, the permutations for two seeds differed in
**nine positions out of 1,880**, and the first sixty were **identical every time**.

The cold-pool rotation is documented — in this file and in the harness — as "each
lane prefers files never sampled before, deterministically seeded per rotation
counter … every wave sees fresh files". That holds only while never-sampled files
remain. Once the pool saturates, which it did after the full-corpus sweeps, every
"wave" drew **the same 60 files**, and a rotation that draws the same files every
wave is not a rotation. A whole-kind defect could have sat in the other 1,871
files indefinitely and no amount of re-running would ever have found it.

Fixed by driving the shuffle with mulberry32 — a real PRNG with proper avalanche —
seeded from the same FNV state. The draw now varies:

| rotation | truth edges | covered | missing | unexplained |
|---:|---:|---:|---:|---:|
| 7 | 671 | 670 (99.9 %) | 1 | 0 |
| 21 | 658 | **658 (100 %)** | 0 | 0 |
| 99 | 646 | **646 (100 %)** | 0 | 0 |

**So what this changes about the record.** Every "100 % on a 60-file draw" quoted
earlier in this file was measured on *one* file set, drawn over and over, and I
reported it as though rotation were providing fresh coverage. It was not. The
honest reading of those numbers was "100 % on 60 files, and I had not looked at
any others" — which is a much smaller claim, and the difference is the whole point
of a differential.

Two consequences worth keeping:

- The **full-corpus** sweeps were the only measurements that were ever honest about
  coverage, which is why they found the interface members, the operators and the
  modifier read that the draws never could.
- `BB_F5_FREEZE_POOL` used to mean "replay the current rotation", which is not a
  freeze at all: the rotation counter is shared state, so any other lane's
  unscoped sweep moved the wave between two of my runs. It now takes the rotation
  **number** — `BB_F5_FREEZE_POOL=7` is reproducible whatever anyone else does.

## The modifier read — the largest defect this lane has had

`modifierNames` read `childForFieldName("modifiers")`. That returns **one** node,
and this grammar emits the field **repeatedly**, once per modifier:
`Public Overrides Sub Go()` is `modifiers: (member_modifier) modifiers:
(member_modifier)`. So the read returned `public` and silently dropped
`overrides` — and the same for every modifier written after the first.

VB writes `Public` first by convention, so **the one modifier that was ever read
was the one least worth reading.** Everything modifier-dependent was wrong:

| written | read | consequence |
|---|---|---|
| `Public Shared Sub A()` | `public` | `isStatic: false` on every shared member |
| `Public Overrides Sub/Property` | `public` | **zero** `overrides` edges across 435 files |
| `Public Const F As Integer` | `public` | published as a `Variable`, not a `Constant` |
| `MustOverride`, `ReadOnly`, `NotInheritable` | — | all missed |

**It was found because the documentation claimed `overrides` was published and it
was not.** That is the only kind of false claim that reliably gets checked, and
it is worth being explicit that the claim was ours.

Fixed by reading every `member_modifier` node rather than a field that appears N
times. The consequences, corpus-wide over 435 files:

- `isStatic` now true for every `Shared` member;
- `Const` fields are `Constant`, not `Variable`;
- **480 `overrides` edges**, from zero.

And the edge shape was fixed at the same time. It was `overrides Go -> Go` — a
**self-edge**, the same un-navigable shape the member-level `implements` edge had.
The base type was available all along: the owning type's `Inherits` clause had
already been read to publish `extends`. So the edge is now
`overrides Description -> Item.Description`, and it is read on **properties and
events** as well as methods — `Public Overrides Property` is how P3D's entire `Item`
hierarchy is written, and it published nothing.

The harness noticed the other half of this. `overrides` is in the default audited
label set, so the moment the analyzer began emitting it, **42 of its edges came
back UNEXPLAINED (5.1 % of audited output)** because the oracle had no opinion.
That is the #910 lesson in its purest form: a label the analyzer publishes and the
oracle cannot derive is a manufactured red, and a label neither derives is a
manufactured green. The oracle now derives `overrides` from the modifier and the
owning type's `Inherits`, reading the base structurally rather than by scraping
text.

Two mutants pin it: one reverts the modifier read, one unqualifies the override
target. Eight VB mutants, all caught.

## Is this lane done? A command, not an opinion

`script/m14/verify-vb-lane.ts` is the checklist this page is audited against. It
exists because "the analyzer is finished" kept getting answered by assertion, and
because several claims in this file were true when written and stopped being true
without anybody noticing — the sampler went on drawing the same 60 files for a
whole session, and a `100 %` on one file set was reported as a corpus result.

```sh
bun run script/m14/verify-vb-lane.ts
```

**Current state: 13 of 14 criteria met.** Proven mechanically, not asserted:

| | criterion | evidence |
|---|---|---|
| 1 | zero regex in the analyzer | no `RegExp`, no pattern-taking string method, 1,676 lines |
| 2 | no unknown symbol kinds | 0 of 768 symbols outside the product's own kind set |
| 3 | no empty symbol names | 0 of 768 |
| 4 | every relationship has a 1-based line | 0 without one |
| 5 | every relationship's line is **correct** | 0 cite a line where the target name is absent, 0 beyond EOF |
| 6 | no unexplained relationships | 2,363 files, 39,045 audited truth edges, **0 unexplained** |
| 7 | every node type is classified | 145/145 |
| 8 | every declaration yields a symbol | 19/19 types, 1:1 yield, from a 7-file set cover |
| 9 | no repeated field read as singular | 4 repeated fields, all read safely |
| 10 | every mutant is caught | 9 mutants, 0 surviving |
| 13 | documentation present and current | all three files, numbers match the code |
| 14 | grammar pin intact | pinned, working tree clean |

Criterion 5 is the one worth singling out, because "has a line" and "has the
*right* line" are different claims and only the second one matters to somebody
navigating to a definition. It checks the target name is actually present within
three lines of the cited line, across 1,882 relationships. Zero wrong. The two
contract literals are excluded and the exclusion is stated in the output: a
constructor is published as `constructor` and the source says `New`, so expecting
the literal on that line would be checking that the source says something it does
not.

**Open, and neither is an analyzer defect:**

- **11 — `M14.0.F5` has no `vb` row.** A scoped `--lang vb` run deliberately
  refuses to write that artifact: it is the 30-language sweep's claim, and a
  one-language write would replace a bigger claim with a smaller one. It needs the
  canonical sweep, which is not one lane's to run.
- ~~**12 — the M60 surfaces do not carry the lane.**~~ **Closed.** The M60
  surface audit is the check that asks the questions the user-facing criteria
  actually ask — every label the lane emits, whether each edge carries its line,
  whether each carries the seam keys a consumer reads, and whether a published
  name is written in the file at all — per label, over real corpora. On a 400-file
  draw it reads **clean**: 7 labels, 12,327 edges, **0** without a line, **0**
  with line 0, **0** missing a seam key, **0** names not in source, **0** ghost
  targets. The artifact is `validation/m60/vb/lane-surface-audit.json`.

  Getting it to read clean for the RIGHT reason took two fixes to the audit
  itself, both of which were false positives against this lane:

  - **393 symbol names and 376 relationship targets flagged as "not in source"**
    were the contract literals `constructor` and `operator`. The source says `New`
    and `+`, and csharp and typescript publish the same literal (five sites each),
    so this is a family contract the check did not know about. It is now a
    **separate disclosed channel** — `contract literals: N` is printed beside
    `ghosts: 0` — rather than a suppression, so the difference between clean and
    excused stays visible. It is keyed to the symbol KIND, so a class genuinely
    called `constructor` somewhere is still reported.
  - **4 enum members named `None` were flagged as "a name that is not a name"**,
    because the placeholder list contains `none` for python's null literal and
    `None` is an idiomatic zero member of a .NET enum — P3D writes it in three
    files. A null literal stands in for a VALUE, so the check is now scoped to the
    kinds that denote one; python is unchanged and still reads 0.

And one thing the checklist deliberately does **not** paper over: criterion 6 passes
on *zero unexplained*, not on *zero missing*. Seven of 39,045 audited edges are
missing (99.98 %), and 4,504 `references` edges sit at confidence 0.6 because the
type they name is not in the file. "100 % output coverage" is not literally true
and should not be written as if it were.

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
4. **One fixture file and six mutants (F3/F4), and the F8 node-type census is
   done** — 145/145 classified. Still missing: a parse-success floor (F10), a
   closure-wave record, and a completion-matrix tick.
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
