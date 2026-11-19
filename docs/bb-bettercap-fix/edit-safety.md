# P0-1 — edit-safety lane status (bb_edit refactor safety)

Status: **GREEN — DONE.** P0-1 defect gate RED→GREEN, CP1 bettercap shape confirmed, the two CP1
gate-slice regressions (R1/R2) fixed and re-verified: **all 6 slice gates exit 0**, `npx tsc --noEmit`
exit 0/0 errors. This was the lane's last source edit. Task: `task-9`. Date: 2026-11-18. Baseline: HEAD
`75448b029` (triage commit `be4c0ef25` archive used for pre-fix runs). bb 0.1.6.

Charter inputs read: `docs/bb-bettercap-fix/FIX-CHARTER.md`, triage `findings/ISSUE-01-unsafe-refactor.md`,
`PLAN.md` §2. Bettercap: read-only, `dryRun:true` only, never reindexed.

---

## 1. What changed (files, one owner each)

| file | change |
|---|---|
| `src/intelligence/edit/edit-engine.ts` | +~440/−80: (A) caller windows resolved through the enclosing function at the recorded call line / call-line fallback; (B) operand-aware classification + module-import route; (C) fail-closed zero-site refusal + shadow/skip reporting; (D) plan-time reparse + unresolved-reference scan and commit-time bounded build verification; unused pre-image cleanup; final CP1 edits R1 (shadow-aware verification scan) + R2 (stored-span corruption guard) |
| `src/intelligence/edit/refactor-safety.ts` | **new** (302 lines): `EditVerification` contract, container-source detection, module-binding discovery from `brain_import` (Go package / TS namespace), Go module-path importer discovery (`go.mod` + declaration dir), caller-window resolver, bounded Go build runner |
| `src/ast/safety-primitives.ts` | +52: `IdentifierOccurrence.memberReceiver` (the receiver identifier spelling, extraction-time, never text-scanned) + `memberReceiverName()` helper |
| `script/m71/verify-refactor-safety.ts` | **new** P0-1 gate: G1 Go qualified caller, G2 package-main attribution, G3 TS namespace import, G4 value-receiver negative control, G6 zero-site refusal (DB-injected evidence), G7 plan→apply→`go build` compile verdict + commit/verification phase |
| `script/m13/verify-edit-rename.ts` | +35: operand-aware classifier unit assertions (Go/TS positive, value-receiver negative, method-target `skipped-member`, and the pre-fix `isReferenceSite` behaviour pinned as the defect) |
| `docs/BB_EDIT.md` | contract updated: three cross-file sources, operand-aware classification, fail-closed zero-site rule, `verification` block semantics, conservative-skip reporting |
| `docs/bb-bettercap-fix/edit-safety.md` | this page |
| `docs/bb-bettercap-fix/evidence/edit-safety/**` | raw evidence listed in §7 |

No `npm run build`. `dist/` untouched (verifier lane owns builds). No edits outside the lane's owned
files. `src/ast/parallel-indexer.ts` untouched by design.

---

## 2. The four causes → fixes

**A. Caller-span attribution.** Pre-fix: the `calls` row for `main.go:47` is stored against the 12-byte
`package main` module symbol (bytes 0–12), so the rename window was `[0,12)` and line 47 was outside it.
Fix (`edit-engine.ts` refactor planning, using `resolveCallerWindow`): a row's stored source span is no
longer trusted as the window. When the row carries a call line, the **enclosing function/method at that
line** is resolved with a bounded per-file query and used as the window; with no enclosing symbol the
row falls back to its stored span only when that span is a callable's, else to the **recorded call line
only** (`lineOnly`) — never a whole-file guess. Container-sourced rows without a line return no window
and force the cause-C refusal instead of a guess.

