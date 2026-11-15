# `script/m14` AND `src/ast` — THE UNION DISPOSITION, 122 PATHS

**Both batches are dispositioned by artifacts the lanes already committed. Nothing here is newly decided;
what is new is that the counts now close against the tree.**

## `script/m14` — 69 paths

| group | paths | disposition |
|---|---|---|
| **`spec/*-completeness.json`** | **26** | **UNIONED IN-FILE, key by key, with 23 value conflicts recorded in `_unionConflicts` — none dropped silently** |
| the rest | **43** | **named in `validation/m14/verification/union/TRIAGE.md` (771 lines) with BOTH sides' unique lines printed per path** |

**NOT named in a triage artifact: 2** — listed rather than assumed:

* `script/m14/json-mutants.ts`
* `script/m14/resumable-walk-selftest.ts`

**AND THE SLICE'S OWN CLOSURE STATEMENT**: *"111 paths classified → 23 needing nothing · 24 spec JSONs unioned
(23 conflicts recorded in-file) · 22 code paths taken or closed with per-path evidence · **10 recovered defects** ·
4 divergences recorded rather than half-unified."* **`differential.ts`'s hunk map is FULLY RESOLVED — every one of
its 56 hunks is ported or named as superseded.**

## `src/ast` — 53 paths

**All 53 are named in a committed triage artifact** — `validation/m14/union/README.md` (151 lines, each path
with what each side had and the verdict) and `src-ast-triage.txt` (62 lines, the raw table), produced by the
instrument `triage.py`.

**AND THE INSTRUMENT DECLARES ITS OWN FAILURE MODE**: *"The unmatched count is ALIGNMENT-SENSITIVE — absorbing a
block re-aligns the diff and strips neighbours of their near-matches — so it must be read PER FILE beside the
main-only count, NEVER as a batch total."* **Measured on `parallel-indexer.ts`: main-only 964 → 778 while unmatched
ROSE 573 → 688.**

**AND THE ONE FILE IN THIS BATCH THAT IS NOT A DISPOSITION BUT A NAMED RESIDUAL WITH AN INVENTORY**:
`real-typescript-analyzer.ts` — *this branch has **NONE** of main's marking subsystem (**five symbols, zero
occurrences each**), and the port is **four pieces in TWO DIFFERENT SCOPES**, which no diff shows.* **The file is
byte-identical to HEAD and green; the inventory is the deliverable.**

## WHAT IS NOT CLAIMED

**That these paths are RESOLVED in the sense of a content decision.** *`fixtures` and `spec` are decided by
measurement; the rest are **named with their evidence**, which is a disposition but not a merge.* **The counts now
close against the tree because every path in both batches is accounted for — that is all this document says.**
