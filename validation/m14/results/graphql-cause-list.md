# graphql — named-cause list (Lead measurement, 2026-10-10)

`npx tsx script/m14/residual-gate.ts --lane graphql` — whole admitted population, production scope,
**every type CLOSED** under the new closure check (`fc6bf7a92`): 205,327 edges, all in a printed bucket.

    type         edges   resolved  ofWhich  amb(decl)  unresolved   res%   intended  twin  noDecl
    uses        50,759      8,255        0     13,485      29,019   83.7%          0 23,057  18,806
    references  67,328     32,233        0     11,098      23,997   52.1%          0 32,363     157
    exports     13,991      9,173        0      4,818           0   34.4%     13,991      0       0
    overrides    9,790      8,955        0        835           0    8.5%          0      0       0
    implements   3,177      2,368        0        776          33   25.5%          0     44      12
    imports        170          0        0          0         170  100.0%          0      0     170
    contains    60,112     60,112    9,065          0           0    0.0%     60,112      0       0
    TOTAL      205,327    121,096    9,065     31,012      53,219   41.0%

No lane has worked graphql. This is the Lead's reading of the instrument; the numbers are the gate's.

## `contains` IS FULLY RESOLVED, and `exports` IS DETERMINATE — the two strong results

* **`contains` 60,112 edges, all resolved, `intended` 60,112 of 60,112, `twin` 0, `noDecl` 0.** The
  9,065 `ofWhich` is an **upper bound** on arbitrary bindings, not a defect count — and with `intended`
  at 100% the tie-break demonstrably never decided one of them. Second lane after protobuf to reach
  this, against the indexer's control arm of **37,318 of 49,729** collision-bound picks that go WRONG.
* **`exports` 13,991 edges, `intended` 13,991 of 13,991, `twin` 0.** Its 4,818 ambiguous are therefore
  **not** a wrong-binding class: every one of them binds own-file-on-own-line when it binds at all.
  That is a strong prior for the fix — the 34.4% is a *name-collision* problem, not a *resolution* one.

Both are in `LINE_IS_TARGET_LINE`, which is why the intent column can speak for them at all. **For the
other five types the intent column is silent by construction** and the twin counts below are NOT
evidence of wrongness — see the corrected legend.

## Cause 1 — `uses` 13,485 amb + 29,019 unresolved (83.7%): the lane's dominant cause

`twin` 23,057 against `intended` 0, and `noDecl` 18,806. Those two together say the largest population
is a **member/field read whose declaration is not in the reading file** — the same shape as hcl's
`references` and julia's `uses`, and the two lanes that worked it found the fleet's php-shaped fix
reaching **1.7%** (julia `uses`) and **59.5%** (bash, by spelling). **So do NOT port a rule: measure the
ceiling first**, split by where the name is declared (SAME-FILE-ONE / SAME-FILE-MULTI / CROSS-FILE-ONLY),
and use bash's pattern — a probe that **IMPORTS the gate's counting rule and reproduces its four columns
exactly** before it is allowed to say anything (`incoming-rule.ts`; a probe that cannot reproduce the
gate is evidence about the probe).

## Cause 2 — `references` 11,098 amb + 23,997 unresolved (52.1%)

`twin` 32,363 and `noDecl` 157 — the largest twin count measured on any type so far. Same treatment as
Cause 1 and the same warning: for a read-site type the twin column is **not** a wrongness signal.

## Cause 3 — `imports` 170 unresolved, 100% of the type, `noDecl` 170

Exactly protobuf's shape: a graphql import (`#import "./foo.graphql"`) is a **FILE PATH**, which cannot
answer against a declaration key space. **Unlike protobuf's, this one is small and likely closeable as a
file claim** — toml's fix took `imports` 331 → 13 with **verify 318 / refute 0** by claiming the FILE and
cross-tabbing both directions BEFORE emitting. **A file claim that MISSES REFUTES and `extFAIL` must stay
0**, so split by whether the target names an admitted file first.

## The two small rows

`implements` 776 amb + 33 unres (25.5%) and `overrides` 835 amb (8.5%, no unresolved). Neither is worth
a turn on its own; both belong in whatever turn touches the smaller types, and `implements` has
`noDecl` 12 while `overrides` has none — so `overrides`' 835 is a pure name-collision class.