**B. Qualified references classified as member names.** Pre-fix: Go `modules.LoadModules`
(`selector_expression.field_identifier`) and TS `Log.create` (`property_identifier`) were in
`MEMBER_NODE_TYPES`, so `isReferenceSite` dropped them. Fix: extraction records `memberReceiver`; the
engine builds each file's **module/namespace bindings from `brain_import`** (`moduleBindingsForFile`) and
`classifyRefactorSite` treats a member name as a reference iff its receiver is one of those bindings.
Go binding shape measured: plain `imported_name=modules`; aliased `imported_name=log, imported_as=my_log`
— the alias is the only valid spelling. TS/JS shape measured: namespace import records the SPECIFIER in
`imported_name` and the binding in `imported_as`. A **module-import route** (`discoverModuleImporters`)
adds files that import the declaration module without naming a symbol: Go matched by `<go.mod module>/<decl
dir>` (so same-module imports are found even though every Go import row is `is_external=1`, ISSUE-03), TS/JS
by the existing relative-specifier resolver. Value receivers are never renamed; under a
method/constructor target such a site is `skipped-member` and **reported file:line in `warnings`**.

**C. Silent zero-site drop.** Pre-fix: `sites.size === 0 → continue` with caller evidence invisible to
the residual check. Fix: every caller-evidenced and module-import-evidenced file is tracked; if it
produced **zero** renamed sites the plan **refuses**, naming the file and the recorded call line, unless
the zero is explained by reported conservative skips (then the file is named in `warnings`, never
silent). Also fixed while here: a file the plan does not rewrite no longer leaves a pre-image behind
(pre-fix gate G7 hit “changed on disk between planning and committing” because of exactly that).

**D. No verification gate.** Pre-fix: post-write "validation" was `/syntax error/` filtering only, so a
stale qualified caller returned `validated:true`. Fix: every refactor result/preview carries
`verification`:
- `reparsed` — every planned file parsed again after the rename (failure refuses);
- `unresolvedReferences` — module/namespace-aware scan for reference sites of the OLD name in every
  planned file's `after` content; non-empty refuses before any write;
- `build` — for multi-file all-Go refactors with a project-root `go.mod` and a working `go`: a **pre-edit
  baseline** build, then the post-rename build; a failure the baseline did not have rolls the edit back.
  When no check applies, `attempted:false` + `reason`, `ok:null` — a skipped check is never "verified".
  Dry runs report `attempted:false` while the reparse + unresolved scan still run.

---

## 3. RED → GREEN evidence (exact commands)

Gate: `script/m71/verify-refactor-safety.ts`. Fixtures are created and indexed **in-process** by the
harness (`indexProjectParallel`) with `BB_DATA_DIR` under `.tools/` (sandbox cannot create
`~/.bb/projects/<hash>`); `/tmp` used only within one process for fixture roots.

```bash
cd /home/ishaq2321/mcp/backbencher-brain
BB_DATA_DIR=$PWD/.tools/triage-fix/edit-safety/bb-data npx tsx script/m71/verify-refactor-safety.ts
```

| run | tree | result | evidence |
|---|---|---|---|
| genuine pre-fix RED | archived triage commit `be4c0ef25` (`git archive` → `.tools/triage-fix/edit-safety/pre-fix`, read-only) | **6 passed, 8 failed, exit 1** | `evidence/…/03-gate-RED-prefix-tree.txt` |
| GREEN | current working tree | **23 passed, 0 failed, exit 0** | `evidence/…/02-gate-GREEN.txt` |

Pre-fix RED (all target causes fail, controls pass):
`G1 files planned got {2,2}` + `main.go MISSING`; `G2 main.go caller file MISSING`; `G3 namespace-import
caller MISSING`; `G6 silent-success`; `G7 plan does not include main.go` + `go build FAILED:
# example.com/g7 ./main.go:5:23: undefined: modules.LoadModules`. GREEN run shows every FAIL replaced by
PASS (output quoted in the evidence file; G7 commit declares
`{"reparsed":"passed","unresolvedReferences":[],"build":{"attempted":true,"tool":"go","command":"go build ./...","ok":true,"baseline":"passed"}}`).

**G7 harness stabilization (Lead guardrail 1).** The first RED run failed G7 with an engine pre-image
mismatch instead of a compile verdict. Root cause measured, not guessed: the pre-fix plan recorded
pre-images for caller files it then dropped (zero sites), and those unused entries were still checked by
the commit — for a caller file whose index path spelling differed, the lookup missed and the commit
refused. Two fixes: (a) the engine deletes pre-images of non-rewritten files (in `edit-engine.ts`), and
(b) G7 now asserts the DEFECT directly: run the dry-run plan, apply exactly the planned `after` bytes,
then `go build ./...` — pre-fix the plan omits `main.go`, so the compiler says
`./main.go:5:23: undefined: modules.LoadModules` (RED); post-fix the plan is build-complete and the
compile passes (GREEN), followed by a commit phase that asserts `verification` is declared and the
committed tree builds.

