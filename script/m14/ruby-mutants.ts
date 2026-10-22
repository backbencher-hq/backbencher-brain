/**
 * RUBY MUTANTS — the lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is a shared registry several lanes edit at
 * once, and a block written into it was silently overwritten within the hour by another lane's edit
 * — the overwrite was SILENT, the file stayed syntactically valid, and the gate kept reporting
 * numbers with this lane's mutants simply absent from them. A two-line footprint in the shared
 * file, and the work itself somewhere the lane owns. (The cpp lane's file says the same thing about
 * a 259-line block; this file's reason is the same fact measured on this lane's own registry.)
 *
 * ── WHY THIS FILE EXISTS AT ALL: THE SURVIVOR ────────────────────────────────────────────────────
 * The lane's first battery run MEASURED a survivor: `ruby/drop-implements-edge` survived at 1 → 1
 * failures. **THE DIAGNOSIS IS A NO-OP, AND THE LEAD'S RULING L-2026-10-21-07 SAYS WHAT A NO-OP IS:**
 * the mutant filters `x.type !== "implements"`, and since RUBY-D1 the ruby analyzer emits **0**
 * `implements` edges — the mixin composition is published as `mixes_in` — so there is nothing to
 * drop and no fixture can go red. **"A NO-OP MUTANT IS NOT A PASS: it is a documented no-op whose
 * replacement travels with it."**
 *
 * **⇒ THE FIX IS TO RE-SPELL THE MUTANT TO THE LIVE VALUE.** The mutant's INTENT — "drop the
 * mixin-composition edge and see whether a fixture notices" — is preserved by dropping `mixes_in`
 * instead of the label that no longer exists. A mutant that filters on a label the analyzer never
 * publishes is a mutant that proves nothing, and a suite that stays green whatever you do to the
 * code is decoration.
 *
 * **⇒ AND THE FIXTURE THAT CATCHES IT PINS THE SPELLING CONTRACT, NOT ONLY THE RELATIONSHIP
 * (L-2026-10-21-07, the csharp lane's measured case).** `validation/m14/fixtures/ruby/
 * mixes-in-modules.expectation.json` now carries SIX forbid rows, and the three of them on the
 * mixin rows pin `meta.mixinType` — so the keyword is forbidden in every position but its own:
 *
 *   forbid {mixes_in, MixedThing → ComparableLike, meta.mixinType: prepend}
 *   forbid {mixes_in, MixedThing → PrependedHelpers, meta.mixinType: include}
 *   forbid {mixes_in, MixedThing → SingletonHelpers, meta.mixinType: include}
 *
 * **⇒ A RELATIONSHIP-ONLY FORBID WOULD NOT CATCH A RE-SPELLING**, and that is the whole point: a
 * mutant that changed `meta.mixinType` from `include` to `prepend` would still be a `mixes_in` row
 * from `MixedThing` to `ComparableLike`, so a forbid carrying only `{type, from, target}` would
 * PASS it. **The meta key in the FORBID is what makes the keyword part of the contract**, and the
 * positive rows carry the same key so the two halves agree.
 *
 * **⇒ AND THE RE-SPELLING MUTANT BELOW IS THE MIRROR OF THAT CONTRACT**: it re-spells the keyword
 * rather than dropping the row, so it is caught by the forbids, and it is caught by them ONLY
 * because they pin the meta key. **A relationship-only forbid would let this mutant survive too.**
 */
import type { Mutant } from "./mutate-analyzer"

/**
 * THE RE-SPELLED MUTANT — the live-value spelling of the no-op survivor.
 *
 * The pre-fix (defect) behaviour is: a mixin composition is published under the OLD label
 * `implements` instead of the canonical `mixes_in`. That is exactly the shape of the defect the
 * RUBY-D1 relabel corrected, so the mutant reproduces the pre-relabel output: the same construct
 * sites, the same rows, the SAME KEYWORD — only the LABEL differs. The `meta.mixinType` is
 * DELIBERATELY PRESERVED, because the point is that the SPELLING of the label is the defect, and a
 * mutant that also dropped the keyword would be a different defect that the fixture's other rows
 * already cover.
 *
 * **CAUGHT BY** `ruby/mixes-in-modules` — the `implements` forbid row (the row that forbids the
 * OLD SPELLING outright) fires, because the mutant publishes `implements` rows where the fixture
 * requires `mixes_in` rows.
 */
const dropImplementsEdge: Mutant = {
  id: "ruby/drop-implements-edge",
  language: "ruby",
  defectClass: "relationship-loss",
  description:
    "drops ruby module-mixin composition edges — the LIVE spelling of the label is `mixes_in` since RUBY-D1, and this mutant reproduces the PRE-RELABEL output (the same construct sites, the same keyword, the old `implements` label). RE-SPELLED 2026-10-21: the previous spelling of this mutant filtered `implements` while the analyzer emitted 0 implements edges since RUBY-D1, so it was a NO-OP that could never make the suite red (measured: 1 -> 1 failures, the lane's one survivor). L-2026-10-21-07: a no-op mutant is not a pass, it is a documented no-op whose replacement travels with it — so the mutant now filters the LIVE value and is caught by the fixture's `implements` forbid row. Caught by ruby/mixes-in-modules.",
  transform: r => ({
    ...r,
    relationships: (r.relationships ?? []).map((x: any) =>
      x?.type === "mixes_in" ? { ...x, type: "implements" } : x,
    ),
  }),
}

/**
 * THE KEYWORD RE-SPELLING MUTANT — the pair that makes the forbids' meta keys load-bearing.
 *
 * The pre-fix (defect) behaviour is: the mixin keyword is recorded wrongly — an `include` is
 * recorded as a `prepend`. The relationship is IDENTICAL (same type, same source, same target); only
 * the `meta.mixinType` spelling differs. **A FORBID THAT PINNED ONLY THE RELATIONSHIP WOULD PASS
 * THIS MUTANT**, which is precisely the csharp lane's measured hole (73 mutants, 1 survivor,
 * invisible because the defect emitted the owner-qualified spelling while the forbids pinned the
 * bare one). It is caught by the three `meta.mixinType` forbid rows in
 * `validation/m14/fixtures/ruby/mixes-in-modules.expectation.json`, and by nothing else.
 */
const respellMixinKeyword: Mutant = {
  id: "ruby/respell-mixin-keyword",
  language: "ruby",
  defectClass: "payload-corruption",
  description:
    "re-spells the mixin keyword: an `include` composition is recorded as a `prepend`. The relationship is IDENTICAL (type, source and target all unchanged) and only `meta.mixinType` differs — so a forbid carrying only {type, from, target} would PASS this mutant, and the fixture's three `meta.mixinType` forbid rows are the only thing that catches it. This is the ruby instance of the Lead ruling L-2026-10-21-07 (the csharp lane's measured case: 73 mutants, 1 survivor, invisible because the defect emitted the owner-qualified spelling while the forbids pinned the bare one). Caught by ruby/mixes-in-modules ALONE.",
  transform: r => ({
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      if (x?.type !== "mixes_in") return x
      const md = x.metadata ?? {}
      const mt = (md as any).mixinType
      if (mt === "include") return { ...x, metadata: { ...md, mixinType: "prepend" } }
      if (mt === "prepend") return { ...x, metadata: { ...md, mixinType: "include" } }
      return x
    }),
  }),
}

export const RUBY_MUTANTS: Mutant[] = [dropImplementsEdge, respellMixinKeyword]
