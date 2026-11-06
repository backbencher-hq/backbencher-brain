# IDE lane — launch test plan

What to run before calling the IDE lane launchable, in the order that fails
fastest, with the result each command prints when it is green. Every count
below was observed on this machine in the session that produced this file; the
ones marked *(expected)* are the last observed value and should be re-read from
the run rather than assumed.

Three rules while testing:

- **Run latency gates alone.** `verify-hover-coverage` and `verify-cross-platform`
  miss their budgets when other gates run concurrently. A miss under load is a
  property of the machine, not of the product, and both gates print the load
  average beside every number so the two can be told apart.
- **Seal, then commit, then re-seal.** Evidence is pinned to the commit it was
  measured at and stays valid while no *relevant* file changes. A commit that
  changes a gate input (a source file, a plan doc, the generated precision
  ledger) makes that gate's record stale by its own rule — which is correct
  behaviour, not a bug. The order that converges is: run the gate, commit its
  record with the artifact it reads, re-run the consumers of that artifact.
- **A killed leg is not a red gate.** The closure gate runs the whole ladder with
  a per-leg timer. If a leg reports `(killed at the Ns leg timer)` the gate did
  not fail — it did not finish. Raise that leg's `timeoutMs` in
  `script/m29/verify-closure.ts` rather than "fixing" the product.

## 0. Prerequisites

```
npm run build                                   # dist/lsp/server.js is what the in-editor legs launch
ls .tools/nvim-linux-x86_64/bin/nvim            # the wave's in-editor legs need this binary
```

The giant-repo leg needs a persistent index in `$TMPDIR/m29-giant-data`, and this
environment gives each shell a fresh `/tmp`. Build it in the **same shell** as
the measurement:

```
npx tsx script/m29/generate-giant-corpus.ts                     # 59,000 files, deterministic
npx tsx script/m29/giant-repo-budget.ts --index-only --reuse    # ~11 min
npx tsx script/m29/giant-repo-budget.ts --reuse                 # measurement
npx tsx script/m29/verify-giant-repo.ts                         # 28/28 incl. the live probe
```

If `--index-only` is skipped, `verify-giant-repo` reports
`R6: live probe skipped (no persistent index — run --index-only first)`. That is
a declared skip that fails the gate: an unmeasured server leg is not a passing
server leg.

## 1. Product gates — the lane's own behaviour

```
npx tsx script/m55/verify-identity.ts            # T1  38/38
npx tsx script/m55/verify-call-hierarchy.ts      # T2  64/64,  9/9 mutants
npx tsx script/m55/verify-relations.ts           # T3  92/92,  7/7 mutants
npx tsx script/m55/verify-signatures.ts          # T4  67/67,  4/4 mutants
npx tsx script/m55/verify-tiers.ts               # T5  70/70,  7/7 mutants
npx tsx script/m55/verify-type-inference.ts      # T6 116/116,  8/8 mutants
npx tsx script/m55/verify-panel-placement.ts     # P1  25/25
npx tsx script/m55/verify-evidence-tree-clean.ts # clean tree
npx tsx script/m55/verify-status-panel.ts        # 42/42, 11/11 mutants
npx tsx script/m55/verify-action-args.ts         # 47/47,  7/7 mutants
```

Run these two **alone**:

```
npx tsx script/m55/verify-hover-coverage.ts      # 40/40  (latency)
npx tsx script/m25/verify-cross-platform.ts      # E7(linux) 56/56, 4/4 (latency)
```

The hover gate is the one that proves the §3 budget: warm hover p95 under 50 ms
on all three busy shapes. If it fails, read the load average it prints before
reading it as a regression.

## 2. Editor evidence — what was actually run in an editor

```
npx tsx script/m24/verify-server.ts              # L1 142/142
npx tsx script/m24/verify-hover.ts               # L2  58/58
npx tsx script/m24/verify-navigation.ts          # L3 122/122
npx tsx script/m24/verify-symbols.ts             # L4  50/50
npx tsx script/m24/verify-call-hierarchy.ts      # L5  97/97
npx tsx script/m25/run-vscode-e2e.mts            # E5  91/91 IN-EDITOR, pinned VS Code 1.85.0
npx tsx script/m25/verify-install-docs.ts        # D1-install 21/21, clean profile
npx tsx script/m25/verify-packaging.ts           # E4  56/56, real VSIX built
npx tsx script/m25/run-fork-e2e.mts              # E6  per fork; antigravity 90/90 in-fork
```

`E5` launches a real VS Code, installs the extension and drives it. It needs a
writable `XDG_RUNTIME_DIR`; the runner pins one under its output directory. If it
reports `0/0 in-editor checks passed`, look for `listen EROFS` in its output
before concluding anything about the product.

`E6` runs the same suite inside a VS Code fork. It must launch the fork's **ELF
binary**, not the `code` shell wrapper (the wrapper honours
`ELECTRON_RUN_AS_NODE` and never starts an extension host), and it must be forced
onto X11 (`--ozone-platform=x11`, `WAYLAND_DISPLAY` unset) on a Wayland desktop.
Both failure modes present as "the fork launches but starts no extension host";
the current run reaches 90/90.

## 3. Governance — the chain, in order

Each gate re-audits the previous milestone's completion bar, so they must run in
this order; a later one cannot go green while an earlier one is red.

