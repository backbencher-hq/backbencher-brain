# PROPOSAL (fleet-level, clean is the measured case) — `residual-gate.ts` must run the lane's DECLARED arm, and today it does not

**From:** clean lane owner · **date:** 2026-10-29 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/residual-gate.ts` (Lead-owned — this lane may not edit it). One flag, one table.
**Evidence:** two live runs of the two instruments over the same 312 files, below.

**Status: TAKEN 2026-10-29** — `BINDING_COLLAPSE_LANES = new Set(["clean"])`, the flag appended to the
runner's argv, and the arm printed in the gate's header (`arm: --binding-collapse — the lane's DECLARED
mode …`). Verified: `residual-gate.ts --lane clean` now reads **TOTAL 30,400 · resolved 22,075 · amb
1,076 · unresolved 2,511 · extOK 4,738 · `overrides` 306/306**, identical to the arm of record. The
figures quoted below are the PRE-FIX measurement and the pre-implements-rule arm (21,791 / 1,360 /
3,871); they are kept as the evidence the fix was needed, not as the current numbers.

## 0 · THE TWO INSTRUMENTS DISAGREE ABOUT THE SAME LANE

```
bun run script/m14/incoming-gate.ts clean icl,dcl 0 --binding-collapse
  TOTAL 30,400 · resolved 21,791 · amb 1,360 · unresolved 2,511 · extOK 4,738 · extFAIL 0

bun run script/m14/residual-gate.ts --lane clean
  TOTAL 30,400 · resolved 20,366 · amb 2,785 · unresolved 2,511 · extOK 4,738 · extFAIL 0
  resolved 67.0%   residual 5,296
```

The edge population, the unresolved column, extOK and extFAIL are **identical**. The difference is
exactly the `--binding-collapse` pass: the residual gate invokes
`npx tsx script/m14/incoming-gate.ts <lang> <ext> 0` (`script/m14/residual-gate.ts:160`) and the flag
is not part of that argv, so it measures the NO-COLLAPSE arm of a lane whose declared arm IS the
collapse.

## 1 · WHY THAT IS A DEFECT AND NOT A CONSERVATIVE READING

The lane's own declaration (`validation/m14/instruments/clean/incoming-declaration.json`) declares the
collapse as **the correct mode for this language**: a Clean module is DECLARED in `.dcl` and
IMPLEMENTED in `.icl`, so one declaration is written in two files, and the gate's rule (same non-empty
`qualifiedName`, different from the bare name) is exactly that pair. The 2026-10-29 pass made the
module-level half of that rule reachable (`Module.name`), which is why the declaration reads 1,360
ambiguous rather than 2,785.

So on the collapse arm the lane's `overrides` reads **306/306 resolved**; the residual gate prints
**2 resolved / 304 ambiguous**, i.e. it reports a state the lane fixed on 2026-10-28 and the declaration
records as fixed. A board reading the residual gate would reopen a closed defect. This is the fleet's
own "two places hold the same fact and only one is read" class, one level down: the arm is a property
of the LANE, and the worklist instrument assumes the default arm.

## 2 · THE FIX — ONE FLAG, ONE LANE SET

The collapse is a per-language ruling, not a global switch (julia's method table and clean's two-file
modules both declare it; a language without that property must NOT get it, because it would merge name
coincidences — the gate's own docstring measures that naive collapse was 95.8% wrong on julia). Two
options:

**(a) read the lane's declaration** — `incoming-declaration.json` already carries
`_arm.bindingCollapse` as prose. That is a string, not a flag; parsing prose is not a ruling. If the
field is wanted, make it machine-readable first (`"_arm": { "bindingCollapse": true }`).

**(b) a literal in the residual gate**, which is what the incoming gate itself does for its own
per-language tables:

```ts
/** Lanes whose declaration measures the `--binding-collapse` arm (one declaration written in two
 *  files): clean 2026-10-28 (a `.dcl`/`.icl` pair), julia (its method table). ANY other lane must
 *  not be listed: the collapse is a language property, and on a lane without it the rule merges
 *  name coincidences (the incoming gate measured 95.8% of a naive collapse as exactly that). */
const BINDING_COLLAPSE_LANES = new Set(["clean"])
...
const flags = BINDING_COLLAPSE_LANES.has(lang) ? ["--binding-collapse"] : []
execFileSync("npx", ["tsx", "script/m14/incoming-gate.ts", lang, ext, "0", ...flags], { ... })
```

and print the arm in the table header, so the two instruments' numbers can never be compared without
knowing which arm each read (the header already prints the population and the scope for the same
reason).

## 3 · WHAT IT CHANGES, MEASURED

`residual-gate --lane clean` after the flag: resolved 21,791 (not 20,366) · amb 1,360 (not 2,785) ·
residual 3,871 (not 5,296) · `overrides 306/306` (not 2/304). The 1,425-row difference is entirely the
collapse pass, and it is exactly the difference the declaration already publishes
(`_arm.bindingCollapse`). No other lane's row moves: the set is empty for every lane but clean.

## 4 · WHY IT WAS NOT FIXED HERE

`script/m14/residual-gate.ts` is Lead-owned ("`script/m14/**` … is the Lead's — propose, never edit",
`CLEAN-STATE.md`). The lane's own artifacts are consistent with the collapse arm and say so; the
worklist instrument is the one that needs the flag, and it is one line plus one set.
