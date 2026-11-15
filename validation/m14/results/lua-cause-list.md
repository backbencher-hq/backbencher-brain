# lua — named-cause list (Lead measurement, 2026-10-10)

`npx tsx script/m14/residual-gate.ts --lane lua` — whole admitted population, production scope.

    type         edges   resolved  ofWhich    amb   unresolved   res%    extOK  twin    noDecl
    uses        54,980     10,183        0 41,424        3,373  81.5%        0 12,877    1,934
    calls       57,473     13,544        0 30,370       12,519  74.6%    1,040 35,028    5,619
    references  40,054      3,858        0 23,163       12,992  90.3%       41 21,824    8,764
    imports      6,601         76        0    880        5,645  98.8%        0    291    5,633
    exports      5,167        945        0  3,147        1,075  81.7%        0  2,780      612
    extends        171         54        0     69           48  68.4%        0      6       48
    instantiates   122         50        0     72            0  59.0%        0      0        0
    overrides       67          2        0     65            0  97.0%        0      0        0
    contains    55,322     55,322   41,592      0            0   0.0%   55,322      0        0
    TOTAL      219,957     84,034   41,592 99,190       35,652  61.3%    1,081

`extFAIL`/`bindFAIL`/`causeFAIL` all 0. No lane has worked lua.

## `contains` IS FULLY RESOLVED — 55,322 all resolved, `intended` 55,322 of 55,322, `twin` 0, `noDecl` 0

**And `ofWhich` is 41,592 — 75% of the type, the second-largest collision population measured after
markdown's 124,969.** With `intended` at 100% the tie-break demonstrably never decided one of them, so
it is an upper bound and not a defect count — but it is a very large upper bound on a very large type,
and it belongs with markdown's on the list of places where a **store-side intent split** would test the
biggest determinacy claims in the programme (json-lane's split, whose test is proven able to produce a
negative: duckdb 27,536 intended / **6 arbitraryTwin**).

## Cause 1 — `uses` 41,424 ambiguous (81.5%): the largest single collision population per type here

`twin` 12,877 and `noDecl` 1,934, so the bulk binds SOMEWHERE and the question is which. **81.5% on
54,980 edges is the worst `uses` rate measured except markdown's 7.6%-residual-outlier shape**, and lua's
`uses` is a table/field read — the same shape as hcl's `references` and julia's `uses`, where the fleet's
php-shaped fix reached **1.7%** and **0%** respectively. **Measure lua's own ceiling before writing
anything**, with a probe that imports the gate's counting rule and reproduces its four columns exactly.

## Cause 2 — `calls` 30,370 amb + 12,519 unresolved (74.6%), `twin` 35,028

**The largest `twin` count of any type measured in the programme** — and the honest reading for a
call-site type, whose edge line is not the target symbol's line, so the intent column is silent by
construction. `noDecl` 5,619 of the 12,519 unresolved.

## Cause 3 — `references` 23,163 amb + 12,992 unresolved (90.3%), `noDecl` 8,764

**The worst rate among the large types**, and `noDecl` is 67% of its unresolved — so a majority of the
unresolved name nothing the lua population declares. **That is the candidate-anywhere question**: hcl
measured 1,407 twin vs **12,054 no-candidate-anywhere**; lua's 8,764 needs the same split before any
resolution fix is priced against it.

## Cause 4 — `imports` 5,645 unresolved (98.8%), `noDecl` 5,633 — the SEVENTH lane with this cause

    protobuf 1,574 · graphql 170 · clean 1,891 · scss 3,405 · r 1,871 · hcl 334 · lua 5,645  = 14,890

**One mechanism — a module/package path is not a declaration — in seven languages**, now **14,890
edges**. `require("mod")` is lua's spelling of the same thing protobuf spells `import "x.proto"`. **This
is the programme's largest repeated cause by a wide margin and it is one fix, not seven.**
`toml-lane` is pricing the claimable subset across the set; lua's ceiling goes with it.

## The three small rows

`exports` 3,147 amb + 1,075 unres (81.7%) · `extends` 69 amb + 48 unres (68.4%, `noDecl` 48 of 48) ·
`instantiates` 72 amb and `overrides` 65 amb, both with **zero unresolved** so their residual is pure
collision. None is worth a turn alone.
