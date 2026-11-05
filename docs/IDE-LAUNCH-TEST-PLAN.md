# IDE lane — launch test plan

What to run before calling the IDE lane launchable, in the order that fails fastest,
with the result each command is expected to print. Everything below was executed on
this machine in the current session; the counts are the ones actually observed, not
targets.

Two rules while testing:

- **Run latency gates alone.** `verify-hover-coverage` and `verify-cross-platform`
  miss their budgets when other gates run concurrently. A miss under load is a
  property of the machine, not of the product, and both gates print the load average
  beside every number so you can tell the difference.
- **Do not commit between a gate run and the governance gate.** Evidence is pinned
  to the commit it was measured at. Committing is safe — evidence stays valid as an
  ancestor pin when nothing relevant changed — but for a clean read, seal then read.

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

The hover gate is the one that proves the §3 budget: warm hover p95 under 50 ms on
all three busy shapes. If it fails, check the load average it prints before reading
it as a regression.

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
```

`E5` launches a real VS Code, installs the extension and drives it. It needs a
writable `XDG_RUNTIME_DIR` — if it reports `0/0 in-editor checks passed`, check for
`listen EROFS` in its output before concluding anything about the product.

## 3. Governance — the chain

```
npx tsx script/m24/verify-governance.ts          # M24 VERIFIED 29/29
npx tsx script/m25/verify-governance.ts          # M25 93/94 — see §5
npx tsx script/m25/verify-closure.ts             # M25 X1 36/37 — see §5
npx tsx script/m42/verify-rich-hover.ts          # 71/71, 7/7 mutants
```

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

## 5. Known open items at the time of writing

- **M25 `bar1`** — needs an owner waiver recorded for the fork legs (Antigravity
  launches without starting its extension host; Cursor and Windsurf are not
  installed). The bar accepts *either* a fork verified at I4 *or* all forks blocked
  with an owner waiver; the second is a decision, not a fix. Until it is recorded,
  `verify-governance` reads 93/94 and `verify-closure` 36/37, both on this one item.
- **E6 / Antigravity** — launches, accepts the full VS Code test CLI, starts no
  extension host. Recorded blocked with the mechanism and the searched paths. Not a
  waiver of anything: nothing is claimed for it.
- **E7 darwin / windows** — CI-pending by design; `.github/workflows/os-matrix.yml`
  runs them on push to `main`.

## 6. How to read a failure

The single most useful habit from building this: **a precise failure message is
evidence of where to look, never of the cause.** Five legs were red in this lane
with specific, plausible and wrong labels — a packaging leg that "needed a token"
(died on a read-only npm cache), an in-editor leg that "needed an external fixture"
(could not create a socket), an activation check that "found a missing language"
(matched literal source text against a derived list), an install leg that "failed to
tear down a profile" (the same socket), and a milestone that "invalidated its own
evidence" (its ledger was listed as relevant to itself).

Instrument before theorising. Printing the actual value ended nine rounds of wrong
hypotheses on one defect in a single run.