**Controls (green pre-fix and post-fix):** same-package unqualified call renamed (G1); named-import
unqualified call renamed (G4); value-receiver `box.target()` untouched (G4); declaration always renamed.
`G6` refusal names the evidence file. CP1 bettercap shape confirmed against the real read-only index
(see §4).

---

## 4. CP1 shape — the reported symptom is gone on the real bettercap index

Read-only engine call (`executeEdit(..., {dryRun:true})`, project `/home/ishaq2321/bettercap`, projectId
`4c7590f1cba319aac298a50453c0ec440f2dc857`; never written, never reindexed):

```json
{"summary":{"renamedFiles":3,"renamedSites":3},
 "warnings":["refactor LoadModules → LoadModulesRenamed: 3 site(s) across 3 file(s)"],
 "verification":{"reparsed":"passed","unresolvedReferences":[],
                 "build":{"attempted":false,"ok":null,"reason":"plan preview — … the unresolved-identifier scan above still ran"}},
 "changes":["/home/ishaq2321/bettercap/modules/modules.go",
            "/home/ishaq2321/bettercap/main.go",
            "/home/ishaq2321/bettercap/modules/modules_test.go"]}
```
`main.go` now plans `modules.LoadModulesRenamed(sess)`. Triaged behaviour was **2 files / 2 sites** with
`main.go:47` untouched. Evidence: `evidence/…/04-bettercap-CP1-dryrun.json` (+ `.err`).
CLI `node bin/bb` was NOT used: it reads `dist/`, which the verifier lane builds at CP1; this evidence
runs the fixed source tree through `tsx`.

---

## 5. Gate-suite results (CP1 slice) — ALL GREEN, R1/R2 fixed

Commands: `BB_DATA_DIR=.tools/triage-fix/edit-safety/bb-data npx tsx <gate>`; raw outputs in
`evidence/…/05b-*`. Final run after the R1/R2 fixes:

| gate | result | detail |
|---|---|---|
| `script/m71/verify-refactor-safety.ts` (P0-1) | **exit 0** | 23 passed, 0 failed |
| CP1 bettercap shape (read-only dryRun) | **exit 0** | 3 files / 3 sites, `main.go` planned, verification declared |
| `script/m13/verify-edit-rename.ts` | **exit 0** | `E2: VERIFIED (92/92 passed, 24 negatives)` — includes the new operand-aware classifier units |
| `script/verify-edit.ts` | **exit 0** | — |
| `script/m13/verify-edit-honesty.ts` | **exit 0** | — |
| `script/m13/verify-edit-batch.ts` | **exit 0** | — |
| `script/m15/verify-edit-crossfile.ts` | **exit 0** | `E4 VERIFIED 31/31`, `E5 VERIFIED 5/5`, `E8 VERIFIED 8/8` |
| `script/m13/verify-edit-freshness.ts` | **exit 0** | `E5: VERIFIED (14/14, 5 negatives)` |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0** | 0 errors |

### R1/R2 — the two regressions found in the first CP1 slice, and their fixes

The first slice run was RED on crossfile (E4 29/31: both `D2 shadow` cases) and freshness (E5 12/14:
corrupt caller span no longer aborted); both gates PASSED on the pre-fix archive (`evidence/…/06-*`), so
they were attributable to this change set. Fixed and re-verified in `src/intelligence/edit/edit-engine.ts`
(no other files):

- **R1 — verification scan masked shadow scopes.** `scanPlannedRename` flagged every surviving old-name
  occurrence as unresolved, including sites the plan deliberately skipped because a nested scope
  re-declares the name, so legitimate shadow plans were refused. Fix: the scan recomputes the shadow
  scopes on the AFTER text (`collectShadowScopes(parsed, symbolName, -1)`) and skips occurrences inside
  them. Recomputed, not carried over: renamed sites shift byte offsets, so a recorded-index set would
  miss every shadow after the first renamed site. Restores both `D2 shadow` cases.
