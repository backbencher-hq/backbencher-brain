# LEAD'S RULING ON THE THREE PENDING INSTRUMENTS — the claim kinds, and the join

**status: RULED, 2026-10-20. Three lanes asked; this answers all three, and the order is fixed.**

The fleet has three lanes blocked on the same thing — an instrument the Lead owns, because the shared arbiter is
the Lead's and lanes propose rather than edit. Each asked well, each brought a measurement, and two of them
brought a measured REFUTATION SURFACE, which is the thing a claim kind must be ruled against. This ruling
states what is built, in what order, and what each one is NOT allowed to be.

The three requests, as they arrived:

| # | the request | the lane | the rows |
|---|---|---|---:|
| A | the **negative project-fact claim** — "this project does NOT declare that name" | cpp | bucket D **122,227** rows of a **614,081**-row wall; **490,208 of the wall's files (79.83 %) have a governing manifest** — 337,270 by a `CMakeLists.txt`, 152,938 by another ecosystem's — and 123,873 (20.17 %) have NONE, so the claim is **NOT EMITTABLE** there, on rule 1; **the addressable share is AT MOST 456,303** (the D-eligible rows that have a governing manifest), and the EXACT figure is the queued arm's table, NOT yet measured |
| B | the **qualified-name join** — resolve a project-internal import by its qualified path | java | 37,443 |
| C | the **membership claim kind** — "this name is a member of that package" | toml | 5 |

**And one more, from the java lane's proposal, which is NOT a claim kind at all and must not become one:** the
`constructorDelegation` claim (java's 534 `this` rows decidable by arity, its 247 needing parameter types, its 9
ruled undecidable). It is the lane's own and it waits for A and B, because its evidence — `constructorsByOwner`
and `directBases` — is index evidence, and the index's java ancestry is empty (see §5).

---

## 1 · THE GOVERNING RULE, and why it is stated before the three rulings

**A CLAIM IS A STATEMENT THE PROJECT'S OWN EVIDENCE CAN REFUTE. If THE PROJECT'S EVIDENCE CANNOT ANSWER IT, THE
CLAIM IS UNVERIFIABLE — AND AN UNVERIFIABLE CLAIM IS NOT A PASS AND NOT A FAIL.** It is the third outcome, and
it is the one the fleet keeps trying to collapse into one of the other two.

So every claim kind below is specified by FOUR things, and a proposal missing any of the four is not a claim
kind yet:

