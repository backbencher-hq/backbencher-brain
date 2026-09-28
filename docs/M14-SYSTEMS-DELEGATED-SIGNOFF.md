# M14 Systems delegated sign-off record

Status: CLOSED — delegated owner authorization recorded and the systems analyzer
issues #259–#263 were closed on the owner's behalf after the final gates and a
confirming deep review. No personal owner execution is claimed.

Authorization: on 2026-08-29, the project owner authorized the agent to work on the
systems-family closure, to perform the last checks and a manual review, and then to
close the systems analyzer issues #259–#263 on the owner's behalf.

This record is a governance disposition, not a substitute for machine-emitted
evidence. Supporting machine evidence remains under `validation/m14/results/`.

## Scope

| Issue | Analyzer | Fixture rerun | Delegated disposition | Discrepancies |
|---|---|---:|---|---|
| #259 | C | 4/4 pass | CLOSED on owner's behalf | none observed |
| #260 | C++ | 5/5 pass | CLOSED on owner's behalf | none observed |
| #261 | Rust | 8/8 pass | CLOSED on owner's behalf | none observed |
| #262 | Go | 3/3 pass | CLOSED on owner's behalf | none observed |
| #263 | Zig | 1/1 pass | CLOSED on owner's behalf | none observed |

## Supporting gates

The delegated review relied on the following passing machine checks and their
recorded limitations:

- `M14.0.F1.json` — grammar audit evidence (all five systems analyzers 0 unknown refs).
- `M14.0.F2.json` — evidence-harness validation evidence.
- `M14.0.F3.json` — fixture evidence (all languages pass, no regressions).
- `M14.0.F4.json` — mutation evidence (134/134 caught, incl. 4 zig + family mutants).
- `M14.0.F5.json` — differential evidence (family floors: jq 1692/1692, fmt 145/145,
  ripgrep 1948/1948, go-tools 822/822, zig 3731/3731 — all 0 missing / 0 unexplained).
- `M14.0.SC1.json` — systems-cluster E2E evidence (polyglot c/cpp/rust/go/zig project
  through the real CLI: symbols, imports, cross-language c→cpp edge verified).
  *Cited as `M14.0.F9.json` until 2026-09-12: that identity had two producers, so
  every `audit:cluster-systems` run overwrote the defect-class probe battery's
  evidence and vice versa — this claim's evidence kept vanishing. It now has its
  own id (M49 W8; see `script/m49/verify-evidence-identity.ts`).*
- `M14.0.SPEC.json` — completeness A–H evidence (all five systems languages 8/8).
- `M14.CC1.json` — cross-language consistency evidence (JVM + systems equivalents:
  1-based ranges, kind consistency, per-symbol complexity).

## Confirming deep review (final pass, 2026-08-29)

The owner required a further confirming review beyond the gated checkpoints before
sign-off. Beyond-sample (sample=200) stress differentials on the family corpora
surfaced two genuine go analyzer defects that were fixed, verified, and committed
before closure (commits `2255310`, `c1ee399`):

1. **Package-scope IIFE closure calls silenced.** `var x = func(){ os.Getwd() }()`
   — an immediately-invoked closure that runs at init — never emitted its
   `Getwd`/`Fatalf` calls (12 MISSING on go-tools @200). The analyzer and oracle
   were also misaligned; both now descend IIFE bodies and skip non-invoked stored
   closure templates. Fixed and pinned in the go `relationship-and-payloads`
   fixture (new `deepReviewClosure` pin).
2. **Spurious `instantiates -> String` fabrication.** `flag.String(...)` at package
   scope emitted an instantiate edge because the guard checked `declared`
   (functions AND methods) instead of top-level functions only (2 UNEXPLAINED at
   @200). New top-level-function-only `ctorFns` guard; 0 String-instantiate files
   remain of 350 legit instantiates.
3. **Builtin-leaf call fabrication.** `v.len()` on a method whose leaf (`len`)
   matched the Go builtin emitted a fabricated `calls len` because
   `findGoFunctionCalls` filters builtins by full call text rather than the
   resolved leaf. Aligned with the oracle (builtin resolved-name filter):
   go-tools @200 now **unexplained = 0**.

Result: go-tools @200 MISSING=6, unexplained=0. All family gates stayed green
(go 822/822 0/0 floor, 134/134 mutants, 13/13 completeness A–H 8/8, honesty gate
clean at HEAD `693843f`; evidence F1/F3 regenerated at HEAD, full 14-language
artifacts verified intact).

### Residual disclosed (not hidden)

The 6 go-tools @200 MISSING are cross-receiver interface-`implements` edges
(`Handler`, `Preempter`, `Semilattice`, etc.) where the oracle detects duck-typing
through embedded helper types that the analyzer's per-file method-set check does
not traverse. These sit beyond the pinned 60-file floor, are a *missing*-edge class
(not fabrication), and remain a recorded pending limitation — a candidate follow-on
wave, not a blocker to systems closure.

## Limitations and honesty boundary

- This is delegated verification authorized by the project owner; it must not be
  described as the owner personally executing the samples.
- The record does not close the entire M14 milestone. Other analyzer families
  (managed-OO, functional, scripting) and explicitly pending ledger cells remain
  outside this scope.
- The `zig:javascript` perf outlier observed when running `--repo zig` explicitly
  is a cross-language sampling artifact of one large JS file in the zig corpus
  (624ms vs 899ms baseline — improving, not a regression); the `npm run verify`
  chain never exercises that repo, and the `zig:zig` floor is 0 missing /
  0 unexplained.