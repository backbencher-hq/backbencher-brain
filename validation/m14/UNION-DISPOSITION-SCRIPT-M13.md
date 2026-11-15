# `script/m13` — 13 PATHS DISPOSITIONED: **MAIN IS THE MIGRATED SIDE HERE**, the opposite of `script/m60`

**And all 13 are small — `+3` to `+28` main-only lines.** *Classified, then applied by assertion rather than by eye.*

## THE PATTERN, AND IT IS THE CORPUS-ROOT MIGRATION READ THE OTHER WAY

**In `script/m60`, HEAD was the migrated side and main carried the hardcoded literal — 18 of 23.** **Here it is the
reverse**: *main carries `resolveCorpusRoot`, HEAD carries either the literal or a `$HOME`-based path.* **The two batches
are the same class with opposite resolutions**, which is the rule the `go-tools` finding established: ***the correct
spelling is a property of the corpus root, not of the file — and neither side is globally right.***

## AND THREE OF THE THIRTEEN ARE FIXES THAT ARE NOT ABOUT THE CORPUS AT ALL

* **`verify-doc-modes.ts`** — *main replaces **`} catch {}`** with a real check:*
  `harness.check("mode: "+mode+" -- bb_doc did not run", false, "bb_doc exited non-zero: " + …)`
  **A SILENT CATCH IS A CHECK THAT CANNOT FAIL** — *and the gate reported nothing while looking fine.*
* **`verify-health-mutability.ts`** — *main's comment: **"`getRawInstanceSync` DOES NOT EXIST. Not in
  `src/brain/database.ts`, not anywhere — `grep -rn getRawInstanceSync src/` returns nothing, and the real accessor is
  `export async function getRawInstance(projectId)`."*** **HEAD's ternary guarded on a symbol that never existed.**
* **`verify-patterns-e2e-corpus.ts`** — *main: **"This resolved the corpus as `$HOME/bb_tests/repositories`, which does not
  exist on this machine — the corpus is a SIBLING of the repo, at `../bb_tests/repositories`."*** **HEAD's path pointed at
  a directory that does not exist, so the gate measured nothing.**

## APPLIED, AND HOW

**8 paths took main's file** — *2 with no HEAD-only content at all, 5 whose HEAD-only lines were the buggy
literal/`$HOME` form, and `verify-visualize-e2e-corpus.ts` composed* — **6 were composed mechanically**: *the
`resolveCorpusRoot` call plus its import inserted into HEAD's version, **keeping every HEAD-only line.***

**AND THE ASSERTION THAT DROVE IT**: *a path was taken only if main carried `resolveCorpusRoot` **and** HEAD's unique
lines were the literal being replaced* — *which is the superset-take test applied as a predicate rather than as a
judgement.*

## GATES, AND WHAT THE MIGRATION ACTUALLY DID

    npx tsc --noEmit -p tsconfig.json      -> 0
    audit:script-typecheck                 -> files with errors: 0 · PASS (canary fired)

**AND THE MIGRATED GATE NOW GETS FURTHER THAN IT DID** — *it fails on **`ENOENT: mkdir '/home/ishaq2321/.bb/projects/…'`**
rather than on the corpus root.* **That is an ENVIRONMENT path (the `~/.bb` index directory), not a code defect — and it
is progress, because the corpus root is no longer what stops it.** *Named rather than chased.*

**AND 10 LITERAL LINES REMAIN IN `script/m13`, ALL INSIDE THE "WAS:" COMMENTS THAT RECORD WHAT WAS REPLACED.** *They are
prose about the literal, not uses of it.*
