# Branch unification and post-merge remediation, 2026-10-14

This is the second half of the story told in `BRANCH-UNIFICATION-2026-10-14.md`. That
document covers the forced push and the merge. This one covers what the merge exposed,
because most of it was not visible until the two lineages were actually sitting in one tree.

## The headline

A merge of two two-month lineages is not a merge. It is a collision detector run at scale,
and the collisions it found were of three kinds:

| kind | example | who had it |
|---|---|---|
| **API silently dropped** | `blankCommentsAndStrings(src, {keepStrings})` → `(src)` | mine, lost |
| **caller survived, callee replaced** | four gates call the 2-arg form; the definition was resolved to the 1-arg side | split across both |
| **gate blind to its own subject** | a hardcoded-binary detector that could not read shell templates | both |

The first two are the ordinary cost of merging. The third is the one worth writing down.

## 1. An option five callers depended on, silently deleted

`script/m62/path_encoding_scan.ts` was a conflicted file, so it resolved to `origin/main`'s
side: `blankCommentsAndStrings(src: string)`. Four m62 gates were **not** in conflict, so
they survived from my side intact — calling `blankCommentsAndStrings(src, { keepStrings: true })`.

At runtime the extra argument was simply ignored. That is worse than a type error: the gates
ran with string bodies blanked, which is the one mode `keepStrings` exists to prevent, because
a detector hunting `execFileSync("/usr/bin/code", …)` cannot see a literal it blanked.

They had been passing vacuously. Restoring the option (the diff between the two versions was
exactly this option and nothing else — 24 lines) cost 5 type errors and bought back four
working detectors.

## 2. A gate that scanned a tree the evidence had been removed from

With `keepStrings` restored, `verify-cli-resolution` went red on three files. Chasing that
found the second layer: the gate read every file with the default blanking and matched only
the **first argument** of `execFileSync|spawn|sh`. A shell command is almost never
`sh("/usr/bin/code")`. It is

```ts
sh(`DISPLAY=${display} /usr/bin/code --user-data-dir ${userDir}`)
```

— literal text inside a *template*, in a non-first position. So four real invocations were
invisible:

```
script/m45/capture-driver.ts:104,171
script/m45/session-driver.ts:224,281
```

while the gate printed `no source invokes a hardcoded /usr/bin editor binary — 5053 files
scanned`.

`keepStrings` deliberately did not imply template preservation — for most detectors a template
body is noise — so the option was added by name: `keepTemplates`. The lesson generalises past
this gate: **when a detector's subject can be written inside a string, a string-blanking step
upstream of it has to be an explicit, named choice, and the detector needs a canary that
plants the subject in every syntax it can hide in.**

The resolver `script/lib/editor-cli.ts` already existed and already declared the right order
(override → PATH → app bundle → legacy `/usr/bin` last). On this machine it reports
`via app-bundle`, which is the proof the original defect was not theoretical: the scripts were
invoking a path that does not exist here, and the resulting failure read like "VS Code is not
installed" on a machine that has VS Code.

## 3. Ten gates counted a mutant that never ran as CAUGHT

`script/m62/verify-mutant-crash-honesty.ts` found ten sites of this shape:

```ts
try {
  const m = await import(mutantPath)
  const detected = await d.probe(m, mkDeps())
  mutant(`${d.name} (detected: ${detected})`, detected, "")
} catch (e) {
  mutant(`${d.name} (mutant errored — counts as detected)`, true, …)   // ← never exercised
}
```

If the mutant's **import** throws, the catch records it as detected. A harness whose every
mutant points at a bad path therefore reports a full catch ratio while executing nothing. That
is the specific failure the gate was written to prevent, and ten gates were doing it. The
verdict is now `false` at every site, with the label saying why.

Note what this does *not* change: a mutant that loads and then throws **during the probe** is
still a real detection, and still counts. Only a mutant that never ran is now reported as
unrun.

## The numbers

| measurement | pre-merge `origin/main` | merged tree, now |
|---|---|---|
| tsc parse-level errors (`script/`) | 21 | 6 |
| tsc total errors (`script/`) | 720 | 643 |
| hand-written product-type copies | 22 | 0 |
| checks that could not fail | 10 | 0 |
| hardcoded editor binaries in code | 4 (invisible) | 0 |
| mutants that never run, counted caught | 10 sites | 0 |

Two of the three reds the merge initially produced were **inherited, not caused**, and were
measured as such rather than assumed:

| gate | pre-merge | merged | verdict |
|---|---|---|---|
| `m62 mutant-crash-honesty` | 10 sites | 10 sites | inherited — now fixed |
| `m62 path-encoding` | 25 defects | 25 defects | inherited, untouched |
| `m62 handwritten-type-copies` | 22 | 1 → 0 | fixed here |
| `m62 gate-typecheck` | 684 vs baseline 723 | 607 vs 723 | inherited; this work improved it |

## 4. Probes that could not fail, and a fixture that could not express its defect

Three mutants in `script/m55/verify-status-panel.ts` survived, and every one of them was a defect
in the probe rather than in the product. They had survived the honesty fix precisely because
reporting them honestly is what exposed them.

**M10 — the fixture could not express the defect it named.** `status-model.ts:197` builds each
per-language row as `description: describeLevel(level)`, and `describeLevel("I4")` returns
`"I4 — editor-verified"` — the level is *already* the first thing the description says. The fixture
used free text, which `describeLevel` cannot return. So the mutation that prepends the level
produced `I4 — index-sourced, …`, a level stated **once**, and the mutant survived. Worse, the S1
assertion "no per-language row states its level twice" searched for `I4 — I4` in a fixture where
that substring could not exist however the renderer misbehaved.

