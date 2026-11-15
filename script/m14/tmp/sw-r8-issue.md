## The class

**R8 and R10 adjudicate a COMMITTED artifact, not a live recomputation.** `verify-standing-rules.ts`
reads `validation/m60/results/framework-surfaces.json` and `validation/m60/results/target-spelling.json`
and compares them against their registers. So a census artifact that was emitted from a **dirty tree**
— while some lane's analyzer was mid-wave — passes its gate forever, and the register that was written
beside it pins the same wrong reading. R11 already learned this lesson in the other direction
(`.gsp` survived a whole wave because the reading and the registry were never compared at gate time,
so R11 re-runs its check in this tree); R8/R10 still compare the artifact.

This repo has paid for the class before: `reviews/onboarding.md` records "the previous census was
dirty-derived" for the regex census, and the same wave lists "4 census entries shifted by the
in-flight, uncommitted c/cpp/rust/zig analyzers".

## The measurement (2026-09-25, from a lane re-emit, not from reading code)

Both censuses were re-run with their canonical parameters on a tree where **no analyzer was dirty**
(`git status` carried one modified analyzer, `src/ast/real-swift-analyzer.ts`, which neither census
reads). Both runs are **deterministic**: two consecutive full runs of the R10 census were
byte-identical (`/tmp/r10-run1.json` vs the artifact).

**R8 — php is un-adjudicated at HEAD.**

- The freshly emitted census has **zero php sites**, `byLanguage.php` absent, `bindingsExamined` for
  that file **1**. The committed artifact has **8 php sites** (`deduped-write [detectedFrameworks]`,
  7 entries / 8 sites) and `bindingsExamined 52` vs 51.
- Running the census's own `scanFile` on **the exact HEAD blob** of `src/ast/real-php-analyzer.ts`
  (`git show HEAD:` and the worktree hash identical, md5 `c28bfe96656d3d6866a77868af0cff77`; probe
  `script/m14/tmp/sw-r8-php-probe.ts`)
  yields `parseError=false`, `publishedContractKeys=["detectedFrameworks","framework","frameworkPatterns"]`,
  `bindingsExamined=1`, **`sites=0`** — identically for both blobs. So the committed artifact **could not
  have been produced by this classifier on this tree**: it was emitted at `85414604`
  (2026-09-24T13:55) while php's `d67545c9` (2026-09-24T14:25) was still in flight.
- Consequence at HEAD: php **publishes** `detectedFrameworks` and claims framework intelligence while
  the classifier cannot see a single write into that accumulator, and R8's `unexamined` guard does not
  fire because the guard's cohort test is "names a key but publishes none" (`!publishedContractKeys.length`)
  — publishing the key is treated as proof of examination. The blind spot the guard exists for
  (the objective-c IIFE case) therefore still has an open door.

**R10 — cpp's committed row is not HEAD-true.**

- Committed row: 58 anomalies `{delimiter:49, whitespace:7, literal:2}`, 5 separator triples.
- Fresh row (same draws `fmt:40+nlohmann-json:17`, deterministic): 45 anomalies `{delimiter:45}`,
  2 sub-classes `{operatorMember:2}`, **7** triples — `references|:` and `uses|:` are NEW, i.e. the
  vocabulary widened while the conviction count fell.
- `src/ast/real-cpp-analyzer.ts` is unmodified in the working tree at HEAD, no file under `fmt/` or
  `nlohmann-json/` has been written since 2026-08-25, and the census is deterministic — so the
  committed row describes a different analyzer state.

## What this issue asks for

1. **Make R8 and R10 compare a live recomputation in the gate** (the R11 hardening), so a
   dirty-derived artifact can never pass: the artifact stays the record, the gate stops trusting it
   as the measurement.
2. **R8 must not read "publishes a contract key" as "was examined".** The cohort test has to be about
   the WRITES the classifier can read, not the key names a file mentions — php is the live proof that
   the current test is one step weaker than its contract.
3. **Re-derive php's register entries from the HEAD-true census** — deliberately, with the reason, or
   restore the surface the classifier can read. The register must never be shrunk to zero silently,
   and a zero-site php row must not be readable as "php is clean".

## What is NOT asked for

No analyzer change is requested here. Nothing in this issue is evidence that php's framework surface
emits a wrong framework name — the sites that vanished were all the SAFE `deduped-write` shape. The
defect is that the instrument cannot see them any more, and that its gate could not tell.
