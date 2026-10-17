# PROPOSAL — the Go lane's declared-cause channel (`baseBeyondRunScope`)

**From** the `go` lane owner · **to** the Lead (owner of `script/m14/**` and the shared instruments)
**Date** 2026-10-17 · **State** measured, NOT landed. The lane's in-scope win is in
`validation/m14/verification/GO-STATE.md` §2 (3,727 edges stated as verified external claims).

---

## 1 · WHY THIS EXISTS

The fleet brief for this lane said: "the analyzer already computes the reason and does not publish it where the gate
reads — route it onto the channel and ~12,972 edges move from silent to stated." Tested against the arbiter's own
`classifyEdge`, the reason ALONE cannot be routed: the cause channel accepts a claim only when
`base === targetOwner(target)`, and `targetOwner` of a bare leaf (`Println`, `Marshal`, `Context`) is `null`
(`script/m14/incoming-rule.ts:648-652`, `:1149-1158`). Measured on the 400-file stride: **24,385 of 24,385**
unresolved edges read `causeRefuted` when the lane's `reasonCode` is placed on `baseBeyondRunScope`
(`validation/m14/fixtures/go/measurements/probe-go-state-base.txt`, TRAP 1). `causeOK` is therefore not an unread
key; it is the wrong shape for a leaf target. toml and yaml recorded the same finding independently.

The route that IS attachable is: **publish the qualifier as the target prefix and the base beside it**, exactly as
dart's receiver pass does (`real-dart-analyzer.ts:2444-2471`). Measured by the prior experiment A (artifact
`validation/m14/fixtures/go/measurements/gate-go-expA-qualified-target-400.txt`):

| axis | before | experiment A | delta |
|---|---:|---:|---:|
| unresolved | 25,215 (that run's baseline) | 19,996 | −5,219 |
| collRes | 1,807 | 1,807 | 0 |
| arbitraryTwin | 8,195 | 6,807 | −1,388 |
| causeOK / causeFAIL | 0 / 0 | 5,756 / 0 | +5,756 |
| fixtures | 29/2 | 26/5 | **3 new failures** |
| clause 3 | ok (vacuous) | **FAIL — 450 named causes, no rulings** | new clause failure |

Both axes are favourable. The blockers are all OUTSIDE this lane's write scope.

---

## 2 · THE THREE BLOCKERS, EACH WITH ITS EVIDENCE

**(a) The pinned leaf contract (fixtures, in the lane's scope — but deliberately not edited unilaterally).**
* `go/incoming-resolve-outgoing-only.expectation.json:41` — `calls Describe -> ToUpper` with
  `meta.callExpression: "strings.ToUpper"`.
* `go/relationship-and-payloads.expectation.json` — `calls -> Sprintf` (`fmt.Sprintf`) and
  `calls -> DeepCopyValue` (`copy.DeepCopyValue`).
* `go/type-usage-graph.expectation.json` — `references -> Writer` with `meta.qualifiedType: "io.Writer"`.
These pin the family leaf contract (Rust M12.18) that the lane's header states and the R10 round chose. Retargeting
them is a contract revision, not a bug fix; it must be an explicit Lead decision, not an owner adapting tests.

**(b) R10 target spelling (shared register).** A qualified target contains `.`, which no Go declaration contains;
the census would read a new unruled `calls|.` / re-opened `references|.` triple in
`validation/m60/target-spelling-register.json` (lanes/go currently records only the three `imports` separators). The
register needs a ruling scoped to `(go, calls, ".")` and `(go, references, ".")` with a written reason — the
ruby precedent for qualified override targets shows the shape.

**(c) Clause 3 rulings (shared instrument).** Every cause NAME (the qualifier) with a nonzero count needs a ruling
in `validation/m14/instruments/go/incoming-declaration.json` carrying THIS run's
`populationFingerprint` (`parsed=400/400 admitted=49915 exts=go index=no`) and a falsifier `{run, wouldFail}`.
Experiment A produced 450 names. The ruby lane's entry is the working precedent:
`validation/m14/instruments/ruby/incoming-declaration.json` → `causeRulingsNote` + `causeRulings`
(one entry per base, `count_in_this_run` recorded, falsifier = "an edge whose base is not the target's owner or is
not identifier-shaped reads causeRefuted" + the per-file reachability arm).

---

## 3 · THE PATCH, IF APPROVED (exact shape, not prose)

1. **Analyzer** (`src/ast/real-go-analyzer.ts`, this lane): in `analyzeGoFunctionCalls` / `analyzeGoPackageScopeCalls`,
   when the callee is `pkg.Leaf`, `pkg` is a package THIS FILE IMPORTS, and the spelling is exactly two segments,
   emit `target = "pkg.Leaf"` and `metadata.baseBeyondRunScope = "pkg"` (keep `callExpression`, `isPackageQualified`,
   `reasonCode`, and the existing `isStdlib` claim on the direct stdlib slice — the cause claim is mutually exclusive
   with EXTERNAL_KEYS, so do NOT attach both to one edge: choose the cause for the qualified-target slice).
   For `references`, the same with `metadata.qualifiedType` when the type use is a two-segment qualified spelling.
   Deeper chains (`pkg.Value.Method`) stay untouched: `targetOwner` is not identifier-shaped and the claim refutes.
2. **Fixtures** (this lane, only after (a) is decided): update the three rows named in §2(a) to the qualified target
   and keep the leaf spelling in the metadata they already carry.
3. **Instrument** (Lead): add `causeRulings` + `causeRulingsNote` to
   `validation/m14/instruments/go/incoming-declaration.json`, one entry per distinct qualifier, with the fingerprint
   above and a falsifier run that would fail if the base were not the target's owner. Include
   `count_in_this_run` per entry so the ruling states the number it was written for.
4. **R10 register** (Lead): declare the `(go, calls, ".")` and `(go, references, ".")` conventions with the reason
   "a qualified member/type use names the package it lives in; the leaf alone loses the owner" — the evidence is
   the 1,388 fewer arbitraryTwin picks that retargeting produced.

**Expected result, from the measured experiment A:** causeOK ≈ 5,756 (not 12,972 — the rest of the 12,972
figure is the import slice, whose claim cannot reach `extOK` because a multi-segment path is `pathLikeTarget` and
would land in `ext?`), unresolved −5,219, collRes unchanged, arbitraryTwin −1,388, fixtures unchanged after (2),
clause 3 ok after (3).

**Rollback:** the analyzer change is one branch per surface; reverting it restores the current numbers exactly
(artifacts `gate-go-state-400-base.txt` / `-claim3.txt` are the current before/after).

---

## 4 · WHAT THIS LANE WILL NOT DO

It will not qualify targets, edit the shared register or write another lane's instrument on its own authority, and
it will not route the `reasonCode` alone onto `baseBeyondRunScope` (that is 24,385 `causeRefuted` — a laundered cause
that makes the lane's own clause-4 column worse). Until the Lead decides, `causeOK 0` is the honest number and the
3,727 verified external claims are the in-scope answer.