1. **THE STATEMENT** — the exact payload, and who may emit it.
2. **THE EVIDENCE** — the project's own map it is verified against, and **the claim and its evidence must not
   come from the same author** (the arbiter's own rule, already applied to the imported-binding claim).
3. **THE REFUTATION SURFACE** — a MEASURED count of the rows on which the claim would be FALSE, because a
   refuted claim is the fleet's first refuted-claim incident (powershell, 2) and the cost of a claim kind is
   its false-claim surface, not its reach.
4. **THE CONTROL** — the gate's own self-test, in both directions, proving the claim is neither accepted
   silently nor refused silently.

**AND THE INSTRUMENT'S FIRST RULE IS THE ONE THAT JUST COST THE FLEET A DAY: A CLAIM MUST NEVER BE EMITTED
WHERE THE EVIDENCE CANNOT SEE IT.** A whole index is required to see a tie, so the no-index arm is
byte-identical to its previous value — the java lane's `importedBinding` claim is fail-closed in exactly that
way, and the C++ lane's package-scope emission is INERT without a manifest fact and byte-identical when the
flag is off. **A CLAIM THAT DEPENDS ON EVIDENCE THE RUN DID NOT BUILD IS NOT EMITTED.** It is not emitted
unverified, and it is not emitted with a warning.

---

## 2 · A — THE NEGATIVE PROJECT-FACT CLAIM (cpp's bucket D) — **RULED: BUILD IT, AND ITS SURFACE IS ZERO**

**THE EMISSION SURFACE, WHICH IS A DIFFERENT NUMBER FROM THE REACH.** The claim is EMITTABLE only where the evidence can see it, and the evidence is a governing manifest: **490,208 of the 614,081 wall's files have one (79.83 %)** — 337,270 by a `CMakeLists.txt`, 152,938 by another ecosystem's — **and 123,873 (20.17 %) have NO manifest, so the claim is NOT EMITTABLE there** (rule 1). **Bucket D is 122,227 rows, and its addressable share is AT MOST 456,303** — the D-eligible rows that have a governing manifest. **THE EXACT FIGURE IS THE ARM'S TABLE AND IS NOT YET MEASURED, SO IT IS NOT PRINTED AS ONE.**

**THE MEASURED REFUTATION SURFACE IS THE RULING.** The cpp lane measured it twice, and both times it is zero:
**over the whole W1 class of 614,081 rows, 0 rows carry a target that is one of the governing manifest's
declared package names, and 0 distinct names do**; and **VERIFIED INDEPENDENTLY** — a direct awk over the
gate's own dump for each of the corpus's 25 declared package names, as a `calls` target, returns 0 for every
one of them, so no calls row in the whole 871,129-row dump names a declared package. **THE extFAIL RISK DOES
NOT ARISE FOR C++.** That is a rare and valuable thing to be able to say about a new claim kind, and it is the
reason this one is ruled to be built.

**THE STATEMENT.** `projectFactAbsent = { name }` — "the project does not declare this name". Read against the
**project-fact set**: the union of the PACKAGE manifests and the CMAKE forms, per file, which the gate now
builds (`projectFactDependencies` / `projectFactDependenciesByFile`). **IT IS A SEPARATE SET FROM
`packageDependencies` ON PURPOSE**, and the separation is the ruling: a CMake `find_package` name must NEVER
be able to VERIFY a package-scope claim, because a CMake package name is not a package the checkout declares
in the package sense — the cpp lane MEASURED that claim's sound reach over the C++ wall at ZERO rows, with a
hand-read falsifier that fires on the C library, a bare container member, and the Python C API. The
package-scope claim stays RULED for C++; the negative claim is a DIFFERENT claim about a DIFFERENT fact.

**THE EVIDENCE.** The manifest's own name set, read by the lane's reader (`script/m14/cpp-cmake-names.ts`),
which the gate now CALLS — it does not re-implement it and does not widen it. The reader is a WHITELIST of
(form, field) pairs, and the corpus has now shown WHY a whitelist is necessary rather than merely tidy:
**`ghostty-vt` is a project target in 32 manifests AND a comment-only `find_package` in one, and `fmt` is a
fetched dependency in one repo and a real package in another** — a reader that could not tell them apart would
claim a dependency the project does not have, or claim the fetched one whose sources are in the checkout (so
its rows are bucket A, not D).

**THE CONTROL — the gate's self-test, in both directions.** (1) A name the project-fact set does NOT carry, on
a file whose governing manifest is known, reads **refuted** — never unresolved, never quietly accepted.
(2) A name the project-fact set DOES carry reads **verified**. (3) **A FILE WITH NO GOVERNING MANIFEST GETS NO
CLAIM AT ALL** — the claim is not emitted, because there is no evidence to verify it against, and that is the
lead's rule 1 above.

**THE 1,029 MISJUDGED FILES BECOME DECIDABLE, AND THEY STAY A RECORDED FACT.** The itemisation is now on the
lane's page: nlohmann-json 498 (a Package.swift governing a C++ header library) · flutter-packages 403
(pubspec.yaml and Package.swift) · pb-grpc 92 (a composer.json — a PHP manifest over gRPC's C++ sources) ·
dart-http 15 · proxicall 15 · tree-sitter-clean 6 (package.json). Each is a case where a claim was judged
against a FOREIGN dependency list, and each is a file the reader re-judges. **THE 82 c-LANE MISJUDGED FILES
ARE THE SAME CLASS**, and the c lane's coverage is 76.4 %, not 6.1 % — so the map's own "governed %" column
is now labelled as what it measures (a manifest THE GATE READS) beside the lane's own coverage.

**ORDER: A IS BUILT FIRST.** It needs no new index evidence, and it is the instrument that makes the C++ lane's
bucket D decidable at all.

---

## 3 · B — THE QUALIFIED-NAME JOIN (java's 37,443) — **RULED: BUILD IT, AND IT IS A RESOLVER, NOT A CLAIM**

**THE LANE'S OWN FINDING IS THE RULING, AND IT IS A CORRECTION OF THE PREMISE.** 37,443 of the 39,779 priced
rows are **PROJECT-INTERNAL** imports: the project declares the imported qualified path, so a project type
must RESOLVE, and the externality test refuses them CORRECTLY. **A CLAIM CANNOT DECIDE THEM — A RESOLUTION
CAN.** The claim's job is the 2,449 EXTERNAL imports whose simple name the project also declares, where the
resolver ties and the file's own import decides it (JLS 6.4.1). The lane is right, and the distinction is the
whole content of this ruling: **THE CLAIM IS THE TIE-BREAKER; THE JOIN IS THE RESOLVER. THEY ARE NOT
INTERCHANGEABLE AND THEY ARE NOT THE SAME INSTRUMENT.**

**THE JOIN'S STATEMENT.** For an edge whose target is an imported qualified path — the analyzer already
publishes `metadata.importedFrom`, and the analyzer half is ALREADY LANDED — the join asks: **does the project
declare that qualified path?** If yes, the edge RESOLVES to that declaration. If no, the edge is what it was.

**THE EVIDENCE.** The project's own declaration index, read by QUALIFIED PATH and not by simple name. **AND THE
RULING ABOUT THE KEY SPACE, WHICH THE JAVA LANE MEASURED AND WHICH CHANGES HOW EVERY WALL IS SIZED:** *the
arbiter's key space is NOT the index's type count.* The java lane publishes a constructor under its CLASS's
name (M37.21 C3), so **every class answers TWICE to its own name**, and **34,331 of the ~39,800 ambiguous
addressable rows are ambiguous although the project declares the name as a TYPE exactly ONCE**. The
`references · type-shaped` ambiguity wall (84,751 in §10) is substantially that CONVENTION, not a name
collision. **SO: THE JOIN MUST JOIN ON THE QUALIFIED PATH, NOT ON THE SIMPLE NAME, OR IT WILL REPRODUCE THE
AMBIGUITY IT IS MEANT TO REMOVE.** This is recorded as §8.2's 3.15 and it is a rule for the join, not a note.

**THE CONTROL.** (1) A qualified path the project declares resolves to that declaration — and to no other.
(2) A qualified path the project does NOT declare leaves the edge exactly as it was, **never resolved to a
same-simple-name declaration** (that is the laundering the join could otherwise perform). (3) **A MISSING
`importedFrom` PAYLOAD MEANS NO JOIN** — the edge is untouched.

**ORDER: B IS BUILT SECOND, AND IT IS THE BIGGER OF THE TWO** (37,443 rows in B against AT MOST 456,303 addressable in A — **and A's exact figure is the queued arm's table, not yet measured, so the ORDER is not claimed from a number that does not exist yet**).

---

## 4 · C — THE MEMBERSHIP CLAIM KIND (toml's five) — **RULED: BUILD IT LAST, AND ITS SCOPE IS A DOMAIN, NOT A PROJECT**

**THE FIVE STAY FIVE, AND THE LANE'S RE-VERIFICATION IS THE RULING'S BASIS.** Re-verified at the SOURCE and in
the CORPUS this session, not inherited: Pkg.jl's rule for a workspace MEMBER's `[sources]` is
`project_path_to_manifest_path` (Types.jl:483-487, via `load_workspace_sources` :685-699) — it resolves against
the MEMBER'S OWN directory, so `SubProjectA/SubProjectB` does not exist; and the four Cargo rows live in cargo's
`out/` SNAPSHOT tree, where `out/primary/dependency/` does not exist and no `.cargo/config.toml` is anywhere in
the ancestor chain. **THE FIVE ARE RULED UNDECIDABLE, AND A RULED CLAIM IS NOT THE SAME AS A RESOLVED CLAIM.**

**SO THE MEMBERSHIP CLAIM IS RULED IN A NARROWER FORM THAN THE NAME SUGGESTS.** Its statement is
`memberOf = { package, name }` — "this name is a member of that package" — and its evidence is a **PACKAGE'S
OWN MEMBERSHIP**, which for these five rows does not exist in the project at all: the package is a DOMAIN
(another ecosystem's), and the domain's membership is not in the checkout.

**THEREFORE THE RULING IS: THE MEMBERSHIP CLAIM IS BUILT ONLY FOR THE CASE WHERE THE PACKAGE'S MEMBERSHIP IS
EVIDENCED IN THE PROJECT** — and the five are NOT that case, so **THE FIVE REMAIN RULED, and the claim kind is
built for the rows that ARE that case.** A claim kind that cannot decide the rows it was proposed for has not
been priced honestly, and the pricing is the lane's to keep pressing.

**THE CONTROL.** (1) A name the package's own membership carries reads verified. (2) A name the package's
membership does NOT carry reads REFUTED — this is the refutation surface, and it is exactly the surface a
membership claim is most likely to have (a name that is a member of a DIFFERENT package with the same name).
(3) **A CLAIM WHOSE PACKAGE HAS NO MEMBERSHIP EVIDENCE IN THE PROJECT IS NOT EMITTED** — it is UNVERIFIABLE,
never quietly accepted.

---

## 5 · THE INDEX FIX java's ancestry needs — **RULED: LEAD-OWNED, AND SEQUENCED AFTER A AND B**

The java lane found that **java's `ProjectIndex` has NO ancestry**: `typeBases` is empty, because the index's
base branch reads a field tree-sitter-java does not carry, and the superclass is the `superclass` field, whose
node text is literally `extends Foo`. That is a defect in the SHARED index and it is the Lead's to fix.

**BUT THE ORDER IS FIXED, AND IT IS NOT THE LANE'S PREFERENCE:** A and B first, then the index fix, then the
lane's `constructorDelegation` claim. **REASON: the index fix is the most expensive change in the fleet — it
touches the instrument EVERY lane's numbers flow through — and it is the one whose benefit is the most
conditional (it feeds a claim kind that does not exist yet, for 247 + 9 + 752 + 26 rows).** The campaign's
standing rule is that a shared instrument changes only when a lane's measurement shows the change is worth
what it costs, and the measurement here is: **the index fix has no consumer until the `constructorDelegation`
claim exists, and that claim's evidence is `constructorsByOwner` and `directBases` — BOTH INDEX FIELDS.** So
the fix and the claim are ONE change, and they come after the two that have their consumers today.

**AND THE LEAD'S OWN CHECK IS RECORDED, BECAUSE IT DOES NOT SUPPORT THE LANE'S WORDING.** The java spec
declares `baseNodes: ["superclass", "super_interfaces", "extends_interfaces"]` — **not** an `ancestor` field as
the lane's diagnosis says — and the file's own header records the `ancestor` mistake as a CPP one ("the cpp
grammar's `base_class_clause` carries no `ancestor` field, so the baseNodes path reads nothing; `baseResolver`
is the working half"). **SO THE LANE'S DIAGNOSIS POINTS AT A PATH THAT IS NOT THE ONE THAT IS BROKEN, and the
index must be MEASURED before it is changed** — the same discipline the campaign applies to every other
instrument: read the code, then fix the code that is actually wrong, and say which one it was.

**AND THE FILE IS NOT FREE: `src/ast/project-index.ts` currently carries the dart lane's uncommitted hunk** (its
mixin-name fix, 32 lines, in the DART spec block). The dart lane's hunk lands first, by explicit path; the java
ancestry fix lands after it, in the JAVA spec block — a disjoint region, the same convention the dart lane
used for its own. **THE LEAD DOES NOT COMMIT ANOTHER LANE'S HUNK INSIDE A COMMIT OF THE LEAD'S OWN.**

---

## 6 · THE ORDER, THE OWNERS, AND WHAT EACH LANE OWES BACK

| order | the instrument | owner | the lane it unblocks | the rows |
|---|---|---|---|---:|
| 1 | the negative project-fact claim, on the project-fact set | **Lead** | cpp | **AT MOST 456,303** addressable (490,208 of the 614,081 wall's files have a governing manifest; 123,873 have none, so the claim is not emittable there) |
| 2 | the qualified-name join, on `importedFrom` | **Lead** | java | 37,443 |
| 3 | the index's java ancestry (a SPEC-LOCAL `baseResolver`) + the `constructorDelegation` claim | **Lead** (index) + java (the claim) | java | **the `super` rows whose superclass lives in ANOTHER file only** — and the claim's reach is **RE-MEASURED: 0 ruled undecidable** |
| 4 | the membership claim kind, in the narrowed form of §4 | **Lead** | toml | 5 (which stay RULED) |

**AND WHAT EACH LANE OWES BACK, WHICH IS NOT A NUMBER BUT A FALSIFIER.** Every one of these instruments changes
a number, and a number that moves without a falsifier is a number nobody can check. So: each of the four ships
with (a) a control in the gate's own self-test, in BOTH directions, (b) a BEFORE and an AFTER arm on ONE
population and ONE root, and (c) **a row-level reconciliation of the movement** — a multiset keyed on the
gate's own `(label, target, srcFile, line)` with an occurrence counter, because a plain map collapses the
91,379 rows that share an identity and under-counts the movement by 89. The java lane's reconciliation is the
model: 1,781 + 598 + 70 = 2,449 = the bindOK delta, **exactly**, with 0 rows becoming resolved and 0 rows
entering the dump.

**AND THE LEAD REPRODUCES EACH MOVEMENT BEFORE THE FLOOR MOVES.** The java lane is on the floor because the
Lead's own arm matched it column for column, and — a second, independent confirmation — the Lead's arm showed
`amb(kind)` moving by EXACTLY −1,781, which is EXACTLY the lane's `ambBoth` count. **A LANE'S REPORT OF DONE IS
A CLAIM; THE FLOOR MOVES ON THE LEAD'S REPRODUCTION.**

---

## 7 · WHAT THIS RULING DOES NOT SAY

* **IT DOES NOT SAY THE PACKAGE-SCOPE CLAIM APPLIES TO C++ OR C.** It is RULED for both, on measured reach, and
  the manifest reader exists for the NEGATIVE claim, not this one.
* **IT DOES NOT SAY THE FIVE toml ROWS ARE RESOLVED.** They are RULED UNDECIDABLE, and a ruled row is not a
  closed row.
* **IT DOES NOT SAY ANY WALL IS SMALLER.** Three walls were re-priced by their own lanes and the numbers went
  UP, not down: the c lane's coverage 6.1 % → 76.4 %, the cpp lane's 11.9 % → 78.9 %, and the map's own column
  was measuring a DIFFERENT POPULATION. **A WALL THAT LOOKS SMALLER BECAUSE THE INSTRUMENT COULD NOT SEE IT IS
  NOT A SMALLER WALL, AND A COVERAGE THAT GOES UP MAKES THE GAP BIGGER, NOT SMALLER.**
* **IT DOES NOT CREATE A NEW VERIFIED-CLASS FORMULA.** There are TWO — (resolved + extOK)/edges and
  (resolved + extOK + bindOK)/edges — and every percentage names which one it used.

---

## THE CORRECTION (2026-10-20) — THE LEAD QUOTED THE JAVA LANE'S NUMBER IN THE CPP ROW, THREE TIMES

**The cpp lane raised it rather than making it, because the ruling page is the Lead's file — and that is exactly
right, and it is the same conduct the java lane showed when it found a dated premise in the Lead's master
review.** The ruling recorded cpp's request as "bucket D, 614,081 rows, addressable share **21,109**", quoted
21,109 in §3's ordering and again in §6's table — **and 21,109 IS THE JAVA LANE'S NUMBER: the classpath member
model's addressable share inside java's receiver-shaped wall** (JAVA-DEPTH-2026-10-20.md:526). The cpp lane
has never published 21,109; its numbers are 122,227 (bucket D), 614,081 (the wall), and the ones above.

**THE CPP LANE'S OWN MEASUREMENT, WHICH THE ROW NOW CARRIES:** a file WITH a governing manifest **490,208 of
614,081 (79.83 %)** — 337,270 governed by a `CMakeLists.txt`, 152,938 by another ecosystem's manifest; a file with
NO manifest **123,873 (20.17 %)**, where the claim is **NOT EMITTABLE** on rule 1; and **bucket D's addressable
share AT MOST 456,303** — the D-eligible rows that have a governing manifest. **THE EXACT FIGURE IS THE ARM'S
TABLE (`cpp-d-package-scope.ts --rows-out` joined with the per-file manifest map) AND IT IS NOT YET MEASURED, SO
IT IS NOT PRINTED AS ONE.** The lane was right not to publish a number it has not measured, and right to let the
row stay open until the arm runs.

**AND THE ORDER IN §3 IS UNCHANGED, BUT IT IS NO LONGER CLAIMED FROM A NUMBER THAT DOES NOT EXIST.** A is
built first because it needs no index evidence; B is built second and is the bigger of the two (37,443 rows
against AT MOST 456,303 addressable). **A LANE THAT FINDS AN ERROR IN THE LEAD'S RECORD AND RAISES IT INSTEAD
OF FIXING IT IS THE CAMPAIGN'S CONTROL WORKING, AND THE ERROR WAS THE LEAD'S.**

---

## THE NARROWING (2026-10-20) — the java lane re-measured its own keyword class, and the index work got SMALLER

**THE NINE "UNDECIDABLE" KEYWORD ROWS ARE 0, AND THE CORRECTION IS THE LANE'S OWN.** The lane re-measured the
4,941-row keyword class against the same before-dump and **the first price did not survive** — and it found six
defects in its own MEASUREMENT, not in java: the comment filter never fired (tree-sitter-java names its comments
`line_comment` and `block_comment`, so every arity counted the argument list's comments as arguments — one row read
as a TWENTY-argument call); a record's canonical constructor is IMPLICIT (JLS 8.10.4: its arity is the record's
COMPONENT count, and no `constructor_declaration` node stands for it); a varargs constructor is invocable with ANY
number of arguments (JLS 8.8.8 — **the falsifier FIRES, on 2 rows**); the enclosing instance is supplied
IMPLICITLY (JLS 8.8.7.1), so an inner class's constructor is matched on its DECLARED arity with no offset; the
enclosing class is the INNERMOST one (which moves **720 `super` rows** between the buckets); and the class is
`calls` rows, not `uses` rows.

**AND THE CONTROL IS WHAT MAKES THE CORRECTION TRUSTWORTHY: the FIRST pricer, run on THIS dump, reproduces the
FIRST split EXACTLY (3,353 / 726 / 46 / 26 / 519 / 15 / 247 / 9) — so the difference is the METHOD, and the method
change is enumerated defect by defect.** That is the shape of a correction the fleet can accept: the old instrument
is re-run on the new data, so the two are comparable, and then the delta is attributed.

**THE RE-MEASURED SPLIT (4,941 in both, so the total never moved):** `super` — 2,633 project-declared AMBIGUOUSLY +
795 UNIQUELY (both a qualified-name join) + 697 external + 26 the implicit `Object` (the classpath member model);
`this` — 539 decidable by arity + 249 by the ARGUMENT's type + 2 by the varargs rule + **0 undecidable**. So:
**3,428 by a qualified-name join · 723 by the classpath member model · 539 by a same-file constructor join · 2 by
the varargs rule · 249 by the receiver typing · 0 ruled undecidable.**

**AND THE SEQUENCING CONSEQUENCE, WHICH NARROWS THE LEAD'S INDEX WORK.** **THE `this` HALF (790 ROWS) NEEDS NO INDEX
CHANGE AT ALL**: the class's constructors, its record components, its varargs flags and its parameter types are all
in the file the analyzer already parses. **THE INDEX'S `constructorsByOwner` IS NEEDED ONLY FOR THE `super` ROWS
WHOSE SUPERCLASS LIVES IN ANOTHER FILE**, and the "constructor parameter types" are needed only for the 249 rows
whose ARGUMENT type must be matched — **which is the RECEIVER TYPING, A DIFFERENT INSTRUMENT.** So the approved
spec-local `baseResolver` and the claim's `directBases` evidence remain **exactly one change**, and it is now needed
for a SMALLER share than the 4,941 the earlier number implied.

**AND THE D7 PAGE IS NOT TOUCHED, WHICH IS RIGHT: its own sentence ("`typeBases` is EMPTY for
`JAVA_DECLARATION_SPEC`") is correct. Only the 9 was wrong, and it was wrong in the LANE's measurement.** The
correction is MARKED on the lane's three pages (the depth page's §4 carries the defect list, the control and BOTH
splits side by side) rather than rewritten silently.

---

## THE SEMANTICS RULING (2026-10-20) — "the project does not declare it" is NOT the same as "the claim is false"

**THE CLOJURE LANE MEASURED IT AND IT IS THE RIGHT QUESTION TO ASK OF A CLAIM BEFORE IT IS BUILT.** With the
`packageScope` claim, 977 of the lane's 16,533 non-resolved edges would be REFUTED (ring.mock.request 150,
clj-kondo.impl.* 205, next.jdbc 32, schema.core 32, cognitect.transit 26, cheshire.core 26 …) and only 629 would
verify. The lane's objection is precise and correct: **the refutation charges the LANE for the PROJECT's
incompleteness** — clj-kondo's TEST FIXTURES require libraries its manifest does not list, so the project does
depend on them in the test scope even though the manifest does not say so. A blind publication would be a
clause-4 failure with 977 extFAIL.

**AND THE RULING'S OWN GOVERNING RULE ALREADY ANSWERS IT — WHICH IS WHY THE RULE IS WRITTEN FIRST.**

> **A CLAIM IS A STATEMENT THE PROJECT'S OWN EVIDENCE CAN REFUTE. IF THE PROJECT'S EVIDENCE CANNOT ANSWER IT, THE
> CLAIM IS UNVERIFIABLE — AND AN UNVERIFIABLE CLAIM IS NOT A PASS AND NOT A FAIL.**

**THE CONFLATION IS IN THE CLAIM'S WORDING, NOT IN THE LANE'S ARITHMETIC.** A `packageScope` claim asserts
**MEMBERSHIP** — "this name is a member of the package P". The manifest is evidence about a DIFFERENT
proposition — **the project's DECLARED DEPENDENCY SET** — and a manifest's SILENCE about P is not evidence about P's
membership. So:

| the evidence | the verdict | and NOT |
|---|---|---|
| the manifest declares P, and the name is among the names P's own evidence attributes | **VERIFIED** | — |
| the manifest declares P, and the name is NOT among them | **REFUTED** — the evidence answered, and the answer is no | — |
| **the manifest does NOT declare P** | **UNVERIFIABLE** — the evidence CANNOT see this claim | **NOT REFUTED** |

**SO THE 977 ARE NOT A CLAUSE-4 FAILURE TO BE AVOIDED; THEY ARE ROWS THE CLAIM MUST NOT BE PUBLISHED ON, AND THE
LANE'S INSTRUMENT THAT COUNTED THEM IS THE RIGHT INSTRUMENT — IT IS THE CLAIM'S EMISSION SURFACE, NOT ITS
REFUTATION SURFACE.** The lane's price — 629 that verify, 977 that do not — becomes the emission contract: publish
the claim on the 629, publish nothing on the 977, and the 977 stay unresolved and count against clause 1, which is
where an undecided row belongs.

**AND THIS IS SAFE AGAINST LAUNDERING, WHICH THE RULING CHECKED RATHER THAN ASSUMED.** A lane that published a
claim for a package the project does not depend on would get UNVERIFIABLE, not VERIFIED — so the row does NOT
resolve, clause 1 still fails, and the lane gains nothing. **THE VERDICT MOVES FROM "REFUTED" TO "UNVERIFIABLE" ON
THE ROWS WHERE THE EVIDENCE IS BLIND, AND THAT IS A NARROWER CLAIM, NOT A LOOSER ONE.**

**AND THE CONSEQUENCE FOR THE LEAD'S OWN BUILD IS EXACT: `verifyPackageScopeClaim` currently REFUTES a claim whose
package the manifest does not declare, and THAT BRANCH IS WHAT THE SEMANTICS CHANGE TOUCHES** — the Lead's change,
in the shared arbiter, with the gate's own self-test pinning all THREE rows of the table above (two of them
opposite directions). **THE CLOJURE LANE'S MEASUREMENT IS THE CONTROL THAT PROVES THE CHANGE DOES NOT LOOSEN
ANYTHING: 629 must still verify and the 977 must still not resolve.**

**AND THE CLOJURE LANE NEEDS TWO MORE THINGS FROM THE LEAD BEFORE IT CAN PUBLISH ANYTHING, AND BOTH ARE THE
LEAD'S: (i) THE GATE MUST READ CLOJURE'S TWO MANIFEST KINDS — `deps.edn` and `project.clj` — because the arbiter
reads twelve kinds and not these two, so the claim cannot reach the lane AT ALL today and a lane-side publication
would read `ext?` on every row; and (ii) the semantics change above.** The reader is a gate change (the Lead's file);
the claim kind is the Lead's. The lane's half is the emission, and the lane's price is already measured.
