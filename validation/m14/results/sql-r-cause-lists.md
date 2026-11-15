# sql and r — named-cause lists (Lead measurement, 2026-10-10)

Two more untouched lanes. `npx tsx script/m14/residual-gate.ts --lane <lang>`, whole admitted
population, production scope. Numbers are the gate's.

## sql — 31,297 edges, residual 36.6%, two collision causes and one small unresolved tail

    type         edges  resolved  ofWhich    amb   unresolved   res%   extOK  twin   noDecl
    uses         9,160     4,560        0  3,582          734  47.1%     284 5,156     903
    references   6,015     2,346        0  3,598           71  61.0%       0 1,718      58
    calls        3,908       484        0  2,411        1,007  87.5%       0 1,488     839
    imports         53        16        0     31            6  69.8%       0    16       6
    instantiates    21        11        0      8            2  47.6%       0     8       2
    overrides        8         0        0      8            0 100.0%       0     0       0
    contains    12,132    12,132      424      0            0   0.0%       0     0       0
    TOTAL       31,297    19,549      424  9,638        1,820  36.6%     290

* **`references` 3,598 ambiguous (61.0%) with only 71 unresolved and `noDecl` 58** — the residual here
  is almost entirely **name collision**, not dangling targets, and `twin` 1,718 exceeds the ambiguous
  count, which is the honest reading for a read-site type where the intent column is silent by
  construction.
* **`uses` 3,582 amb + 734 unres (47.1%) with `extOK` 284** — the only external claims in the lane, and
  **284 verified against 0 unverifiable** is the favourable side of the `extQ` question (§5v): sql's
  external claims are checkable, so this lane has no `extQ` problem at all.
* **`calls` 2,411 amb + 1,007 unres (87.5%)** is the worst rate; `noDecl` 839 of 1,007 unresolved.
* **`contains` 12,132 all resolved, `ofWhich` only 424** — and `intended` reads 0, which is the intent
  block's coverage rather than a defect signal; **check the block's population before quoting that
  column** (scss showed the same shape).

## r — 80,067 edges, residual 53.4%, ONE dominant cause

    type         edges  resolved  ofWhich    amb   unresolved   res%   intended  twin   noDecl
    calls       48,222    14,413        0  2,785       31,024  70.1%          0 23,786  19,394
    uses         4,810       652        0  1,556        2,602  86.4%          0  2,704   1,704
    references   2,137       162        0    104        1,871  92.4%          0    727   1,355
    imports      2,095       144        0     80        1,871  93.1%          0    727   1,355
    implements   1,133       657        0     65          411  42.0%          0    577     185
    extends        351       165        0    135           51  53.0%          0     57      36
    overrides       95         0        0     95            0 100.0%          0     0       0
    exports      3,591     3,507        0     84            0   2.3%      3,591     0       0
    instantiates     3         1        0      2            0  66.7%          0     0       0
    contains    17,630    17,630    6,001      0            0   0.0%     17,616   0       0
    TOTAL       80,067    37,331    6,001  4,906       37,830  53.4%

* **`calls` 31,024 unresolved (70.1%) is 82% of the lane's entire unresolved column** — `noDecl` 19,394
  of 31,024. **This is a resolution/claim question, not an ambiguity one**, and the fleet's split applies:
  **how many of the 31,024 name a candidate ANYWHERE?** hcl measured 1,407 twin vs **12,054
  no-candidate-anywhere**; zig measured **87.6% dotted and external or file-shaped**. R's `calls` targets
  are function names, so the file/package-shaped subset is likely smaller and the std-surface question
  (base R, CRAN packages) larger — **but that is a hypothesis and it is exactly what the split decides.**
* **`imports` 1,871 unresolved (93.1%) and `references` 1,871 unresolved (92.4%) — the SAME number.** That
  is almost certainly one edge population counted under two types, and it is worth confirming rather than
  assuming: if so, R joins the **shared `imports` cause** (`library(pkg)` is a package name, the same
  file/package-path shape as protobuf/graphql/clean/scss/zig), and one fix serves six.
* **`exports` 3,591 with `intended` 3,591 of 3,591 at 2.3% residual** — cleanest type in the lane, and
  `contains` 17,630 all resolved with `intended` 17,616 of 17,630 (**14 short**, the first lane where
  containment is not at full resolution — those 14 are worth naming).
* `overrides` 95 edges, **0 resolved, 100%** — every one ambiguous, and `uses`/`references` are both
  above 86%.
