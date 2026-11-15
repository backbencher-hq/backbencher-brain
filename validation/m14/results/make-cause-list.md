# make — named-cause list (Lead measurement, 2026-10-10)

`npx tsx script/m14/residual-gate.ts --lane make` — whole admitted population, production scope.
Raw: this file quotes `validation/m14/results/make-residual-gate.txt` (the run below).

    type        edges   resolved  ofWhich  amb   unresolved  residual%   intended  twin  noDecl
    uses         2196        261       0     310       1625       88.1%          0   575   1621
    references   2437       2370       0      67          0        2.7%          0     0      0
    exports       446        416       0      30          0        6.7%        444     0      0
    imports        14          2       0       0         12       85.7%          0     1     12
    calls          25         22       0       0          3       12.0%          0     5      3
    contains     1106       1106     143       0          0        0.0%        971     0      0
    ---------------------------------------------------------------------------------------------
    TOTAL        6226       4177            407       1640                 ofWhich 143, extFAIL 0

make's residual is **2,047 of 6,226 (32.9%)** and it is TWO causes, both visible in the gate's own
worklist. Neither is named yet by a lane; this is the Lead's reading of the instrument's output, not a
lane measurement — the numbers are the gate's.

## Cause 1 — `uses` 1,625 unresolved: FILE-SHAPED targets under a symbol-typed edge

The worklist's unresolved `uses` targets are FILENAMES:

    Csparse.c    Mdefines.h    version.h    Msymbols.h

A `uses` edge is a symbol relation; a `.c`/`.h` path can never answer against a declaration key space,
so these are unresolved **by construction**. They are also **NOT claimable in this gate**: they are
file-shaped, so `pathLikeTarget` returns `externalUnverified` — which `verdict()` requires to be 0, so
marking them buys nothing. And they are not in make's admitted population (`.mk/.mak/makefile`), so a
file claim would MISS and REFUTE, taking `extFAIL` off 0.

**Two questions for whoever takes this lane**, in order:
1. **Is emitting a file target under `uses` correct at all?** If make's `uses` means "this target uses
   this prerequisite file", the type is being used for a file dependency and the honest fix may be to
   emit a different type or a claim kind, not to spell the target differently. Check the analyzer's
   intent against the ontology before touching the target.
2. **If it is correct**, the class is a RULED boundary with its count — but only after establishing
   that no claim kind can verify it, which the paragraph above argues and a lane must confirm by
   measuring the arbiter's own `classifyEdge` rather than by reading it.

## Cause 2 — 407 ambiguous: cross-file name collisions (the programme's most repeated fix)

    uses       PRE_VSN 5 declarations [constant] · APP_VSN 7 · EBIN 2 · EMULATOR 2
    exports    simple.beam 4 declarations [function]      (a build artifact, declared 4×)
    references GRAPHQL_ENGINE_PATH 2 declarations [constant]

These are **a bare name declared in more than one Makefile of the same project** — the shape four lanes
have now fixed with a FILE-SCOPED identity: toml (`amb 47 → 0`), julia (`contains 7,162 → 0`), css
(`456,403 → 183`), php (`amb 133,369 → 120,520`).

**BUT MEASURE THE CEILING BEFORE APPLYING IT — that is now a rule (§5e), and the ceilings differ by
language:** julia's `calls` was **0.6%** and its `references` **1.0%**; xml's twin class was **0**;
php's `calls` was the one lane where it reached (**28,901 provable, 12,849 moved**). make's project
scope is a repository, and `PRE_VSN`/`APP_VSN` look like per-include-file version constants, so the
ceiling could be large or zero. **Split the 407 by declarations-per-target and by declaring FILES per
target before writing anything**, the way css split its 456,587 and julia split its 50,149.

## What is NOT a cause here

`contains` 1,106 resolved with **`intended` 971** and **0 ambiguous** — clean. The 143 `ofWhich` are an
**upper bound** on arbitrary bindings, not a defect count, and make's earlier reading showed the
same-file preference settles most of them. `imports` 14 edges is too small to be worth a turn.
