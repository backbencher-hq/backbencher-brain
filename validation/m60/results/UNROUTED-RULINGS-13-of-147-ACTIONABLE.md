# THE UNROUTED CLASS, RULED: **13 OF 147 ARE ACTIONABLE**, worth 19,835 relationships — and the instrument says of itself *"it proposes, it does not rule"*

**`script/m60/unrouted-extension-rulings.ts` → `validation/m60/results/unrouted-extension-rulings.json`.** **The census
found 154 extensions a grammar already reads; this joins them against the ruling table and the content, and the
population it leaves is much smaller.**

    fixableRows                          147
    actionableWithAnExistingRuling         0     <- NO ruling table covers any of them
    actionableWithAContentProposal        13     <- THE ACTIONABLE SET
    needsARulingWithoutAProposal         121
    mixedStrides                          11
    closedByRuling                         1
    notActionableNameFragments            12
    proposalsTheGrammarItselfDeclares      0
    proposalsItsGrammarDoesNotDeclare      8
    proposalsWithNoVendoredDeclarationToCheck   5
    proposalsAwaitingTheOwningLanesStandard    13
    conflictsBetweenCensusAndContent      11
    RELATIONSHIPS BEHIND THE CONTENT PROPOSALS  19,835

> **SO "154 READABLE EXTENSIONS" IS A CANDIDATE SET AND "13 ACTIONABLE" IS A WORK QUEUE, AND THE DIFFERENCE IS 134
> ROWS THAT NEED SOMETHING NOBODY HAS YET SUPPLIED** — *a ruling, a proposal, or a decision that a name fragment is
> not a format.*

## AND THE INSTRUMENT'S OWN BOUNDARY IS THE SENTENCE TO KEEP

> *"**A SIGNATURE READS THE FIRST 1 KB AND KNOWS NOTHING ABOUT SEMANTICS: IT PROPOSES, IT DOES NOT RULE.**"*

**THAT IS THE CENSUS-QUALIFIER PROBLEM SOLVED BY DESIGN RATHER THAN BY CAVEAT** — **the instrument that can see that a
grammar PARSES a file is not the instrument that can decide the file SHOULD be parsed that way**, *so it splits the
two and hands the second to a lane.* **And 13 rows are explicitly `proposalsAwaitingTheOwningLanesStandard`** — *not
rejected, not accepted, **waiting for the lane that owns the format**.*

## AND THE ZERO IS THE MOST INFORMATIVE NUMBER IN THE TABLE

**`actionableWithAnExistingRuling = 0`.** **Not one of the 147 has a ruling table entry.** *So the census's candidates
are not blocked by a decision that went against them — **they are blocked because no decision exists**, and every one
of the fixes that landed today (`.mts`, `.cts`, `.graphqls`, `.sass`, `.jsonl`, `.jsonlog`, `.sbt`, `.phpt`) **was
made without one.***

> **WHICH MEANS THE PROGRAMME'S ACTUAL GATE ON THIS CLASS IS NOT EVIDENCE — IT IS SOMEONE DECIDING.** *Eight fixes
> were made by eight lanes on their own reading of their own format; **121 rows now wait for a ruling that the
> existing table cannot supply**, and the honest statement is that **the mechanism that produced today's eight fixes
> is a lane encountering its own population, not a census producing a queue.***

**AND THE 12 `notActionableNameFragments` ARE A CLASS WORTH NAMING**: **an extension that is not a format** — *the
census measured a bucket, the ruling check measured that the bucket's name is a fragment, and the row is closed.*
**That is a ruling, made on evidence, and it is the one the table records.**
