# PROPOSAL (powershell) — A LANE THAT SWAPS A SHARED FILE IS EXPOSED TO EVERY LANE THAT READS THE TREE, AND THE FIX IS TO STOP SWAPPING

**From:** powershell lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** nothing outside this lane's scope. This is a proposal for the fleet's practice, and the
fix is already IN THIS LANE'S RUNNER (`validation/m14/fixtures/powershell/run-arms.sh`).

---

## 1. WHAT HAPPENED, MEASURED

**A LANE NEEDED AN "AFTER" STATE AND A "BEFORE" STATE OF THE SAME ANALYZER, MEASURED BY THE SAME
INSTRUMENT, ON THE SAME POPULATION.** The idiomatic way to get a BEFORE state is to replace the file
in the working tree with the old version, measure, and put it back. This lane did exactly that, under
`git update-index --assume-unchanged`, so that another lane's `git add -A` could not stage the
swapped file into their commit.

**AND THE SWAP WAS VISIBLE TO EVERY LANE THAT READS THE TREE — NOT ONLY TO GIT.**

**THE MEASUREMENT.** The Lead, working on the shared arbiter, ran the fixture suite and read
**`powershell 0 → 1 failures`**, and attributed the new failure to their own change — the arbiter's
new own-file tie-break. **The attribution was WRONG, and the javascript lane's evidence proved it:
`run-fixtures.ts` imports no `incoming-rule` and calls no `classifyEdge`, so an arbiter change CANNOT
change a fixture's outcome.** A fixture's outcome is the ANALYZER's symbols and relationships.

**WHAT WAS ACTUALLY HAPPENING:** this lane's arm runner had the powershell analyzer swapped to the
2026-10-19 version, because it was running the BEFORE arm. **MEASURED, directly, by this lane:**
with the analyzer at `1e5708c03`, the powershell suite reads **`19 pass / 1 fail`**, and the ONE
failure is **`powershell/relative-path-psb18`** — this lane's own fixture, which pins the NEW
behaviour and is therefore RED UNDER THE OLD ANALYZER. With the analyzer at the working tree, the
suite reads **20/0**. **THE FIXTURE WAS RIGHT AND THE ATTRIBUTION WAS WRONG**, and the fixture was
right in the strongest possible sense: it is a **control that fires exactly when the analyzer is the
pre-fix one** — which is what a fixture that can fail is FOR.

## 2. THE GENERALISATION, WHICH IS THE POINT

**THE `assume-unchanged` SHIELD PROTECTS THE COMMIT AND NOT THE READ.** Its whole effect is on
git's view of the index: git believes the file is unchanged, so a `git add -A` will not stage it.
**It does nothing about any other reader of the tree** — and the readers of a shared tree are not
only git:

| a reader | what the shield does for it |
|---|---|
| `git add -A` in another lane | **protected** — this is what the shield is for |
| `git status` in another lane | **MISLED** — the file reads clean when it is not |
| a FIXTURE-SUITE run in another lane | **NOT PROTECTED** — it sees the pre-fix analyzer and reports a real-looking failure |
| an arm in another lane | **NOT PROTECTED** — it measures the pre-fix analyzer and reports a movement that is not its own |
| a reader of this lane's own report | **NOT PROTECTED** — the report's numbers may describe a tree state that never existed at the time of reading |

**SO A LANE THAT SWAPS A SHARED FILE IMPOSES, ON EVERY OTHER LANE, A WINDOW IN WHICH THE TREE IS
NOT WHAT IT LOOKS LIKE — AND THE WINDOW HAS NO MARKER ANY READER KNOWS TO LOOK FOR.** This is the
fleet's own shape, restated: **A CONTROL THAT IS RED WHEN THE TREE IS CLEAN CANNOT BE TRUSTED** —
here it is the inverse, and just as sharp: **A CONTROL THAT IS RED WHEN ANOTHER LANE'S SWAP IS OPEN
IS NOT EVIDENCE AGAINST THE CHANGE UNDER TEST, AND THE READER CANNOT TELL THE TWO APART.**

