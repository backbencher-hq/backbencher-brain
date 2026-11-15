# PROPOSAL (Lead) — THE OWN-FILE TIE-BREAK: the gate's model must MATCH production's, and the fleet's control suite caught the first form

**From:** Lead · **date:** 2026-10-20 · **branch:** the working tree
**Touches:** `script/m14/incoming-rule.ts` (the arbiter) — a SHARED instrument, so this is a proposal
with the patch committed beside it, not a change that lands on its own.
**Why now:** the owner asked for "incoming and outgoing all together" — and the OUTGOING view (the
source's own file declares the name) currently cannot decide a row the INCOMING view declines.

## THE MECHANISM, AND IT IS MEASURED TWICE, INDEPENDENTLY, ON TWO POPULATIONS

Production's resolver walks the row's OWN FILE's statements first, so an edge whose own file declares
the target IS bound; the project's other declarations of the same name do not make it ambiguous. The
gate counted declarations by NAME across the whole project, so such a row was `amb(decl)` even though
production resolves it.

- **clojure:** 3,491 of 4,259 ambiguous rows are own-file-declared (**82.0 %**).
- **c:** 65,719 of 95,381 (**68.9 %**; calls 82.6 %, uses 59.1 %, references 82.1 %).
- **the c lane's JOINT:** 38,067 of bucket C's 56,488 (**67.4 %**) — so the c lever is ONE instrument
  with ONE price (57,817 + 65,719, the 38,067 appearing once), and the two populations are DISJOINT: a
  bucket-A row is UNRESOLVED, so its target is declared nowhere and no own-file rule reaches it; and no
  header rule can reach an ambiguous row, because adding declarations only grows a candidate set.

## THE IMPLEMENTATION IS FOUR LINES, AND THE ARGUMENT ALREADY EXISTED

`classifyEdge` already takes `ownFileDeclares`, and the GATE already computes it EXACTLY:
`(declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)`. **The argument was passed in and the
AMBIGUOUS BRANCH NEVER CONSULTED IT.** So this is not a new capability — it is the gate's model being
made to match production's.

The patch (`own-file-tie-break.patch`) adds the tie-break to the `decls > 1` branch, AFTER the owner
channel's decline check (a binding the store WITHDREW is not resurrected by the name model), plus a
narrowing to a PLAIN IDENTIFIER.

## A CORRECTION TO THE LEAD'S OWN REASONING, AND THE CHANGE LANDS ON THE RIGHT CONTROL

**THE LEAD WROTE THAT "THE FIXTURE SUITE CAUGHT THE FIRST FORM" — AND THAT IS FALSE, AND THE JAVASCRIPT LANE PROVED IT: `run-fixtures.ts`
IMPORTS NO `incoming-rule` AND CALLS NO `classifyEdge` (grep: ZERO hits ✓). A FIXTURE'S OUTCOME IS THE ANALYZER'S SYMBOLS AND
RELATIONSHIPS, SO AN ARBITER CHANGE CANNOT CHANGE A FIXTURE'S OUTCOME ✓.** The javascript 1 -> 2 and powershell 0 -> 1 are the lanes' own
in-flight work (the javascript lane's new R2 fixture, red by design until its analyzer-side fix lands, and a pre-existing analyzer defect
the lane owns) — the same numbers appear with the patch NOT applied ✓.

**SO THE TIE-BREAK'S CONTROLS ARE NOT THE FIXTURES — THEY ARE THE GATE'S OWN SELF-TEST (which runs inside an arm ✓) AND THE ARM'S MEASURED
MOVEMENT ✓, and the movement is a RESOLUTION gain that must be accounted SEPARATELY from the claim arms ✓.** The javascript lane's
attribution note is the fleet's model: the tie-break moves the NAME MODEL's ambiguous rows (javascript's `amb(decl)` 207,144 at HEAD
fd74fa2c4) into `resolved` ✓, and **no claim can be merged into `resolved` by this rule in either direction, because the arbiter's ORDER
already returns a row carrying an EXTERNAL claim (incoming-rule.ts:2062) and a row carrying a BINDING claim (incoming-rule.ts:1989) BEFORE
the count ✓✓.**

**THE NAMED CONDITION, FROM THE LANE THAT OWNS THE FIXTURES: "the own-file tie-break applies only to a target that is a NAME a declaration
can bind."** Two reasons that are NOT the same reason: (i) a target that is SOURCE TEXT is not a name — no declaration can carry `(fn)` — so
"the own file declares it" is a statement about a STRING, not a binding ✓; (ii) a target that carries the BINDING SEPARATOR cannot name a
declaration either, so the row is a CLAIM and resolving it would merge a claim into `resolved`, which the charter forbids ✓. `isPlainIdentifier`
covers both, and is Unicode-aware ✓.

**AND THE FIXTURES WERE RIGHT TO STAY RED: the javascript lane's `non-name-callee-refused` pins a real ANALYZER defect (a source-text callee
published as a `calls` target ✓), and the lane is landing the analyzer-side fix ✓. "AN ARBITER MUST NOT PAPER OVER AN ANALYZER DEFECT" ✓✓.**

## THE HISTORY OF THIS FILE, WHICH IS NOT EDITED AWAY

The full suite runs **~600 fixtures across every lane**. With the tie-break in, two fixtures went red
that were green before: **javascript 1 → 2 failures and powershell 0 → 1**.

The first form fired on targets that are **not names**: a source-text callee (`(fn)`,
`(0, helper.other)`, `define()`, `"text"`, `[]`) and a synthetic local identity (`shadowed\0value`).
The gate's flag is exact — these are real declarations of real strings — but a source-text callee is
not a binding to a declaration, and a local identity is deliberately distinct from the name it
shadows. **So the tie-break was narrowed to a plain identifier** (`isPlainIdentifier`, Unicode-aware).

**And the narrowing was NOT sufficient: the same two fixtures are still red.** So the rows still
firing are plain identifiers, and the adjudication is now a question for the lanes that OWN the two
fixtures:

- **javascript** — which fixture, and is the new outcome correct? A row that was ambiguous because a
  name is declared in two places and whose OWN FILE declares it is bound in production, so the
  fixture's expectation may be the thing that is stale — **but that is a call for the lane that owns
  the fixture, on the fixture's own reasoning, not for the Lead who changed the instrument.**
- **powershell** — 0 → 1 is new on this lane, and the powershell lane's own scope was 20/0.

**THE RULE THIS FOLLOWS: A SHARED INSTRUMENT DOES NOT LAND ON A GREEN SUITE IT MADE RED. THE CONTROL
WORKED — IT CAUGHT THE CHANGE — AND THE CHANGE IS NOT THE ARBITER'S TO FORCE THROUGH.**

## WHAT IS NEEDED TO LAND IT

1. The two fixture owners adjudicate their own fixtures against the new outcome.
2. The Lead applies the patch with the adjudication recorded, and the fixture expectations are updated
   with the change justified — the fleet's standing rule for a changed expectation.
3. The change is announced as a NAMED arbiter version, because it moves every lane's rows, and the
   lanes re-measure. (The Lead's own toml/clojure/powershell reproductions are queued on the small slot
   and should run on the NEW version, so the fleet's next wave is consistent.)
