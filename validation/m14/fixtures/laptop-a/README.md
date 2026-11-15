# LAPTOP A — python and csharp, the missing probe

> **Two agents measured Laptop A tonight, in this directory.** `FIRST-MEASUREMENTS.md` holds **rust
> 78.5 % · java 77.4 % · go 64.4 %** and `TYPESCRIPT-JAVASCRIPT-and-the-colon-confirmed.md` holds
> **typescript 73.4 % · javascript 84.5 %**; this file holds **python 76.9 % · csharp 65.7 %**. All are
> 400-file stride probes, comparable to each other and to nothing else. **That is 8 of the 18 remaining
> Laptop A lanes measured, and the eight sit between 64.4 % and 84.5 % residual.**

**Two lanes measured, NO fixes and NO lever pricing: the measurement is the deliverable.** Both runs
are the gate's own 400-file STRIDE probe — the unit is named on every number below, because a stride
reading of a file-scoped quantity is a lower bound by construction, and this fleet has now seen one
read HIGH (javascript whole-repo 61.3 % against its stride's 84.5 %). **Neither row is the lane's
whole-population number.**

## The extensions, and why they are the population

| lane | extensions passed | routing (verified, not assumed) | extra spellings | tracked files |
|---|---|---|---|---|
| python | `py,pyw,pyi` | `language-detection.ts:112` — all three → `python` | `.pyw` **0 files**, `.pyi` 23 | **14,022** across 50 repos |
| csharp | `cs,csx` | `language-detection.ts:125` — both → `csharp` | `.csx` **0 files** | **14,680** across 23 repos |

The Lead's lists were `py,pyi` and `cs`; the router carries **`.pyw`** for python and **`.csx`** for
csharp as well, so the full routed list is what was passed — both extras measure **0 files** on this
corpus, which is stated rather than left as an assumption. `.pyw`/`.csx` are NOT other languages the
way `.tsx` is (`tsx` routes to its own language); they route to the same analyzer.

**Filesystem ≠ population**: the gate admits **tracked, routable** files, and reports what it dropped —
python `400 of 11,488` (corpus 14,022, of which **2,533 tracked-but-absent/unreadable + 1 over the
1 MB cap**), csharp `400 of 14,424`-corpus with **255 absent + 1 over cap**.

## python — `py,pyw,pyi`, stride 400 of 11,488

TABLE 1, PER PROJECT (production's scope — the verdict's):

| type | edges | resolved | amb(decl) | unresolved |
|---|---|---|---|---|
| calls | 14,021 | 1,717 | 913 | 11,391 |
| uses | 10,915 | 2,307 | 1,914 | 6,694 |
| contains | 3,485 | 3,485 | 0 | 0 |
| imports | 3,035 | 32 | 7 | 2,996 |
| references | 1,865 | 283 | 68 | 1,514 |
| exports | 17 | 12 | 1 | 4 |
| extends | 609 | 74 | 113 | 422 |
| implements | 18 | 15 | 0 | 3 |
| **overrides** | **856** | **0** | 0 | **856** |
| instantiates | 400 | 228 | 172 | 0 |
| **TOTAL** | **35,221** | **8,153 (23.2 %)** | **3,188** | **23,880** |

**residual 27,068 of 35,221 = 76.9 %** · `extFAIL` / `bindFAIL` / `causeFAIL` = **0 / 0 / 0**.
TABLE 2 (POOLED corpus — a different key space, NOT the verdict's): resolved 9,045 · amb 6,002 ·
unresolved 20,174. The two are reported separately because quoting the wrong one misstated a lane by
~2,800 edges when java first ran.

## csharp — `cs,csx`, stride 400 of 14,424

| type | edges | resolved | amb(decl) | unresolved |
|---|---|---|---|---|
| calls | 9,781 | 2,132 | 1,497 | 6,152 |
| uses | 5,687 | 1,674 | 1,357 | 2,656 |
| contains | 4,541 | 4,541 | 0 | 0 |
| **imports** | **0** | 0 | 0 | 0 |
| references | 5,318 | 656 | 569 | 4,093 |
| exports | 343 | 314 | 29 | 0 |
| extends | 282 | 79 | 3 | 200 |
| implements | 134 | 4 | 4 | 126 |
| **overrides** | **286** | **0** | 0 | **286** |
| instantiates | 1,764 | 245 | 154 | 1,365 |
| **TOTAL** | **28,136** | **9,645 (34.3 %)** | **3,613** | **14,878** |

**residual 18,491 of 28,136 = 65.7 %** · `extFAIL` / `bindFAIL` / `causeFAIL` = **0 / 0 / 0**.
TABLE 2 (pooled): amb 4,711 · unresolved 13,387. `instrument self-test: PASS (control fired)`.

## Types resolving ZERO — mechanism ABSENT or NEVER REACHED, decided by reading the analyzer

* **csharp `imports` = 0 EDGES.** `real-csharp-analyzer.ts:1103` handles `using_directive` and emits it
  as **`RelationshipType.References`** (`:1148`, `:1185`). The mechanism is PRESENT and ROUTED
  ELSEWHERE — so this is a NAMING/DECISION, not a gap. **A lever, named and not priced.**
* **csharp `overrides` = 286 edges, 0 resolved.** `RelationshipType.Overrides` appears twice in the
  analyzer, so the mechanism EXISTS; the targets are interface/framework members
  (`IEquatable.GetHashCode`, `ICollection.Add`, `IEnumerable.GetEnumerator`) that no project declares,
  and the edges carry **no external claim** — so they land in `unresolved` with nothing stating why.
* **python `overrides` = 856 edges, 0 resolved.** Three emission sites
  (`real-python-analyzer.ts:3091`, `:3101`, `:3182`), one of them the universal `object.__init__`. The
  targets are dotted (`<owner>.<name>`) and the sample resolves NONE of them. Mechanism present,
  targets unresolved, no claim — the same shape as csharp's.
* python `imports` resolves **32 of 3,035 (1 %)** and its targets are colon-spelled
  (`<module>:<item>`, `:1891`, `:2002`), which the project key space does not hold. **The Lead's
  earlier reading was `0 of 4,972`: the type has MOVED to 32 resolved, so it is no longer a zero — but
  it is still a near-zero and the cause is the spelling.**

## EARNED / NOT EARNED

**EARNED** — both stride rows above, per-type, on the named extensions, with the three FAIL columns at
zero and BOTH key spaces quoted; the extension routing read from `language-detection.ts`; the
absent-vs-unreached calls read from the analyzers themselves; the populations and the dropped-file
counters from the gate's own POPULATION block.
**NOT EARNED** — any whole-population number for either lane. Both corpora are **above the ~9,000-file
depth where a sequential walk has been measured to collapse** (python 11,488 admitted, csharp 14,424
corpus), so the whole-population route needs the sharded treatment before its number is quotable.
**NOT EARNED** — any claim about whether these edges point at the RIGHT declaration; that is
`differential.ts`'s question, as the gate's own scope-of-a-PASS block says.

## Levers seen, named, NOT priced (per the assignment)

1. csharp `using` → `references` (a routing decision that leaves `imports` empty for the lane).
2. `overrides` in BOTH lanes: 1,142 edges, 0 resolved, no external claim on any of them.
3. python `imports` colon-spelled targets: 3,003 unresolved on a spelling the key space cannot hold.