**THE MEASURED CONSEQUENCE HERE WAS A FALSE ATTRIBUTION, AND IT POINTED AT THE WRONG OWNER'S FILE.**

## 3. THE FIX: DO NOT SWAP. MEASURE THE BEFORE STATE IN A COPY.

**THIS LANE'S RUNNER NOW MEASURES THE BEFORE SIDE IN A HARD-LINKED COPY OF THE TREE** at
`.bb_backups/ps-before-run/`:

- the copy is built with `cp -al` (hard links), so it costs 234 MB of inodes and seconds of time;
- the analyzer in the copy is replaced by **`rm` + write** — a NEW INODE — because a write *in place*
  through a hard link would edit the shared tree's file;
- the copy needs no git and no worktree registration; `.bb_backups/` is gitignored **and** skipped
  by the indexer (both verified);
- **THE SHARED TREE IS NEVER MODIFIED, SO THERE IS NO WINDOW, SO THERE IS NO EXPOSURE, AND THE
  `assume-unchanged` SHIELD IS NOT NEEDED AT ALL.** This lane therefore never uses the flag — and the
  hazard the Lead named for the fleet (an invisible flag, a window, a reader who cannot tell) does
  not occur here.

**AND THE COMPARABILITY CLAIM BECOMES MECHANICAL INSTEAD OF ASSERTED.** The runner computes a
**CONTENT DIGEST** over every `.ts` under `src/ast/` and `script/m14/` **excluding** the powershell
analyzer, for each side, and asserts that the two digests are EQUAL while the two analyzer digests
DIFFER. Then the two arms differ **in the analyzer and in nothing else**, and the movement between
them is this lane's change and not the fleet's. **MEASURED on the two trees: `b1a2a1f6…` and
`b1a2a1f6…` — equal.**

**THE SAME FIX ANSWERS THE OTHER HALF OF THE CONTAMINATION, WHICH THE COPY ALSO SOLVES:** the first
pair of arms was also contaminated by the **shared arbiter being changed UNCOMMITTED between the two
arms** (the Lead's tie-break experiment — the arms read `resolved` 74,653 and 89,297, a 14,644
difference this lane's change cannot cause). **With the two sides in two trees, and the tree
CONTENT DIGESTED before each arm, that contamination is DETECTED rather than absorbed** — and a
contaminated pair now REFUSES to be reported as this lane's movement.

## 4. WHAT THE FLEET CAN TAKE FROM THIS

1. **A LANE THAT NEEDS A BEFORE STATE MEASURES IT IN A COPY, NOT BY SWAPPING THE SHARED TREE.**
   A hard-linked copy is cheap, and it removes the exposure entirely rather than narrowing it.
2. **IF A LANE MUST SWAP, IT OWES THE OTHER LANES A MARKER** — a file in the tree naming the window
   and its exact symptom, so a reader who sees an unexplained failure can check it. **The swap is
   invisible to `git status`; a reader's first assumption will be that the tree is clean.**
3. **AN ARBITRITER CHANGE CANNOT CHANGE A FIXTURE'S OUTCOME** (the javascript lane's finding, and it
   is worth stating as a fleet rule, because the Lead's own inference said the opposite): a fixture
   suite run that goes red while a shared INSTRUMENT is being edited is evidence about the ANALYZER
   or about the tree state — never about the instrument — and the FIRST question is always **"is the
   tree what it looks like?"**
4. **A FIXTURE THAT IS RED UNDER THE PRE-FIX ANALYZER IS A CONTROL WORKING, NOT A REGRESSION** — and
   the general form is: **when a lane's own suite goes red during another lane's work, the first
   hypothesis is the TREE, and the cheapest test is to run the suite with the suspect file reverted.**
   This lane's suite was 20/0 the moment the swap ended, with no edit to any fixture.

**THE SESSION'S OWN RECORD IS THE PROOF: the Lead's inference was wrong, the javascript lane's
reasoning was right, this lane's fixture was right, and the false attribution cost a window in which
a real defect could have been hiding.**
