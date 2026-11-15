# PROPOSAL — wire the `make` oracle (four Lead-owned lines) + the repo-pin finding

**Author:** coverage-b · 2026-10-17 · **Status: the derive is written, lane-owned and measured NON-EMPTY; the
shared-file edits are yours to apply serially.** The oracle lives in `script/m14/oracles/make.ts`
(`deriveMakeTruth`) per the module pattern — the shared file is edited by several owners at once (it grew
26,289 → 26,883 lines while this was written), and the precedent `oracles/json.ts` records the same reason.

## THE FOUR LINES

### 1 · Import (with the other oracle imports near the top of `script/m14/differential.ts`)

```ts
import { deriveMakeTruth } from "./oracles/make"
```

### 2 · Dispatch block (beside the bash branch, after its closing brace)

```ts
      if (lang === "make") {
        // M60 make: the lane's E/F were unmeasurable — no `derive<Lane>Edges` branch existed at all, so
        // `truth` was empty and the harness reported no truth instead of a clean floor. The derivation
        // lives in `script/m14/oracles/make.ts` (lane-owned: the shared file is edited by several owners
        // at once) and is derived from the PARSE TREE, never from `real-makefile-analyzer.ts`.
        //
        // `consul` is the lane's entry in LANGS_REPO and is EMPTY in this corpus (0 files); the measured
        // make corpus is tf-aws-components (53 files), which is the completeness config's perfKey. Run with
        // `--repo tf-aws-components` (or correct the map entry — see FINDING A).
        const makeModule = relPath.split("/").pop() ?? "Makefile"
        for (const e of deriveMakeTruth(root, makeModule)) {
          ;(truth as any[]).push(e)
        }
      }
```

### 3 · THE LABEL ALLOWLIST LINE (part of the wiring, not an extra)

Without it the oracle derives truth the comparison filters out: the lane then reads a 0% coverage row that is
indistinguishable from a catastrophic regression. `differential.ts` records that failure mode four separate
times (`#910` c-imports, the G7 groovy `uses` note, the html `contains` note, the powershell note). Insert
beside the other per-language groups in the compared-label expression:

```ts
          ...(lang === "make" ? ["calls", "uses", "references", "imports", "exports", "contains"] : []),
```

`overrides` needs NO allowlist entry: the base expression already includes it for every language except
csharp/dart/swift/cpp/go, so `make` is compared for `overrides` by default. (`extends`/`implements`/
`instantiates` are in the base set too — the oracle derives none of them, and the refusal is stated in the
module header: this grammar has no such construct.)

### 4 · `requiredKinds` for make (in `script/m14/completeness-inventory.ts`)

```diff
-    requiredKinds: ["contains", "references", "uses", "imports", "exports", "calls"],
+    requiredKinds: ["contains", "references", "uses", "imports", "exports", "calls", "overrides"],
```

Safe now and only now: `validation/m14/fixtures/make/directive-flags.expectation.json` **pins the `overrides`
row** (a real redefinition: `OVERRIDDEN := base` L11 then `override OVERRIDDEN := forced` L12, with
`meta.via`/`meta.overrideLine`/`meta.baseLine`). Without that pin this line would turn section B's forward
check red; with it the section's message is cleared on both sides. This is the "add a fixture pinning a real
override directive" half of the task, measured against the analyzer's own ruling at
`real-makefile-analyzer.ts:830-858`.

## FINDING A — the lane's repo pin points at an EMPTY corpus directory

`script/m14/differential.ts`'s lane→repo map has `make: "consul"`, and `.corpus/consul` contains **0 files**
(measured). The measured make corpus is **`tf-aws-components`** (53 make files; it is also the completeness
config's `perfKey: "tf-aws-components:make"`). Two honest fixes: pass `--repo tf-aws-components` on the run,
or correct the map entry. Without one of them the lane samples nothing and no `tf-aws-components:make` row is
written, so **E/F would stay red after the wiring** even though the oracle is correct.

## WHAT THE ORACLE DERIVES (evidence)

* `script/m14/oracles/make.ts` — `deriveMakeTruth(root, moduleName)`; seven labels: contains, exports,
  references, uses, imports, calls, overrides. Three REFUSED with the reason stated in the module header:
  extends, implements, instantiates (this grammar has no such construct).
* Non-empty over every fixture source (119 truth rows; `calls:2` and `overrides:1` demonstrate the rarer
  labels) and over the floor corpus (1,628 truth rows over 53/53 files).
* **Preview of the comparison without the branch wired** (same rule the harness uses: label+target):
  `truth 1,628 · covered 1,628/1,628 (missing 0) · analyzer edges 2,114 · unexplained 0`
  (`.tmp-make-lane/preview.ts`). The first version had 59 false `uses` rows against analyzer `references`
  rows — a prerequisite naming another target of the same file IS a references; the declared set now
  includes declared targets, as the analyzer's symbol set does.
* Fixture suite: **10 pass / 0 fail** (was 8/2 — the two red ones were `.RECIPEPREFIX` fixtures pinning a
  construct the docs declare unmodelled (MAKE-G2) and the pinned wasm cannot lex; re-baselined to the gap's
  measured behaviour, details in `validation/m14/verification/MAKE-STATE.md` §3).

## AFTER THE EDITS — the measurement (yours: E/F)

```
BB_CORPUS_ROOT=/home/ishaq2321/mcp/backbencher-brain/.corpus \
  bun run script/m14/differential.ts --repo tf-aws-components --lang make --update-baseline
```
Expected, on the preview's evidence: **missing 0, unexplained 0**, which writes the
`tf-aws-components:make` row (missing 0 / unexplained 0 + avgMsPerFile) that sections E and F read. Then
`bun run script/m14/completeness-inventory.ts --lang make` should read 8/8.
