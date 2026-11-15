# markdown, clean, scss — named-cause lists (Lead measurement, 2026-10-10)

Three untouched lanes measured in one pass. `npx tsx script/m14/residual-gate.ts --lane <lang>`,
whole admitted population, production scope. Numbers are the gate's.

## markdown — 283,976 edges, residual 5.5%, and the LARGEST `extQ` POPULATION IN THE PROGRAMME

    type         edges    resolved  ofWhich   amb   unresolved   res%    extOK     ext?   intended
    uses       124,925           4        0     1        9,555   7.6%       48  115,317          0
    calls        5,528         466        0 2,671        2,391  91.6%        0        0          0
    references   2,451       1,969        0   482            0  19.7%        0        0          0
    instantiates   399           9        0    48          342  97.7%        0        0          0
    imports         35           0        0     0           35 100.0%        0        0          0
    contains   150,638     150,638  124,969     0            0   0.0%        0        0    150,638
    TOTAL      283,976     153,086  124,969 3,202       12,323   5.5%       48  115,317

**`ext?` = 115,317 — sixty times yaml's 1,903, and 41% of the lane's edges.** The rate is the lowest of
any lane measured (5.5% residual) and the lane is nonetheless the furthest from a PASS, because
**`extQ` is neither resolved nor verified** and the objective's clause 2 requires one or the other. So
markdown's work is **the `extQ` disposal at scale**, and the programme has a method for it (§5v):
**split by emitting site FIRST** — yaml's `ext?` fell 1,903 → 254 with **82% of it turning out to be a
FIX rather than a ruling** (`extOK` 9,208 → 10,617) — then shape, mechanism, and a falsifier that is RUN.
`uses` also carries `noDecl` **124,880** of 124,925, i.e. the targets are almost entirely undeclared,
which is consistent with external-marking being the right call and the *claim kind* being the question.

`contains` 150,638 all resolved, `intended` 150,638 of 150,638 — **fourth lane running**. But
`ofWhich` **124,969** is 83% of the type, the largest collision population of any containment measured:
with `intended` at 100% the tie-break never decided one, so it is an upper bound, not a defect count —
**and it is also the single biggest `collRes` figure in the programme and the first place a store-side
intent split should be pointed.**

## clean — 30,739 edges, residual 51.0%, three causes

    type         edges   resolved  ofWhich    amb   unresolved   res%   intended  twin   noDecl
    references  10,108      2,541        0  4,446        3,121  74.9%          0 6,650    1,274
    exports      4,837      1,416        0  3,421            0  70.7%      4,837     0        0
    imports      1,891          0        0      0        1,891 100.0%          0     0    1,891
    calls        3,798      2,435        0  1,288           75  35.9%          0     0       75
    implements     712         63        0    630           19  91.2%          0   277       11
    uses         1,457      1,025        0    432            0  29.6%          0     0        0
    overrides      306          2        0    304            0  99.3%          0     0        0
    instantiates   122         80        0     42            0  34.4%          0     0        0
    contains     7,508      7,508    5,165      0            0   0.0%      7,508   0        0
    TOTAL       30,739     15,070    5,165 10,563        5,106  51.0%

* **`references` 4,446 amb + 3,121 unres (74.9%)** — the dominant cause, `twin` 6,650, `noDecl` 1,274.
* **`exports` 3,421 amb (70.7%) with `intended` 4,837 of 4,837 and `twin` 0** — the *whole* type is
  determinate when it binds, so its 70.7% is **pure name collision**, the same shape as graphql's
  `exports` (intended 13,991/13,991). **Reachable by a scoping rule if the colliding declarations are
  distinguishable — measure the ceiling first.**
* **`imports` 1,891 unresolved, 100%, `noDecl` 1,891** — third lane with this exact shape
  (protobuf 1,574 · graphql 170 · clean 1,891): a clean import is a **FILE PATH** and cannot answer
  against a declaration key space. toml's file-claim route is the candidate, with its cross-tab first
  (verify 318 / refute 0) because **a file claim that misses REFUTES and `extFAIL` must stay 0**.
* `contains` 7,508 all resolved, `intended` 7,508 of 7,508 — with `ofWhich` 5,165 (69% of the type).

## scss — 27,150 edges, residual 19.3%, two causes and three trivial rows

    type         edges   resolved  ofWhich    amb   unresolved   res%    extOK  twin   noDecl
    imports      3,636        231        0      0        3,405  93.6%        0   247    3,389
    references   9,634      4,361        0  1,540            0  16.0%    3,733 2,930    3,327
    extends        447        255        0     37          155  43.0%        0   246      140
    calls          382        330        0     52            0  13.6%        0     0        0
    exports        397        367        0     30            0   7.6%        0     0        0
    overrides       32         16        0     16            0  50.0%        0     0        0
    uses            91         91        0      0            0   0.0%        0     0        0
    contains    12,531     12,531       21      0            0   0.0%        0     0        0
    TOTAL       27,150     18,182       21  1,675        3,560  19.3%    3,733

* **`imports` 3,405 unresolved (93.6%), `noDecl` 3,389** — the dominant cause and the FOURTH lane with
  the identical file-path shape (protobuf · graphql · clean · scss). **Four lanes sharing one mechanism
  is no longer a per-lane fix: it is a shared one waiting to be written once.**
* **`references` 1,540 amb (16.0%)** with **`extOK` 3,733** — a large verified-external population, the
  opposite of markdown's 115,317 unverifiable ones, and a useful control: two stylesheet languages,
  same family, one verifies its externals and one does not.
* `contains` 12,531 all resolved with `ofWhich` only **21** — the cleanest containment in the programme.
  Its `intended` reads 2,240, which is the intent block's sampled coverage rather than a defect signal;
  **check the block's population before quoting that column.**

## THE CROSS-LANE RESULT THIS PASS PRODUCES

**Four lanes — protobuf (1,574), graphql (170), clean (1,891), scss (3,405) = 7,040 edges — have
`imports` at or near 100% unresolved with `noDecl` matching the edge count.** One mechanism, four
languages, and toml already demonstrated the fix shape on its own lane (`imports` 331 → 13, verify 318 /
refute 0). **This is the largest single repeated cause found in the programme and the best candidate for
one shared fix rather than four.** And `contains` is now at full resolution in **seven** lanes: protobuf, graphql,
nim, markdown, clean, scss, plus css/xml/to ml earlier.