- **R2 — A's fallback masked a corrupt stored span.** The freshness gate plants an out-of-bounds caller
  symbol span and requires the “caller span out of bounds … reindex” refusal; resolving the enclosing
  function before the bounds check let the corrupt row through. Fix: each caller plan entry keeps the
  row's STORED `byteStart/byteEnd` verbatim, and the per-file loop refuses any stored span outside the
  file length BEFORE using the enclosing/call-line fallback (the same existing error text). The fallback
  exists for a MIS-ATTRIBUTED span, not an IMPOSSIBLE one. Restores the abort + “declaration NOT
  renamed” checks.

Evidence: pre-R1/R2 slice `05-*`; baseline pre-fix gates `06-*`; post-fix slice `05b-*`;
`07b-tsc-noemit.txt`.

## 6. Residual limitations (declared, not hidden)

- **Method-target value-receiver call sites** (`x.Method()` for a renamed Go/TS method) are still
  conservatively **not renamed** (pre-existing documented limitation: AST identity alone cannot resolve
  receiver types). They are now reported file:line in `warnings`; the cause-C refusal protects the
  silent case. A future type-aware pass can lift this.
- **Build leg is Go-only and multi-file only** (bounded, `go.mod` at project root + `go` present). TS
  `tsc --noEmit`, Rust `cargo check`, Python `py_compile` are NOT wired: those plans report
  `build.attempted:false` with the reason, while the reparse + unresolved-reference scan still runs.
- **Module-binding shapes are measured for Go and TS/JS only.** Python `import mod` / Java static
  imports are not in the recognizer, so a qualified site there is reported/refused rather than renamed
  blind (fail closed). Extending `moduleBindingsForFile` is the single place to add them.
- **`dist/` not rebuilt in this lane** (verifier owns builds): `node bin/bb` still exposes the old
  engine until CP1 builds; all evidence above runs the source tree via `tsx`.

---

## 7. Evidence paths (`docs/bb-bettercap-fix/evidence/edit-safety/`)

| file | contents |
|---|---|
| `01-gate-RED.txt` | RED gate run on pre-fix working tree (6 failures) — original capture |
| `02-gate-GREEN.txt` | GREEN gate run on fixed tree (23 passed, 0 failed, exit 0) |
| `03-gate-RED-prefix-tree.txt` | genuine pre-fix RED from archived `be4c0ef25` tree (8 failures incl. G7 compile verdict `undefined: modules.LoadModules`) |
| `04-bettercap-CP1-dryrun.json` (+`.err`) | REAL bettercap dry-run: 3 files / 3 sites, `main.go` planned, `verification` declared |
| `05-m13-gate-summary.txt`, `05-script_*.txt` | CP1 gate slice raw outputs (includes the two regressions) |
| `06-baseline-prefix-verify-edit-freshness.txt`, `06-baseline-prefix-verify-edit-crossfile.txt` | pre-fix baseline runs of the two red gates (both GREEN pre-fix → regressions attributable to this change set) |
| `02b-gate-GREEN-after-R1R2.txt` | P0-1 gate after R1/R2: 23 passed, 0 failed, exit 0 |
| `04b-bettercap-CP1-dryrun.txt` | CP1 bettercap re-run after R1/R2: 3 files / 3 sites, `CP1 PASS` |
| `05b-gate-slice-summary.txt`, `05b-*.txt` | final 6-gate slice, all exit 0 (E2 92/92, E4 31/31, E5 14/14, E8 8/8) |
| `06-*` | pre-fix baselines (both gates GREEN pre-fix, proving the first-slice RED was my regression) |
| `07-tsc-noemit.txt`, `07b-tsc-noemit.txt` | full-project `npx tsc --noEmit`: exit 0, 0 errors |

---

## 8. Reproduce (frozen tree)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
# defect gate (fixtures indexed in-process; BB_DATA_DIR required)
BB_DATA_DIR=$PWD/.tools/triage-fix/edit-safety/bb-data npx tsx script/m71/verify-refactor-safety.ts
# CP1 shape on the read-only bettercap index (no BB_DATA_DIR override: real index)
env -u BB_DATA_DIR npx tsx .tools/triage-fix/edit-safety/bettercap-dryrun.ts
# CP1 gate slice
BB_DATA_DIR=$PWD/.tools/triage-fix/edit-safety/bb-data npx tsx script/m13/verify-edit-rename.ts
npx tsc --noEmit -p tsconfig.json
```
