# LAPTOP A: `typescript` 73.4%, `javascript` 84.5% — and the `imports` colon CONFIRMED CROSS-LANGUAGE, with an `overrides` DEFECT found

**julia-lane, `0a7105090`.** No analyzer modified, no fix proposed: **this is the measurement the lane list was
missing**, and it is the two biggest populations in Laptop A.

    typescript   npx tsx script/m14/incoming-gate.ts typescript ts,tsx,mts,cts 400
                 FAIL — 574 ambiguous + 14,927 unresolved of 21,116 edges   (73.4%)
    javascript   npx tsx script/m14/incoming-gate.ts javascript js,mjs,cjs,jsx 400
                 FAIL — 4,918 ambiguous + 31,047 unresolved of 42,592 edges (84.5%)
    CONTROL      javascript js,mjs,cjs,jsx 0 --repo=bootstrap   (NO stride, 125 of 125 files)
                 39,913 edges · 4,108 resolved · 24,271 unresolved           (61.3%)

**AND THE CONTROL IS THE STRIDE LESSON AGAIN, IN THE OPPOSITE DIRECTION**: **the whole-repo reading is LOWER
(61.3%) than the stride (84.5%)** — so **a stride can read HIGH as well as low**, which is worth recording because
the programme has only ever seen a stride *understate*. **Either way the two shapes disagree, which is the point:
`maxFiles 0` or `--repo=` is the honest unit.**

## THE `imports` COLON IS NOW CONFIRMED IN A THIRD AND FOURTH LANGUAGE — AND IT IS STRUCTURAL

**`imports`: TS 2,337 (100%) · JS 1,324 (100%) — AND NOT ONE AMBIGUOUS EDGE.** The analyzer writes

    target: `${modulePath}:${itemName}`        real-typescript-analyzer.ts:5757 (siblings :5708, :5737)
    e.g. `react:useState` · `./OwnerType:OwnerTypeFromJSON`

> **"A module specifier joined to an item name is a spelling no declaration can carry, so the zero is STRUCTURAL."**

**THAT IS THE SAME COLON FORM PYTHON USES** (`os:path`, measured), **and it is the fourth language where `imports`
resolves nothing** — java (moduleName), python (`os:path`), typescript and javascript. **And the Lead's earlier
diagnosis of the colon as "the one character this programme reserved for `pathLikeTarget`" is thereby confirmed at
the emission site in a second language family.** **The metadata to act on is already there** — `module`, `alias`,
`isTypeOnly`, `isSideEffectImport`, `isRequire` — **so this is a fix with its inputs already present.**

## AND `overrides` HAS A DEFECT RATHER THAN A BOUNDARY

**JS `overrides`: 132 (100%) in the stride and 0 RESOLVED OF 420 in the whole-repo control.** And the mechanism is
**read out of the analyzer rather than inferred**:

* **the IN-FILE branch VERIFIES** — `reasonCode: "verified-in-file"`;
* **the CROSS-FILE branch emits `reasonCode: "first-parent-guess"` at confidence 0.5, `evidenceClass: inferred`,
  WITHOUT CHECKING THAT THE BASE DECLARES THE MEMBER** (`real-javascript-analyzer.ts:1540-1655`).

**AND IT IS MEASURED, NOT ARGUED**: on `bootstrap/js/src/base-component.js`, **`BaseComponent.dispose` is published
correctly**, and the edge **`BaseComponent.dispose -> Config.dispose`** is emitted — **while `Config`
(`bootstrap/js/src/util/config.js`) declares `_getConfig`, `_configAfterMerge`, `_mergeConfigObj`, … and NOT
`dispose`.**

> **AN EDGE WHOSE OWN METADATA SAYS `inferred` AND WHOSE TARGET'S DECLARING FILE DOES NOT DECLARE THE MEMBER IS THE
> `overrides` HALF OF THE OBJECTIVE'S CLAUSE 1: "every emitted edge is REAL, proven on the corpus."**

**So `overrides` on javascript is not a boundary and not an ambiguity — it is an unverified emission**, and **it is
the first concrete instance of the "emitted and unresolvable" class the Lead named when `go` turned out not to emit
`overrides` at all.** **Two different defects wearing one type name.**

## AND TWO ROUTER FACTS, WHICH ARE THE SAME DEFECT AS `.graphqls`

* **`.tsx` routes to its OWN language `tsx`** (`language-detection.ts:39`) — so an extension list of `ts,tsx,…`
  **mixes two languages**, and the population is not what the list says.
* **`.cts` IS NOT IN THE ROUTER'S MAP AT ALL** (3 files) — **the same unrouted-extension defect as `.graphqls`**
  (97 files), in a second lane. **That is now three lanes where an extension the corpus carries has no route.**
