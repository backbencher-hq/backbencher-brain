# PYTHON — two ARBITER-SIDE proposals (the Lead's files: `script/m14/incoming-rule.ts`, `script/m14/incoming-gate.ts`)

**Lane `python` · 2026-10-20 · the lane's own work is landed; these are the two places where the
lane's measurement says the SHARED INSTRUMENT, not the lane, is what stands between a true claim
and a verified one.**

Everything below is measured, and the measurement's command, population and scope are named with
each number. The lane's own pages: `PYTHON-D7-WALLS.md` (the wall ledger), `PYTHON-DEPTH-2026-10-20.md`
(this round's arm and its three walls).

---

## 1 · THE `ownerMemberAbsent` CLAIM IS NEVER READ ON THE ROWS THAT NEED IT

### THE MEASUREMENT

`bun run script/m14/incoming-gate.ts python py,pyi,pyw 0 --index --dump` with
`BB_PY_OWNER_MEMBER_ABSENT=1`, on the FARM root (`BB_CORPUS_ROOT=$PWD/.corpus`), 11,559 files /
51 repos — the Lead's own flag-ON arm dump, `.tmp-lead/python-owner-absent-arm-dump.log`:

```
DUMP rows carrying the claim: 7,994
  externalVerified   6,562
  unresolved         1,432      <- claimed, and the arbiter never read the claim
```

Read from the dump with `awk -F'\t' '$6=="ownerMemberAbsent"{print $3}'` — the claim kind is
column 6 and the outcome column 3, so the split is the ARM's own words, not a reconstruction.

### WHY THE 1,432 ARE NOT VERIFIED — and it is NOT the gate's evidence map

The D7 ledger's reading was *"the owner is absent from the gate's `ownerMembers` evidence map"*
(`PYTHON-D7-WALLS.md` W1). **The arbiter's own code says otherwise**, and the difference is the
whole point of this proposal:

```ts
// script/m14/incoming-rule.ts, classifyEdge
if (claim !== null && claim.kind === "ownerMemberAbsent" && decls === 0) { ... }
```

**The claim is read only where `decls === 0`** — where the NAME MODEL has nothing. The rows that
carry the claim are, by construction, the rows the OWNER CHANNEL DECLINED: production withdrew the
name binding for every calls/uses row carrying an owner and re-binds only through the channel, and
a declined row is NULL in production (`incoming-rule.ts`'s own comment: *"A DECLINE does not fall
through to the count model: the store withdrew this row's name binding"*).

So a declined row whose target name IS declared somewhere else in the project has `decls > 0` —
**the claim is never read, and the row falls to the arbiter's `channelDeclined` branch and reads
`unresolved`.** The claim sits on the edge, the arbiter ignores it, and the row is exactly as
unresolved as it was before the claim existed.

That is why the arm's `ext?` column did not move (25,357 before and after) while `unresolved` fell
by 6,562: the 6,562 are the rows where the name model had nothing AND the owner was in the
evidence map, and the 1,432 are the rows where the name model HAD an answer (which production had
already withdrawn).

### THE PROPOSAL (one line, in the arbiter)

The claim's rule is *"a claim may never displace a name-model answer"* — and it is right. But a row
the owner channel DECLINED has NO name-model answer: the store withdrew it. So the gate should
read the claim where the channel declined, as well as where the name model is empty:

```ts
if (claim !== null && claim.kind === "ownerMemberAbsent" && (decls === 0 || channelDeclined === true)) {
```

`channelDeclined` is already computed in `classifyEdge` (it is the variable the `unresolved`
branch below reads), so the change is local. **What it would decide, and nothing else:** the claim's
own evidence still decides — VERIFIED when the owner is in the map and the member is absent,
REFUTED when the project declares the member (a refuted claim is a failure, as it must be),
UNVERIFIABLE when the owner is unknown. The claim is still a claim: it rides the external/binding
family and cannot raise `resolved`.

**THE SIZE OF THE CLASS IT WOULD DECIDE** is measured by the lane's own join
(`script/m14/py-owner-absent-join.ts`, whole population, the REAL index) and reported in
`PYTHON-DEPTH-2026-10-20.md` §3 — the split of the 1,432 into the owners the gate's map HOLDS (the
claim would verify) and the owners it does NOT (the claim would read UNVERIFIABLE, and the row
would move from `unresolved` to `ext?`, which is a named wall, not a resolution).

**WHAT THE LANE DOES NOT ASK FOR:** the lane does not ask the arbiter to read the claim on a row
that has a live name-model answer. The decoy class (a same-named declaration elsewhere in the
project) is the false-binding class the lane has refused three times, and the arbiter's `decls === 0`
gate is what keeps it out.

### THE SECOND, SMALLER GAP IN THE SAME CLAIM (the `c1` class)

The gate's `ownerMembers` map is keyed on the owners **OF MEMBERS**: a class-like symbol that
publishes NO member symbol is not a key at all (`incoming-gate.ts`'s construction walks the
symbols and adds `ownerName`/`leaf(ownerName)` for symbols that HAVE an owner). So a class that
publishes no member — an empty class, a class whose only members are class attributes the analyzer
does not publish as members, a class whose members are all nested classes — has NO entry, and a
TRUE absence claim about it reads UNVERIFIABLE instead of VERIFIED.

The claim's own rule says: *"VERIFIED when the owner is in that map and the member is not"* — an
owner that is present and declares no member of that name is exactly the claim's statement, and the
gate cannot express it. The fix is to give the map an EMPTY member set for a class-like owner with
no members (the arbiter's rule then reads "present owner + absent member = VERIFIED"), which is
the same shape as the one-line change above.

**THE LANE MEASURED THE SIZE OF BOTH** and reports them per repo in
`PYTHON-DEPTH-2026-10-20.md` §3. The lane did not edit the arbiter: the arbiter is the Lead's.

### 1a · THE THIRD HALF: A CLOSURE DIVERGENCE IS A DISPOSITION TO BE NAMED, NOT A SILENT REFUTATION

**THE RULE ALONE IS PRICED, AND IT IS NOT FREE** (the lane's own join, `py-owner-absent-join.ts`,
on cython — a whole-repo population, the repo's own REAL index):

```
cython: would VERIFY 315 · would REFUTE (extFAIL) 61 · would read UNVERIFIABLE 0
```

**THE 61 ARE NOT A DEFECT IN THE CLAIM. THEY ARE TWO CLOSURES DISAGREEING ABOUT WHETHER A MEMBER
EXISTS.** The gate's `ownerMembers` map is built from the run's SYMBOLS, so it HOLDS a member the
analyzer's own SAME-FILE, SYMBOL-SCOPED closure does not (a class assignment, or a `self.x`
attribute published as a property). The claim says "this member is ABSENT" — the analyzer's closure
says it is; the verifier's map says it is not. **THE ROW IS THEN REFUTED BY A DIFFERENCE BETWEEN THE
PRODUCER'S CLOSURE AND THE VERIFIER'S, AND THAT IS NOT A FALSE CLAIM — IT IS TWO INSTRUMENTS
DISAGREEING.** The lane's analyzer's own comment says exactly this: *"an index-only closure is
refutable by construction (the gate holds a member the index does not)"*.

### 1b · WHAT THE 61 ACTUALLY ARE — MEASURED, AND IT IS A LEAF-NAME COLLISION IN THE GATE'S OWN MAP

**THE LANE MEASURED THE 61's CAUSE with the lane's own join (`py-owner-absent-join.ts`, cython — a
whole-repo population, the repo's own REAL index), and the answer is sharper than "two closures
differ".** The instrument walks the gate's own leaf-keyed inheritance chain and names the KEY that
holds the member, the owner's real ancestors, and every publisher of the member with its file:

```
sample[would-refute]:
  cython/Tools/dataclass_test_data/test_dataclasses.py:2068 calls assertRaisesRegex
      owner=TestFieldNoAnnotation  gate-key=TestCase
      real-ancestors=TestCase,CythonTest,TimedTest
      publishers=TestCase:method@cython/tests/run/test_tstring.py
```

**⇒ THE MECHANISM, IN THE GATE'S OWN TERMS.** The gate's `ownerMembers` map is keyed by the owner
name **AND ITS LEAF**, and the map's inheritance chain is **leaf-keyed** too. So the key
`TestCase` holds the members of **EVERY class named `TestCase` in the repository** — and this
repository has two unrelated ones (`cython/Tools/dataclass_test_data/test_dataclasses.py:26` and
`cython/tests/run/test_tstring.py:18`). **EVERY class whose base's leaf is `TestCase` — i.e. every
`unittest.TestCase` subclass — therefore INHERITS THAT MIXTURE.** The owner
`TestFieldNoAnnotation` really has no member `assertRaisesRegex`; the member belongs to the OTHER
`TestCase` class, in ANOTHER FILE.

**⇒ ⇒ SO THE NAMED CLASS IS NOT "THE CLAIM AND THE MAP DISAGREE". IT IS: *THE GATE'S MAP CONFLATES
TWO UNRELATED CLASSES THAT SHARE A LEAF NAME*.** And that says the MAP is the one that is wrong on
those rows, not the claim — **the claim is TRUE, and the map's answer is a NAME COLLISION.** This
is the Lead's half of the closure question (the map is the Lead's file), and it is the cheapest way
to make the class empty: **key the map by the owner, and resolve a base by the name it is WRITTEN
with, not by its leaf.**

**⇒ AND THE LANE'S OWN ANALYZER HAS THE MIRROR DEFECT, WHICH THE LANE NAMES RATHER THAN HIDES.**
The analyzer's class model records a base by its LEAF (`baseLeaf`), so `unittest.TestCase` is
recorded as the base `TestCase` and then resolved to **the file's own local class named
`TestCase`** — a different class. And because the local-class test comes FIRST in `closureOf`, the
project-level check that would have WITHHELD the claim never runs on that base. **⇒ THE CLAIM'S
ABSENCE PROOF IS UNSOUND IN THE REFUTE DIRECTION ON THOSE ROWS, AND THE LANE'S OWN EMISSION IS THE
MIRROR OF THE GATE'S COLLISION.**

**⇒ ⇒ SO THE TWO HALVES OF (iii) ARE NOT SYMMETRIC, AND THE LANE SAYS SO.** The Lead's (iii) — one
closure for the producer and the verifier — is reachable **ONLY IN THE MAP** if the map stops
leaf-keying: then the gate's closure and the analyzer's file-local closure agree on every row where
the base is not declared in the file, and the class is EMPTY rather than named. **The lane's own
withhold guard would then be a belt-and-braces tightening with a PRICE.** **⇒ ⇒ AND THE LANE's
HALF IS NOW LANDED ✓✓ (commit `d36ff7381` ✓✓), WITH THE PRICE MEASURED ✓✓ — the analyzer keeps a
base's QUALIFIED identity and never resolves a qualified base to a local class of the same leaf
name ✓✓, and the price on cython (a whole-repo population, the repo's own REAL index) is: the claim
set 608 → 307 (−301) · VERIFIED 232 → 142 · REFUTED 0 → 0 · **the proposed rule's extFAIL CLASS
61 → 0 ✓✓ (the class is EMPTY)** · would-verify 315 → 165 · the synthetic-vs-real diff 10 → 10 ✓✓.
⇒ **THE PRICE BUYS THE FAILURE CLASS ✓✓: the claim is withheld while the project declares the
qualified base's LEAF, because the gate's map is keyed by the leaf and so holds a MIXTURE of
unrelated classes under that key ✓✓ — the two closures answer different questions about the same
owner, and a claim that cannot be compared MUST NOT BE made ✓✓.** The probe pins both directions
✓✓ (withheld when the leaf is declared, made when it is not) ✓✓, and the lane will RE-MEASURE the
recovery when the Lead's keying lands ✓✓.** The lane's recommendation stands: the map's fix first ✓✓
(it is what makes the class empty rather than named) ✓✓, and the lane's guard is what keeps the claim
honest until then ✓✓.

**SO THE PROPOSAL IS A RULE PLUS A CLOSURE QUESTION PLUS A DISPOSITION, AND THE LANE PROPOSES ALL
THREE — because a rule that is not free, with a price that is not named, is a rule nobody can
rule on:**

1. **THE RULE** (one line, above): read the claim where the owner channel DECLINED, because a
   declined row has no name-model answer.
2. **THE DISPOSITION FOR THE DIVERGENCE CLASS** — the one the Lead's ruling names: a row where the
   verifier's closure and the producer's closure DISAGREE about the member's existence must be a
   **NAMED** outcome, **NOT a silent refutation counted as `extFAIL`**. **⇒ ⇒ AND THE PRECISE
   READING, WHICH THE LEAD's RULING ON W2's CAUSE REQUIRES ✓✓: THE CLAIM IS **READ** ON THESE ROWS
   ✓✓ (`decls === 0` ✓✓ — the name model has nothing there ✓✓) — it is NOT "unreadable" ✓✓, and it
   is NOT "never read" either ✓✓ ⇒ the verifier's answer about the member's existence is a **NAME
   COLLISION** ✓✓ (the gate's leaf-keyed map holds a MIXTURE under the owner's leaf ✓✓) ⇒ so the
   row belongs in the NAMED class (`ext?`) ✓✓, which is a wall with a name ✓✓, and not in the failure
   column ✓✓. **⇒ ⇒ AND THE TWO CLASSES MUST NOT BE CONFLATED ✓✓ — THEY ARE DIFFERENT ROWS WITH
   DIFFERENT CAUSES ✓✓:**

   | | the arbiter's read condition | the cause | the count (cython) |
   |---|---|---|---|
   | **CLASS A — the owner-declined rows** | `decls > 0` ⇒ the claim is **NEVER READ** ✓✓ | the claim sits on the edge and the arbiter IGNORES it ✓✓ ⇒ the row is exactly as unresolved as it was before the claim existed ✓✓ | **376 NOT READ** ✓✓ (of 608 claims) ✓✓ |
   | **CLASS B — the divergence rows** | `decls === 0` ⇒ the claim **IS READ** ✓✓ | the verifier's closure answers about a MIXTURE, so the claim is read and the answer is a collision ✓✓ | **0 REFUTED · 0 UNVERIFIED ✓✓** (the 61 were a NAME COLLISION, not a false claim ✓✓) |

   **⇒ ⇒ THE LEAD's RULING ON W2's CAUSE IS THE LANE's READING ✓✓: "THE CLAIM IS **NEVER READ** ON
   THE OWNER-DECLINED ROWS" ✓✓, NOT "THE CLAIM IS UNREADABLE" ✓✓ — the difference is not a matter of
   taste ✓✓: an UNREADABLE claim is a claim a verifier cannot answer ✓✓, and a NEVER-READ claim is
   one the verifier never looks at ✓✓, and the arbiter's own code says which ✓✓ (`if (claim … &&
   decls === 0)` ✓✓). ⇒ THE D7's CAUSE IS **REFUTED** ✓✓ AND THE RECORD IS CORRECTED ✓✓.**
   **PRICED ON THE SAME ROWS: 315 would VERIFY, 0 would read UNVERIFIABLE, and the 61 would become a
   NAMED DIVERGENCE CLASS instead of 61 `extFAIL` rows.** The lane is not asking the arbiter to make
   the failures disappear; it is asking that a divergence be reported as a divergence.
3. **THE CLOSURE QUESTION** (the deeper fix, and the one the lane cannot price): the producer and the
   verifier should share ONE closure, so the class is empty rather than named. **THE LANE HAS NOT
   MEASURED HOW THE 61 WOULD SPLIT IF THE TWO CLOSURES WERE UNIFIED, AND THEREFORE ASSERTS NO
   NUMBER FOR IT** — a number the lane has not measured is not a number the lane reports. **⇒ BUT
   THE LANE HAS NOW MEASURED WHAT THE LANE's OWN HALF DOES TO THOSE 61 ✓✓: with the lane's half
   landed, the 61 ARE NO LONGER REFUTABLE AT ALL ✓✓ (the class is 0 ✓✓), because the claim is
   WITHHELD on exactly the owners whose closure the gate's leaf-keyed map mixes ✓✓ — and the COST
   of that is the claim set (−301 on cython ✓✓) ✓✓.**

**WHAT THE LANE ASKS FOR, IN ONE LINE:** the rule, a NAMED disposition for the divergence class
rather than 61 silent refutations, and a ruling on which closure the claim is verified against.

---

## 2 · THE IMPORT-EVIDENCE MAP DOES NOT HOLD AN ALIAS OR A NAMESPACE BINDING

### THE MEASUREMENT

The `importedName` claim is verified by the arbiter from the run's own import evidence
(`incoming-gate.ts`, the `imports` branch): the map is `file -> specifier -> the set of IMPORTED
ITEM names`, and the claim is read when `names.has(claim.name)`.

Two binding shapes the analyzer can prove are NOT in that map:

| shape | the analyzer's binding | the gate's map holds | the claim would read |
|---|---|---|---|
| `from a import b as c` | the ALIAS `c` | the ITEM `b` | **REFUTED** |
| `import a.b` | the module ROOT `a` | nothing (the edge's target is `a.b:*`, and a `*` item is skipped) | **REFUTED** |

Those are two of the shapes in the parked arm's **bindFAIL 361** (`PYTHON-D7-WALLS.md` W3). The lane
has FIXED its half — the analyzer now withholds the claim on both shapes (the binding SHAPE is
recorded per name in `PythonContext.moduleImportBindingShape`, and only the `item` shape is
claimable) — so neither shape can produce a refuted claim again.

**BUT THE ROWS ARE STILL UNVERIFIABLE, AND THEY ARE STILL TRUE CLAIMS.** The lane's rebuild
(`PYTHON-DEPTH-2026-10-20.md` §2) emits the claim on the class the arbiter's project-absolute
refiner leaves unverifiable; the alias and namespace rows of that class are withheld, so they stay
`ext?` — the honest wall — instead of becoming a verified binding.

### THE PROPOSAL (two lines, in the gate)

```ts
// the import-evidence map: add the ALIAS the import binds, and the ROOT a namespace import binds
const alias = (relMdEarly as any)?.importedAs
if (typeof alias === "string" && alias.length > 0) bindSet.add(alias)
// and for a namespace import edge (`a.b:*`), the bound name is the ROOT of the module
```

The analyzer already publishes `metadata.importedAs` on the import edge (the lane's own contract,
`PYTHON-STATE.md` §3's PY-D13), so the first line needs no analyzer change. The second needs the
namespace import edge to publish its bound root — the lane's analyzer can add that (it is the
analyzer's own contract), and the gate then records it.

**WHY IT MATTERS:** the claim is a statement about the FILE'S OWN SCOPE ("this name is the binding
my import introduces"), and both shapes are exactly that statement. The gate's map is the only
place that can check it, and today it cannot check these two shapes — so the rows stay unverifiable
for a reason that has nothing to do with the truth of the claim.

**THE LANE'S HALF IS LANDED AND MEASURED** (the shape guards, the probe's 12 checks). **THE LEAD'S
HALF IS THIS PROPOSAL**, and the lane did not edit the shared gate.

---

## 3 · WHAT THE LANE DID NOT PROPOSE, AND WHY

* **The `importedName` claim's placement in the arbiter's claim order.** `externalClaimOf` reads the
  `importedName` claim BEFORE the generic external marker, so a row carrying both is routed to the
  binding claim. The lane's rebuild makes that harmless (the claim is emitted only where the
  generic marker CANNOT verify), so no ordering change is asked for. **If the Lead later wants the
  claim on the NO-INDEX arm as well**, the gate's own project-absolute test is the right place for
  it — `facts` already carries the admitted file list, and the refiner already computes
  `projectModuleNames(facts)` — and the analyzer's emission would then not need the index gate at
  all. That is a LEAD-SIDE decision about where a project-scope fact is read, and the lane's
  measurement does not depend on it: the lane's claim fires on the INDEXED arm, which is
  PRODUCTION's population for python.
* **The `packageScope` claim.** The python lane does not emit it and does not propose it: the
  charter's §21.42 rollout map puts python at ~80–95 % manifest coverage, and the claim's own
  "never displace a name-model answer" rule is already implemented in the arbiter.
