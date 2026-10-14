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