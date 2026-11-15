# protobuf — named-cause list (Lead measurement, 2026-10-10)

`npx tsx script/m14/residual-gate.ts --lane protobuf` — whole admitted population, production scope.

    type        edges   resolved  ofWhich  amb    unresolved  residual%   intended  twin  noDecl
    uses        13,482    11,446       0    1,065        971       15.1%          0  3,580     49
    imports      1,574         0       0        0      1,574      100.0%          0      0  1,574
    exports          4         0       0        0          4      100.0%          0      0      4
    contains    40,630    40,630   2,205        0          0        0.0%     40,630      0      0
    overrides        2         2       0        0          0        0.0%          0      0      0

protobuf's residual is **2,549** of 55,692 (4.6%) and it is TWO causes plus two trivial rows.
No lane has worked this lane; this is the Lead's reading of the instrument's output, not a lane
measurement — the numbers are the gate's.

## `contains` IS FULLY RESOLVED, and it is the strongest single-type result in the programme

40,630 edges, **40,630 resolved, `intended` 40,630, `twin` 0, `noDecl` 0**. Every containment edge in
this corpus binds to a declaration **in its own file on its own line** — 100% determinate, against the
indexer's own control arm of **37,318 of 49,729** collision-bound picks that go to the WRONG symbol.
The 2,205 `ofWhich` are an **upper bound** on arbitrary bindings, not a defect count, and with
`intended` at 100% the tie-break demonstrably never decided one of them.

## Cause 1 — `imports` 1,574 unresolved, 100% of the type

Every import edge in the lane is unresolved. A protobuf import is
`import "google/protobuf/timestamp.proto";` — a **FILE PATH**, which can never answer against a
declaration key space. Same family as make's file-shaped `uses` and css's `imports`.

**Unlike make's, this one may be FIXABLE, and the first thing to measure is whether it is a file claim
the project can CONFIRM.** `importProjectFile` is admissible **only where the admitted list verifies
it** — toml's fix took `imports` 331 → 13 with **verify 318 / refute 0** by claiming the manifest FILE
and cross-tabbing both sides before emitting (json's is one `statSync`). So:

1. **split the 1,574 by whether the target resolves inside the admitted `.proto` population** — a
   well-formed `import "a/b.proto"` naming a file the project carries is claimable; a
   `google/protobuf/*` well-known-type import is not, unless the repo vendors it;
2. **cross-tab BEFORE emitting, both directions** (verify vs refute) and report the counts — **a file
   claim that MISSES REFUTES, and `extFAIL` must stay 0**, which is why the split comes first;
3. the residue that names nothing admitted is a **ruled class** with its count, not a claim.

## Cause 2 — `uses` 1,065 ambiguous + 971 unresolved (15.1%)

`uses` carries `twin 3,580` against `intended 0`, which is the honest reading for a type whose edge
line is **not** the target symbol's line: intent is unprovable for `uses` by construction (it is not in
`LINE_IS_TARGET_LINE`), so the twin column is **not** evidence of wrongness here — see the corrected
legend. What needs measuring first is the **split** the way julia split its `calls` and `references`:
by marker, by target shape (bare vs dotted), and by whether the declaration is in the edge's own file.
**State every candidate rule's CEILING before writing it** — julia's `calls`/`references`/`uses`
ceilings came in at 0.6%, 1.0% and 1.7% for the fleet's php-shaped owner-qualification fix, and xml's
twin class priced at **zero**. This programme's most-repeated fix does NOT reach most types, and
protobuf's `uses` must be measured rather than assumed either way.

## The two trivial rows

`exports` **4** unresolved and `overrides` **2** resolved. Neither is worth a turn on its own, but
`exports` unresolved-by-4 is 100% of its type and belongs in whatever `uses` turn touches it.
