# PYTHON'S FIRST-EVER GATE ROW — 76.4% residual, and TWO TYPES RESOLVE NOTHING AT ALL

**Lead run, 600-file probe.** Python has **never been measured by this programme**: it is **not in the gate's lane
map** (zero occurrences), and a whole Python lane — `real-python-analyzer.ts` at **+1,150 lines**, 48 files,
**8,569 insertions** — was found **uncommitted** and secured tonight (`c343baa0b`, `d113b6875`). **The rust probe
proved the gate takes `<lang> <extension>` directly**, so no infrastructure was needed.

    type          edges    resolved  collRes  amb(decl)  unresolved   residual
    TOTAL         69,042   16,329    4,334    10,865     41,848       76.4%
    calls         28,738    3,609        0     2,152     22,977
    uses          19,399    3,254        0     7,878      8,267
    contains       8,144    8,142    4,334         0          2
    imports        4,972        0        0         0      4,972   <-- NOTHING RESOLVES
    references     3,231      517        0       116      2,598
    extends        1,492      263        0       250        979
    exports          235      103        0         6        126
    instantiates     898      435        0       463          0
    overrides      1,915        0        0         0      1,915   <-- NOTHING RESOLVES
    implements        18        6        0         0         12
    extFAIL 0 · ext? 0 · bindFAIL 0 · causeFAIL 0

## THE TWO FINDINGS THE GATE EXISTS TO PRODUCE

**`imports` resolves ZERO of 4,972, and `overrides` resolves ZERO of 1,915.** Not "few" — **none.** A type that
resolves nothing is not an ambiguity problem and not a boundary: **it is a mechanism that is either absent or
never reached**, and the two are distinguishable by reading the analyzer.

**AND `contains` IS THE CONTROL**: **8,142 of 8,144 resolved (99.98%)** with 4,334 `collRes`. **So the gate, the
key space and the arbiter all work on this lane** — the two zeros are about the two types, not about the
measurement. **That is what makes them actionable rather than suspicious.**

## WHAT THIS IS AND IS NOT

**IT IS**: the first gate row Python has ever had, on a **600-file probe** of a corpus the gate has not
enumerated — **a probe, not a population run** — and it establishes that the lane is measurable, that
`contains` is healthy, and that two types fail completely.

**IT IS NOT**: a verdict, a population number, or a residual anyone should quote as the lane's. **The 76.4% is a
600-file probe's residual** and the population may differ in either direction.

**AND THE FOUR-CLAUSE BAR NOW APPLIES TO IT**, exactly as it does to Laptop B's 23: named causes with measured
counts, each fixed with a same-population before/after or ruled with a **RUN** falsifier, and the three FAIL
columns at zero. **`extFAIL`, `ext?`, `bindFAIL` and `causeFAIL` are already 0** — clause 4 is met on the probe,
which is the one clause that can be read this early.
