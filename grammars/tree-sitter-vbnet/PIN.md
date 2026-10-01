# tree-sitter-vbnet — the VB.NET grammar pin

**This is the weakest pin in the repository, and the file says so.** Every other
pinned lane pins a published artefact. This one pins a build of a source file
this repository owns, because there was nothing to pin.

## What the product had before this

`.vb` was a routed extension (`src/ast/language-detection.ts:45`) and `vb` was a
declared `DetectedLanguage` (`language-detection.ts:7`), but `engine.ts` routed
it to `__generic__`. So a `.vb` file was *detected* and *analysed* by a regex
generic analyzer, which cannot see a Class, a Function, an `Implements` clause or
a call site. The lane published no symbols and no relationships for VB.NET, and
it did so **quietly** — the file was reported as analysed rather than refused.
`validation/m60/results/LCM.json` listed `vb` under `nonAnalyzerDetected`, which
is the honest record of exactly that.

There was also no grammar to route to: `tree-sitter-vb` and
`tree-sitter-visual-basic` are both 404 on npm, and `tree-sitter-wasms@0.1.13`
— the bundle that supplies 39 of this repo's grammars — ships no VB at all.

## The base, and the bake-off

Two VB.NET grammars exist. Both were built to ABI-15 wasm and run over the same
corpora with the same loader (`fixtures/probes/grammar-bakeoff.ts`):

| candidate | 600-file P3D draw, clean | named node types |
|---|---|---|
| `govindbanura/tree-sitter-vbnet` | **58.50 %** | 170 |
| `CodeAnt-AI/tree-sitter-vb-dotnet` | 29.50 % | 107 |

`vbnet` won, and is vendored into `grammars/tree-sitter-vbnet/`. It has
`supertypes` and a `word` token; `vb-dotnet` has neither.

Its own quality on arrival was nowhere near enough. On Microsoft's
`Microsoft.VisualBasic.Core` — 75 files of the VB runtime Microsoft ships — it
parsed **38.67 %** of files cleanly.

## The 18 repairs

Every one has a minimal repro under `fixtures/grammar-repro/cases/`. The list is
authored in `script/m14/verify-grammar-pins.ts` under `LANES.vb.provenance.patches`
and repeated here because the pin's field is a machine list and this is the
reader-facing one.

The ones that mattered most, and why:

1. **`repeat` on `attribute_list` in 14 member positions.** Upstream allowed
   *one* attribute list per member. Consecutive attribute lists are the standard
   C#-and-VB pattern, and this single change moved the authoritative corpus from
   49.33 % to 62.67 % clean.
2. **File-scoped `Namespace N` (VB 15+).** Upstream required `End Namespace`.
   The first fix made the terminator optional; that was **wrong and measured so** —
   an optional `End Namespace` also "succeeds" for a file that *has* one, leaving
   it dangling and hoisting the classes after the early reduction to file scope.
   The shipped form is two alternatives, with the file-scoped one pinned to the
   file's **last** position, so its body can only end at EOF.
3. **VB statement lambdas.** Upstream had half of one shape. Three separate
   omissions: the parameter list could not be absent (`Sub() ... End Sub`), there
   was no `As T` return clause, and there was no terminator at all.
4. **The lambda terminator must not eat the enclosing statement's newline.**
   A lambda that consumed its own trailing newline left the `Dim` holding it
   with nothing to close on. The signature was unmistakable once measured: a
   statement lambda followed by **any** further statement failed (4/4 shapes),
   while the same lambda as the *last* statement in a method passed.
5. **`&H`/`&O`/`&B` literals** with per-radix digit classes, and the `%/&/!/D/F/R/
   I/L/S/US/UI/UL` type characters.
6. **`!`, `#`, `@` on float literals.** `#` and `@` are VB6's legacy suffixes.
   An earlier revision of the grammar *ruled them out* with a written reason
   ("`#` starts `date_literal`"). The corpus contradicted the ruling:
   Microsoft's own `Financial.vb` writes `Period - 1.0#`. A ruling a real corpus
   contradicts is a guess with a comment attached; it was withdrawn, and
   accepting the suffixes gained +2.66 % on the authoritative corpus.
7. **`Declare ... Lib "dll" Alias "e"`** — the P/Invoke member. Upstream had no
   rule for it at all.
8. **`repeat` after `=`/`,` initializers, and `With { … }` after `As New T`.**
   The second was a regression I introduced while fixing the first, caught by the
   corpus gate and not by any fixture.

## What the pin proves, and what it does not

It **does** prove, and the gate re-measures all of it on every run:

