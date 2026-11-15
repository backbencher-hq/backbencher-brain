# K11 — the heuristic bucket needs a per-label breakdown (PATCH, NOT APPLIED)

## Status

**Verified working, deliberately not applied to `script/m14/differential.ts`.**

`k11-heuristic-by-label.patch` is a self-contained diff against
`script/m14/differential.ts` as of `4804a789` (the last commit in which that file
parses). It was built and **executed** in a clean replica:

```
[Exposed] kotlin: files=60 tree-truth=5712 covered=5712 (100%) MISSING=0
  | analyzer-edges=3792 unexplained=0 (0%) heuristic=138 [overrides=138] hash=...
```

and, for a lane with an empty bucket, the summary line is **byte-identical** to
before (no bracket is emitted):

```
[clj-kondo] clojure: files=25 tree-truth=713 covered=713 (100%) MISSING=0
  | analyzer-edges=211 unexplained=0 (0%) heuristic=0 hash=...
```

## Why it is not applied

`HEAD:script/m14/differential.ts` **does not parse**, and has not since the merge
`7b667d5b`. Six language registrations — `hcl`, `make`, `nim`, `perl`, `sql`,
`vb` — were appended to the **end of the file**, after a function's closing
`return edges }`, instead of inside the `LANGS` record (declared at line 604,
closing at 740). At top level `hcl: { … }` parses as a *labelled statement*, so
the whole file is a syntax error and **the differential cannot run for any
workstream**. `make:` is additionally unclosed.

`4804a789` is the last commit whose copy of that file parses, and it has none of
those six entries at all — so this is a mis-anchored insertion, not a stale
duplicate.

Applying the patch on top would add 46 lines to an already-unparseable file and
would not make it parse. Repairing the misplacement means relocating six
registrations into `LANGS`, which is another workstream's change and not
knowingly safe from here: a registration whose `wasm` or `analyzerFile` is
absent would make that lane fail in a new way, and the intent behind each entry
(including whether `make` and `vb` have fixtures and completeness specs) is not
knowable from the diff.

## Apply with

```bash
# after script/m14/differential.ts parses again
git apply validation/m14/patches/k11-heuristic-by-label.patch
npx esbuild script/m14/differential.ts --outfile=/dev/null   # expect no ERROR
```

## What it changes

`heuristic=N` is a bare count, so it says nothing about which labels are in it.
That matters because of how the bucket is formed — at `differential.ts:18454` an
unmatched analyzer edge below confidence 0.7 is counted as `heuristicUnexplained`
and **excluded from `unexplained`**, which is a defensible policy (a
low-confidence edge is declared suspicion, not fabrication).

Kotlin is the case that makes the gap concrete. `deriveTreeEdges(root, "kotlin")`
emits `extends` / `instantiates` / `implements` and **never `overrides`**, so
every kotlin `overrides` edge is unmatched by truth *by construction*. On real
code essentially all of them sit below 0.7 — Exposed's and kotlinx's hierarchies
are cross-module, so the in-file BFS cannot verify the declarer and the
first-supertype-guess tier takes every one. The measured result is
`unexplained=0`, `heuristic=138`, and **65.2% of those rows naming the wrong
parent** (`KDJ-1`, checked against a repo-wide type index over 791 files).

The number was not wrong and the policy was not wrong. The **reporting** was:
nothing at the summary line let a reader see that an entire label lived in the
excluded bucket. `heuristic=138 [overrides=138]` is the difference between a
number a reader can act on and one they cannot.

## Note for whoever applies it

`npx tsc --noEmit` does **not** check this file. `tsconfig.json` has
`"include": ["src/**/*.ts"]`, so every `script/m14/**` file is outside the
project. Any "tsc clean" claim about `differential.ts` — including several made
during this review — was **vacuous**. Use `npx esbuild <file> --outfile=/dev/null`
or `npx tsc --noEmit <file>` to check it for real.