**M8 — the probe asked for a string the fixture prints twice.** `serverFacts[0]` is byte-identical
to `lines[5]`, so the server-fact block could be disabled entirely and the string still rendered
from the main facts. The probe now picks a fact that does *not* appear in `lines`, and asserts that
uniqueness rather than trusting it, so it cannot go quietly vacuous again.

**M4 — the mutant was not the one it was named after, and the probe could not see it.** It is
called "buried below the facts" but it replaces the append with nothing, so the badge *disappears*.
The probe asked only whether the marker rendered below the first fact; an absent marker gives
`indexOf(...) === -1`, which is "before everything", so a missing badge read as a correctly placed
one. Absence is now a defect in its own right, and the order question is still asked.

`verify-status-panel` went from an honest 8/11 to **VERIFIED 42/42, 11/11**.

## 5. A type reference that checked nothing

`verify-status-panel.ts` declared `const INPUT: mod.StatusSurfaceInput`, where `mod` is the
destructured *value*. That reported `TS2503` for as long as the file existed — a type reference
that does not resolve checks nothing, so the fixture was never verified against the product's
input shape. Two forms were wrong before one was right:

```
typeof import("…").StatusSurfaceInput   ->  TS2694, no exported member
import("…").StatusSurfaceInput          ->  correct
```

`typeof import(…)` is the module's **value** shape, and `StatusSurfaceInput` is an exported
*interface*, so it is not reachable through it. The fixture now fails to compile if the product's
input shape moves — which is the only thing that makes a hand-written fixture trustworthy.

## 6. A gate whose rule could not be satisfied without an exemption it refuses to give

`script/m62/verify-live-db-snapshot.ts` names `script/m25/e5-inner.js`, which reads a `brain.db`
off the filesystem. The read is now guarded — `brainDbPath` is asserted lexically inside this run's
data dir *before* the read, canaried against the same predicate the file uses, and an absent
snapshot is reported rather than swallowed by a ternary.

The gate is **still red**, deliberately. Its rule is a text scan for `readFileSync(<…Db…>)`, the
file still does that, and its own comment is explicit that it carries no exemption mechanism
because "an exemption is a claim about a file that has not been checked". Adding one here would be
the laundering the gate exists to prevent, and it would do it on an agent's say-so, in a test that
cannot run on this machine. The real fix is to stop reading the file at all — restore from a fresh
fixture built by the driver, which already calls `buildFixtureWorkspace()` per fork — and that
restructures the extension host's mid-run sequence with no way to verify it here.

## A ratchet with no way to record a shrink

`m62/verify-gate-typecheck-coverage` compared `total === baseline.totalErrors` **exactly** and had
no update mechanism, so every reduction in debt left it red with `measured 607, baseline 723` and
the only remedy was a hand edit of a JSON file — where nothing distinguishes a deliberate
re-baseline from a number typed to turn a gate green.

`--update-baseline` now exists, mirroring the m14 sibling that already had this shape. The
ratchet's promise is preserved and made explicit: debt may fall without ceremony; it may not rise
without `--allow-increase "<why>"`, and the reason is written into the file. Both directions were
canaried — an artificially lowered baseline is refused with exit 2 and the file is not written.

`723 -> 607 errors, 202 -> 186 files`, with the reason naming the four remediations above.

## Still red, and honestly so

Left standing rather than papered over, because each is real and none is a one-line fix:

- `m62 path-encoding` — 25 defects across 25 `script/` files.
- `m62 esm-only-globals` — 106 files use `require`/`__dirname` in ES modules.
- `m62 no-foreign-paths` — 1232 files assign a path from another machine.
- `m62 indexer-option-contract` — 5 call sites pass `conflictMode`, which the indexer does not
  accept, so it is silently ignored.
- `m62 gates-can-fail` — one gate in the chain prints PASS and cannot set a non-zero exit.
- `m62 gate-typecheck` — the recorded baseline (723, taken 2026-10-08) no longer matches the
  tree (607). It must be re-recorded deliberately, and the per-file delta reviewed, not
  overwritten.
- `m24 closure` / `m24 governance` — evidence stamped at the pre-merge commit.
- `m25 V1 harness core` — one assertion (`H2: usage link`) fails.
- `m25 D1i install docs` — genuinely blocked: needs the `code` CLI in the environment.
- `m26 external-arm plan` — the golden was captured against a different index fingerprint.

## A methodological note

Two of the measurements in this session contradicted earlier ones, and both times the cause
was a broken instrument rather than a changed world:

- A "code-only" loss analysis reported 24,533 lines at risk where the raw-text analysis
  reported 3,761. The blanking reimplementation had changed matchability. The raw figure was
  kept and the other discarded.
- Three gates "passed standalone and failed in the suite". The standalone run was the anomaly:
  a later bisect showed the 1-arg definition silently ignored the options object.

And three attempts to fix something by script produced wrong output before producing right
output — once because a DOTALL regex ate real code (caught by a parse-error count that
*collapsed* from 643 to 13), once because line numbers shifted under a bottom-up edit, and once
because the anchor was advanced past every candidate so the next line matched instead. In each
case the saving grace was a check that was independent of the edit: a parse count checked
before a total, an export check that refused wrong pairings, and a canary that had to see a
planted defect before a clean run meant anything.

A cheap lesson worth keeping: **the first automated fix of a detector is evidence about the
detector, not about the code.** It needed an export check, a canary, and an independent audit
before it could be trusted.