```
npx tsx script/m24/verify-governance.ts          # M24 VERIFIED 29/29
npx tsx script/m25/verify-governance.ts          # M25 VERIFIED 94/94  (E6 blocked per fork, reason recorded)
npx tsx script/m25/verify-closure.ts             # M25 X1 VERIFIED 37/37
npx tsx script/m26/verify-governance.ts          # M26 VERIFIED 70/70
npx tsx script/m26/verify-closure.ts             # M26 X1 VERIFIED 50/50
npx tsx script/m27/verify-governance.ts          # M27 VERIFIED 73/73
npx tsx script/m27/verify-closure.ts             # M27 X1 VERIFIED 34/34
npx tsx script/m28/verify-governance.ts          # M28 VERIFIED 79/79
npx tsx script/m28/verify-closure.ts             # M28 X1 VERIFIED 31/31
npx tsx script/m29/verify-governance.ts          # M29 G1 (see §5 for the current state)
npx tsx script/m29/verify-closure.ts             # M29 X1 — the program closure over M24–M29
npx tsx script/m42/verify-rich-hover.ts          # 71/71, 7/7 mutants
```

The M29 legs individually:

```
npx tsx script/m29/verify-wave-protocol.ts            # R1  36/36
npx tsx script/m29/verify-wave-execution.ts           # R2 261/261, 14 languages, 5/5 mutants
npx tsx script/m29/verify-giant-repo.ts               # R3  28/28 (needs §0's index)
npx tsx script/m29/verify-precision-ledger.ts         # R4  19/19; --write regenerates the published ledger
npx tsx script/m29/verify-precision-improvements.ts   # R5  20/20
npx tsx script/m29/verify-wave-harness.ts             # V1  14/14 (a harness of harnesses; ~10 min)
npx tsx script/m29/verify-m29-docs.ts                 # D1  13/13
```

`R4` and `D1` assert byte-identical regeneration of `docs/m29/PRECISION-LEDGER.md`
and `.json`. The ledger inlines measurements from `R3.json` and the wave records,
so re-running those leaves it one generation behind; `--write` is the remedy, and
`script/m29/verify-closure.ts` performs it between ladder passes for that reason.

## 4. Three checks a gate cannot make for you

These need a human at a screen, and they are the reason the gate work matters —
everything above proves the machinery, these prove the experience.

1. **Fourteen-language activation.** Install the built VSIX, then open one file in
   each launched language: Java, Groovy, Kotlin, Scala, TypeScript, JavaScript,
   Python, Rust, Go, C/C++, C#, Ruby, PHP, Swift. Each must wake the extension; the
   list is derived from `src/lsp/launch_languages.ts` and the build fails on drift,
   but installing it proves what the build cannot.
2. **Status-bar click on every path** — a project with an index, a project without
   one, and a file outside any project. The command must open the panel every time;
   the earlier defect was a click that did nothing on one of those paths.
3. **The `/editors` claim table against `docs/IDE-HONESTY-CONTRACT.md` §2.** Every
   claim in the table must be a claim the contract's ladder permits, and every
   unclaimed editor must be declared unclaimed rather than omitted.

## 5. Known open items

- **M25 `E6` per-fork block.** Cursor and Windsurf are not installed on this
  machine, so their records are `blocked` with the searched paths recorded. The bar
  accepts a blocked fork *with* a reason, and the ledger therefore shows `open`
  at 10/11 rather than claiming them. Antigravity is verified in-fork (90/90); its
  earlier "starts no extension host" reading was a runner defect (shell wrapper +
  Wayland), not the fork. **No owner waiver is needed and none was written** — a
  gate that grants its own waiver has no teeth.
- **`E7` darwin / windows** — CI-pending by design; `.github/workflows/os-matrix.yml`
  runs them on push to `main`.
- **M29 `X1`** — the program-closure gate's own state is recorded in
  `validation/m29/results/X1.json`. Read the record, not this page, for whether the
  final pass is `verified` or a `known-gap` with a named precondition; the record
  names the precondition and the command that clears it.
- **Other lanes** — M42, M44, M53 and M55 have their own governance gates and
  their own ledgers. This plan covers the IDE lane (M24–M29) plus the one M42 gate
  that shares its source surface.

## 6. How to read a failure

The single most useful habit from building this: **a precise failure message is
evidence of where to look, never of the cause.** Legs were red in this lane with
specific, plausible and wrong labels — a packaging leg that "needed a token" (died
on a read-only npm cache), an in-editor leg that "needed an external fixture"
(could not create a socket), an activation check that "found a missing language"
(matched literal source text against a derived list), an install leg that "failed
to tear down a profile" (the same socket), a milestone that "invalidated its own
evidence" (its ledger was listed as relevant to itself), a fork that "does not
start an extension host" (the launcher wrapper), a projection that "read a
record's status" while silently dropping its negative-case count (a documented
record shape the reader never implemented), and a closure leg that "failed" (it
was killed by a timer nobody had measured against).

Instrument before theorising. Printing the actual value ended nine rounds of wrong
hypotheses on one defect in a single run.

## 7. Reproducing a green chain from a cold tree

```
npm run build
npx tsx script/m29/generate-giant-corpus.ts
# same shell, because /tmp is per-shell in this environment:
npx tsx script/m29/giant-repo-budget.ts --index-only --reuse
npx tsx script/m29/giant-repo-budget.ts --reuse
npx tsx script/m24/verify-governance.ts      # then m25, m26, m27, m28 governance
npx tsx script/m29/verify-closure.ts         # runs the M24–M29 ladder itself, regenerates the
                                             # ledger, then re-runs the ledger consumers
```

If a consumer is red immediately after `verify-closure`, the cause is ordering:
the closure regenerates the ledger in pass 1b and re-runs R4/V1/D1 in pass 1c, so
a consumer run *before* the closure sees the previous generation. Run the closure,
commit the ledger and the records, then re-run `verify-precision-ledger`,
`verify-precision-improvements` and `verify-m29-docs`.
