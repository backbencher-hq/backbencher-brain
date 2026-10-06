# INCOMING BASELINE — 23 laptop-B lanes

Produced by `script/m14/incoming-gate.ts`, the arbiter for the incoming side.
Commit: see `git log -- script/m14/incoming-gate.ts`. Population: **100-file stride sample
per lane** over the whole admitted corpus, production `parseFile`.

**Ambiguous is counted by DECLARATION.** The fleet's earlier `incoming-whole.tsv` counted
distinct KINDS, which reads 0 for a name declared in many files under one kind. Measured on
the same lanes the two differ by orders of magnitude — css 5 -> 20,715; toml 45 -> 569;
make 0 -> 297. Two lanes had already documented this (`fixtures/zig/ambiguity-split.ts:30`,
`fixtures/nim/ambiguity-classify.ts:38`, `real-scss-analyzer.md:1741`).

```
TOTAL over 23 lanes: edges 189,361   ambiguous(decl) 45,597   unresolved 55,264   external-marked 2,530
PASS 0   FAIL 23   UNMEASURED 0
```

| lane | edges | amb(decl) | unresolved | external |
|---|---|---|---|---|
| bash | 3994 | 419 | 1461 | 0 |
| fsharp | 8514 | 1134 | 5238 | 0 |
| zig | 10704 | 2026 | 3078 | 721 |
| lua | 5921 | 1787 | 1876 | 0 |
| julia | 12937 | 1189 | 8828 | 134 |
| nim | 3396 | 570 | 909 | 64 |
| php | 5934 | 312 | 4368 | 0 |
| powershell | 15714 | 2543 | 8983 | 0 |
| r | 4428 | 321 | 2600 | 0 |
| dart | 9098 | 642 | 5170 | 0 |
| sql | 1136 | 24 | 516 | 0 |
| graphql | 17563 | 5815 | 5261 | 0 |
| protobuf | 8841 | 430 | 778 | 0 |
| json | 22256 | 222 | 0 | 0 |
| yaml | 5591 | 296 | 0 | 9 |
| css | 25085 | 20715 | 425 | 0 |
| scss | 446 | 16 | 185 | 0 |
| hcl | 3703 | 1317 | 830 | 0 |
| make | 2622 | 297 | 1175 | 0 |
| toml | 1351 | 569 | 0 | 0 |
| xml | 1331 | 1031 | 19 | 0 |
| markdown | 3946 | 1055 | 222 | 1602 |
| clean | 14850 | 2867 | 3342 | 0 |

## Reading this

- **`PASS 0` is not a claim that 23 languages are broken.** It is the first number on this
  side that a gate reads, so it can be driven to zero lane by lane. Before this file
  existed, `incoming-check.ts` measured the same thing and could not fail.
- **Three lanes are at or near zero unresolved:** yaml 296/0, json 222/0, toml 569/0 of
  1,351 edges. toml and yaml are the two cheapest lanes to take to PASS.
- **`external-marked` is the only lanes already doing cause C:** markdown 1,602, zig 721,
  julia 134, nim 64. An UNMARKED external edge counts against a lane, because a stdlib
  name and a broken edge are otherwise indistinguishable.
- **css is the single largest population** at 20,715 ambiguous of 25,085 edges, and it is
  almost entirely `contains` on a bare selector name. That is cause A in its purest form.
- **This decides RESOLUTION only.** An edge can resolve to the WRONG declaration; that is
  `differential.ts`'s question and this gate does not touch it. One arbiter per question.

## Reproduce

```bash
npx tsx script/m14/incoming-gate.ts <lang> <ext> [maxFiles]   # one lane, per-type table
npx tsx script/m14/incoming-gate.ts --all [maxFiles]         # all 23
npm run audit:incoming-gate -- <lang> <ext>
```
