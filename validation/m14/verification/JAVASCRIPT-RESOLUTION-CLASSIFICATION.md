# JavaScript — RESOLUTION CLASSIFICATION

**Author: Muhammad Ishaq Khan.**
**REGENERATED 2026-11-13.** The original of this page was deleted from this working tree by the 0.1.5
release cycle and exists in **no git history** (`git log --all` finds no commit for it), so it cannot be
restored. This is rewritten from the code and the instruments as they stand now; every shape below was
read out of `src/ast/real-javascript-analyzer.ts` rather than recalled.

## The four answers a row can get

Every emitted row falls into exactly one class when the arbiter examines it:

| class | meaning |
|---|---|
| **resolved** | the target names a declaration in the same project |
| **claimed** | the target does not name a declaration, and the row carries a claim the arbiter can verify (`isExternalTarget` + reason, `importedBinding`, `BINDING_SEP` binding) |
| **unresolved** | neither of the above — this is the honest gap |
| **refuted** | the row carries a claim the evidence CONTRADICTS (a claim that would launder a gap) |

A claimed row is not a pass for the analyzer's benefit: `classifyEdge` refutes a binding claim outright
when the target can name a declaration, so a lane cannot escape an unresolved edge by marking it.

## Why the classification is per-project, not per-corpus

Resolution is measured against the file's OWN PROJECT. The gate prints a second, pooled number beside
it because a corpus's name collisions are a property of the corpus, not of production resolution — and
the two numbers disagree by design.

## The JS lane's classification evidence

- **target validity**: 0 invalid of 3,271 rows (`javascript-target-validity-census.ts`)
- **source attribution**: 0 unattributed (`javascript-source-attribution-census.ts`)
- **differential**: 100% of tree-derived truth covered, **MISSING 0**, **unexplained 0** on both svelte
  (2,184) and lodash (12,597), with stable hashes `1aa48514c0dab17a` / `494e1b94766e8ade`
- **inbound gate, index-less cap-120**: 6,799 edges, 2,900 unresolved — dominated by `imports`, which is
  the fail-closed class documented in the receiver-position contract. It is not evidence of a defect and
  the gate says so; its measurable arm needs a complete project index.

## What classification does NOT say

A PASS says the edges resolve; it does not say they point at the RIGHT declaration. That is the
differential's question, and the two instruments are deliberately separate.