- the wired bytes' sha256 and length;
- the grammar's **enumerable surface** through `web-tree-sitter` — 449 ids,
  165 named, 283 anonymous, 54 fields, plus id-order / type-set / field-set
  digests that agree between two builds of the same source even when the bytes
  differ;
- that two local copies (`~/.bb/wasm/` and the build output beside the vendored
  source) are byte-identical to the wired bytes;
- per-file sha256 for all 12 vendored files, so a hand edit to `grammar.js`
  cannot pass unnoticed;
- the **source↔wasm proof**: all 171 names the source declares are present in the
  wired wasm (6 of them `supertypes`, which are hidden by design and so are looked
  up in the wasm's whole id space), and all 165 wasm-named types are declared by
  the source. Zero difference in both directions.

It does **not** claim this is the best available VB.NET grammar. It is the best of
the two that exist, and it is **not finished**: see below.

## The measured state, and the floor

`fixtures/grammar-repro/grammar-gate.sh` is the gate. It runs two halves:

- **27 repro cases** — the fast inner loop, one per defect class;
- **the corpus differential** — `fixtures/probes/grammar-baseline.ts` over four
  independent corpora, compared against `fixtures/validation/grammar-floor.json`.

The corpus half is the load-bearing one, and it exists because of a specific
event. A change that made `_name_reference` accept `generic_name` — so that
`Implements IComparable(Of C)` would parse — kept **all 26 repro cases green**
and took the corpus from 89.79 % to 32.49 % aggregate clean, with every bad file
carrying exactly one error node. That is the signature of a grammar that has
stopped parsing, not of a missing production, and no fixture suite can see it:
the fixtures cover the shapes the lane knows about, and that regression lived in
the interaction of a name rule with `qualified_name`'s qualifier.

| corpus | files | clean | clean % | crash |
|---|---:|---:|---:|---:|
| runtime-mvb (`dotnet/runtime`, `Microsoft.VisualBasic.Core`) | 75 | 61 | 81.33 | 0 |
| p3d-legacy (`P3D-Legacy/P3D-Legacy`) | 600 | 558 | 93.00 | 0 |
| dismt (`CodingWonders/DISMTools`) | 400 | 361 | 90.25 | 0 |
| tankexporter (`mikeoverbay/TankExporter`) | 110 | 96 | 87.27 | 0 |
| **aggregate** | **1185** | **1076** | **90.89** | **0** |

Where it started: 38.67 % on the authoritative corpus, 58.50 % on the P3D draw.

**One file in eleven still carries an ERROR.** The remaining defect classes are a
long tail — 324 distinct failure signatures across 112 bad files, with no class
above 5 files — so the cheap wins are spent and the rest is long work. The work
list is `fixtures/probes/defect-census.ts`, which ranks defect classes by the
number of *files* each one costs.

## The encoding finding, which is a product gap and not a grammar gap

40 of P3D's 1880 `.vb` files are **UTF-16 with a BOM** — Windows Forms Designer
output. Read as UTF-8 they are `N.a.m.e.s.p.a.c.e` and are a whole-file ERROR for
*any* grammar. The corpus reader strips the BOM
(`fixtures/probes/vb-source.ts`) so the grammar is measured on text.

That leaves a real product requirement, recorded here so it is not lost:
**`readFileSync(path, "utf8")` is not a correct VB reader.** A VB.NET product that
does not detect UTF-16 will report whole files as erroring for a reason that has
nothing to do with the code.

## Files

| file | role |
|---|---|
| `grammar.js` | the grammar, with every repair carrying its reason inline |
| `tree-sitter.json` | required for ABI 15 |
| `package.json`, `LICENSE`, `README.md` | vendored from upstream |
| `src/grammar.json`, `src/node-types.json` | tracked: the source↔wasm proof inputs |
| `src/parser.c` | **ignored** — 29 MB, regenerated by `tree-sitter generate` |

Rebuild:

```sh
export PATH="$HOME/.local/bin:$HOME/fixtures/bin:$PATH"
cd grammars/tree-sitter-vbnet
tree-sitter generate && tree-sitter build --wasm --docker
cp tree-sitter-vbnet.wasm ../../wasm/
```

Then `fixtures/grammar-repro/grammar-gate.sh` and
`bun run script/m14/verify-grammar-pins.ts --write`.

The pristine upstream `grammar.js` is kept at
`$HOME/fixtures/grammar-eval/tree-sitter-vbnet/grammar.js`, so the patch
set is diffable against its base rather than only readable in place.

Upstream: `github.com/govindbanura/tree-sitter-vbnet` (MIT). No npm package, no
release tag, 2 stars. That is why this is a local rebuild and not a pin of a
published build.
