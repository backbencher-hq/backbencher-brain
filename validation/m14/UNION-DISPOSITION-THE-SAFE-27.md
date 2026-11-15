# THE SAFE 27 OF THE REMAINING 293 — **applied under derived predicates, not read one by one**

**The remaining 293 paths were classified in bulk by the rules this union derived, and four verdicts came out:**

    COMPOSE                          266    <- the real remaining work
    TAKE MAIN (main migrated)         12    <- APPLIED
    KEEP HEAD (head migrated)          8    <- nothing to write
    HEAD-SUPERSET                      7    <- nothing to write

**SO 27 ARE DECIDED WITH NO JUDGEMENT NEEDED**, *and **the predicates are the ones the session paid for**:*

* **`HEAD-SUPERSET`** — *every line of main's survives inside HEAD's, so **the tree already is the union** and **a
  disposition that writes nothing is the one that cannot lose a line.***
* **`MAIN-SUPERSET`** — *nothing in this batch, which is itself a measurement.*
* **`TAKE MAIN (main migrated)` / `KEEP HEAD (head migrated)`** — *the side that carries `resolveCorpusRoot` or
  `fileURLToPath` wins, **unless it also carries a retraction token** — because *"the correct spelling is a property of
  the corpus root, not of the file"*, and **`script/m60` and `script/m13` are the same class with OPPOSITE resolutions.***
* **`KEEP HEAD (head has a retraction)`** — *`SUPERSEDED` · `WITHDRAWN` · `REVERTED` · `the wrong answer` on this side
  means main's block may be the thing this side withdrew.*

## THE 12 APPLIED, AND THE CHECK ON THEM

    script/m15/verify-edit-e2e-docs.ts          script/m15/verify-matrix-coverage-closure.ts
    script/m16/verify-edit-real-repo.ts         script/m20/verify-real-repo-ledger.ts
    script/m25/verify-listing.ts                script/m35/verify-freshness-core.ts
    script/m35/verify-s1-read-paths.ts          script/m43/verify-a4-corpus.ts
    script/m48/verify-c1-corpus.ts              script/m49/verify-governance.ts
    script/perf/live-rate-series.ts             src/lsp/graph_request.ts

**AND THE CHECK THAT GUARDS THE TAKE — the exact failure `go-tools` taught:** *for every path taken, **does it name the
literal without a resolver?*** *The answer is **NO for all twelve*** — *each either resolves the corpus through
`resolveCorpusRoot`/`fileURLToPath` or names no corpus path at all.* **So the take did not import the defect the take
exists to fix** — *which is exactly what happened when `go_tools` was ported and the leg died.*

**AND `script/m15/verify-edit-e2e-docs.ts` AND `verify-matrix-coverage-closure.ts` ARE THE TWO r-LANE NAMED** *as carrying
`go-tools` references needing a disk check* — *both now come from main, and both keep the hyphen.* **The check came back
clean on all five of the files r-lane listed, four of which HEAD already had right.**
