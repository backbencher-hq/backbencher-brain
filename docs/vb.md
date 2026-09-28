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
| Analyzer | `src/ast/real-vb-analyzer.ts` — 1,232 lines, **AST-only, zero regex** |
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
| symbols | **12,549** |
| relationships | **33,910** |
| imports | **1,157** |
| crash files | **0** |
| pipeline mismatches | **0** |
| empty symbol names | **0** |
| unknown symbol kinds | **0** |
| **relationships without a site line** | **0** of 33,910 |

Grammar parse success over **1185 files** on four corpora: **90.89 % clean,
0 crash files** (from 38.67 % on Microsoft's own `Microsoft.VisualBasic.Core`
when the upstream grammar was first wired).

| corpus | files | clean % |
|---|---:|---:|
| `dotnet/runtime` → `Microsoft.VisualBasic.Core` | 75 | 81.33 |
| `P3D-Legacy/P3D-Legacy` | 600 | 93.00 |
| `CodingWonders/DISMTools` | 400 | 90.25 |
| `mikeoverbay/TankExporter` | 110 | 87.27 |

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
written on.

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

1. **The grammar is 90.89 %, not complete.** 112 of 1185 files still carry an
   ERROR; the remaining defect classes are a long tail (324 distinct signatures,
   none above 5 files).
2. **No F5 differential lane.** The corpus numbers above measure the *grammar*.
   The analyzer's own differential — a tree-derived oracle compared against
   analyzer output, with MISSING / unexplained / heuristic-class counts — does
   not exist yet. This is the largest single gap.
3. **414 members carry no `ownerName`** — and the attribution is decisive: 414
   inside grammar-errored files, **0** in a cleanly-parsed file. The ownership
   logic is correct; when the grammar collapses a class into an ERROR the class
   symbol is lost, and the members still recovered from inside that ERROR have no
   owner to name. Fixing this belongs in the grammar.
4. **No fixtures, no regression mutants, no F8 node-type spec, no F10
   parse-success floor, no closure-wave record, no completion-matrix tick.**
5. The general `:` statement separator (`a = 1 : b = 2`) is **refused, not
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
