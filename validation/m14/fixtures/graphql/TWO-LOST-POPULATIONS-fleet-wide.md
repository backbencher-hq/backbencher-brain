# TWO POPULATIONS LOST TO TWO ONE-LINE DEFECTS — 253 FILES — AND THE FIRST ONE IS FLEET-WIDE

**Found by the graphql lane's `unrouted-population-price.mts`, verified by the Lead against the source.** It is the
largest concrete loss found in the programme since the population question, and one of its two arms is **shared
machinery that affects every lane.**

## THE MEASUREMENT

    filesCopiedForIndexing      2,008
    filesInTheStore             1,754
    filesTheIndexerDidNotAdmit    254   by extension: .graphql 157 · .graphqls 97

    armA  .graphqls is NOT ROUTED to the graphql analyzer   97 files · parsed 0 · DEGRADED 97 · symbols 0
          language-detection.ts maps `graphql` and `gql` — and not `graphqls`
          THE FIX IS ONE ENTRY IN THAT MAP
    armB  a built-in ignore glob swallows lowercase testdata/  156 files
          `**/testData/**` in discoverAndFilterFiles, matched CASE-INSENSITIVELY by the `ignore` package
          THE FIX IS TO SPELL THE GLOB SO IT STOPS MATCHING `testdata/`

## THE SECOND ARM IS THE ONE THAT MATTERS, AND THE LEAD VERIFIED IT IN SOURCE

    src/ast/fingerprint.ts:106       "**/benchmarkapps/**", "**/coverage/**", "**/testData/**",
    src/ast/parallel-indexer.ts:1127 "**/testData/**",

**BOTH ARE SHARED MACHINERY.** So this is **not a graphql finding** — **it is a property of the indexer's own
discovery rule**, and **every lane whose corpus has a lowercase `testdata/` directory is losing those files
silently.** **The graphql lane measured 156 of them; the fleet total is unmeasured.**

> **A CASE-INSENSITIVE GLOB WRITTEN IN CAMELCASE DOES NOT MATCH WHAT ITS AUTHOR MEANT IT TO MATCH — and the
> loss is invisible, because an ignored file leaves no row.**

## AND ARM A IS A DIFFERENT KIND OF LOSS ENTIRELY

`.graphqls` **97 files · parsed 0 · DEGRADED 97 · symbols 0.** **A degraded parse is not a missing file** — it is a
file the engine saw, could not route to an analyzer, and answered with the fallback. **So `.graphqls` is being read
and producing nothing**, which is **worse than not being read**, because **it appears in the population.**

**AND THE FIX IS ONE ENTRY**: `language-detection.ts:59` reads
`json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", graphql: "graphql", gql: "graphql"` — **`graphqls` is
absent.**

## WHY THIS OUTRANKS A LANE'S RESIDUAL

**Every residual in this programme is computed over the population the gate admits.** **Two of the three Laptop-A
lanes and several Laptop-B lanes have corpora with `testdata/` directories**, and **253 files is one lane's count.**
**A population that is quietly smaller than the corpus makes every residual a fraction of the wrong denominator** —
and **nobody has measured the fleet total.**

**THE NEXT MEASUREMENT, named**: **across all 23 Laptop B lanes and the three measured Laptop A lanes, how many
admitted files are lost to `**/testData/**` matching `testdata/`, and how many to an unrouted extension?** **It is a
discovery-rule census, not a parse** — the same class of instrument as `production-admission-diff.ts`, which already
exists for the gate-vs-production question.

**AND THE FIX MUST BE TWO SEPARATE DECISIONS, not one**: **the glob** (which is a shared rule and affects everyone)
and **`.graphqls`** (which is one lane's routing). **Rule the glob first.**
