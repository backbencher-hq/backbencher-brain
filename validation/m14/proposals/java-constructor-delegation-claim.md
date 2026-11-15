# PROPOSAL (java) — a `constructorDelegation` claim for the keyword structural class, because a keyword names no declaration and a constructor is not a name

**From:** java lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/incoming-rule.ts` (a new claim kind) and `src/ast/project-index.ts` (the
java spec's ancestry) — **neither is this lane's write scope.** The lane's half (the emission, the
fixtures, the evidence) is delivered in `validation/m14/verification/JAVA-DEPTH-2026-10-20.md` §4.

> **CORRECTION, 2026-10-20, AFTER THE LEAD'S REVIEW — the SYMPTOM WAS RIGHT AND THE MECHANISM WAS
> NOT.** The first version of §2 below said java's empty `typeBases` was because "the index's base
> branch reads an `ancestor` field tree-sitter-java does not have" — a story that belongs to another
> lane's grammar. **THE INDEX WAS THEN MEASURED, and the measurement says java is in the OPPOSITE
> situation: java DECLARES `baseNodes` (so it ENTERS the baseNodes path) and has NO `baseResolver`
> (so nothing takes over), while cpp declares NO `baseNodes` and HAS a `baseResolver`.** The fix is
> therefore SPEC-LOCAL — a `baseResolver` on the java spec, modelled on cpp's — and the corrected
> text, the measurement and the falsifier are in §2. **The D7 page's own sentence ("`typeBases` is
> EMPTY for `JAVA_DECLARATION_SPEC`") is CORRECT and needs no change; only this lane's mechanism
> story did.**

## WHAT WAS MEASURED

**THE CLASS.** 4,941 `calls` rows whose target is the KEYWORD `super` or `this` — the G2 explicit
constructor invocation (JLS 8.8.7.1). Measured on the lane's recorded population (farm root, 11,155
files, 20 repo indexes, `bun run script/m14/incoming-gate.ts java java 0 --index`): **4,151 `super` +
790 `this`, all 4,941 `unresolved`** (the arbiter's `ext?`/`amb` columns read 0 for them: a keyword
names nothing, so the name model has no answer and no claim covers it).

**WHAT THE FILE STATES — and this is the whole point.** JLS 8.8.7.1: an explicit constructor
invocation in a constructor body of a class C begins an invocation of

* **a constructor of C's DIRECT SUPERCLASS** — and the file states the direct superclass in its
  `extends` clause; and
* **another constructor of the SAME CLASS** — and a constructor is declared in the class's own body
  (JLS 8.8), so the file states that too, together with the invocation's ARITY.

**So the target is not a keyword: it is a constructor of a class the file names.** The D7 page ruled
the class as a whole "RULED UNDECIDABLE — a keyword names no declaration and is not external". **That
ruling is too coarse and this proposal replaces it with the priced split** (all figures from
`JAVA-DEPTH-2026-10-20.md` §4, read off the same dump):

> **THE SPLIT WAS RE-MEASURED ON 2026-10-20 AND THE FIRST SPLIT WAS WRONG — THE SIX DEFECTS ARE
> ENUMERATED IN THE DEPTH PAGE'S §4, AND THE CONTROL IS THAT THE FIRST PRICER, RUN ON THIS DUMP,
> REPRODUCES THE FIRST SPLIT EXACTLY.** The result that matters: **THE 9 "UNDECIDABLE" ROWS ARE 0,
> AND THE `this` HALF NEEDS NO INDEX CHANGE AT ALL.**

| sub-class | rows | what decides it |
|---|---:|---|
| `super` → the project declares the direct superclass AMBIGUOUSLY (the key space ties) | **2,633** | a **qualified-name join** on the superclass's declaration + a constructor join |
| `super` → the project declares the direct superclass UNIQUELY | **795** | the same join — the key space already answers, and the join only has to agree with it |
| `super` → the superclass is OUTSIDE the project (the `extends` edge reads `externalVerified`) | **697** | the **external classpath member model** (a JDK/library constructor table) |
| `super` → the file names NO superclass (the implicit `Object` super()) | **26** | the same classpath model, `java.lang.Object` |
| `this` → EXACTLY ONE constructor of that arity | **539** | a **same-file constructor join** — the analyzer already knows the class's constructors and the invocation's arity |
| `this` → SEVERAL constructors of that arity | **249** | the **argument's** type (the receiver typing) — the **parameter** types are already in the file |
| `this` → A VARARGS constructor covers that arity (JLS 8.8.8) | **2** | **the falsifier firing** — a varargs constructor is invoked with any number of arguments |
| `this` → NO constructor of that arity | **0** | **NOTHING IS LEFT — the file's own evidence decides every row** |
| **total** | **4,941** | |

**THE ADDRESSABLE SHARE IS 3,967 ROWS** (2,633 + 795 + 539): every one of them is decidable with
facts the PROJECT already has or could have, and none of them needs the classpath model. **AND THE
`this` HALF (790 rows) IS DECIDABLE FROM THE FILE ALONE** — the class's constructors, its record
components (JLS 8.10.4), its varargs flags (JLS 8.8.8) and its parameter types are all in the file
the analyzer already parses ✓ — **so the index's `constructorsByOwner` is needed ONLY for the `super`
rows whose superclass lives in ANOTHER file, and the "constructor parameter types" are needed ONLY
for the 249 rows whose ARGUMENT type must be matched, which is the receiver typing — a different
instrument.**

## THE ASK (three things, all Lead-owned)

### 1 · THE CLAIM KIND — `constructorDelegation`

```
| { kind: "constructorDelegation"; owner: string; kind: "super" | "this"; arity: number }
```

**THE STATEMENT IT MAKES:** "this edge is a constructor invocation; for `this` it is a constructor of
`owner` with `arity` parameters; for `super` it is a constructor of `owner`'s DIRECT SUPERCLASS with
`arity` parameters."

**THE FOUR PROPERTIES THE ARBITER'S OTHER CLAIMS HOLD TO, AND HOW THIS ONE HOLDS THEM:**

1. **It is the SOLE AUTHORITY for its edges** (like `importedBinding`): a claimed row leaves the
   column the name model gave it, and the claim lands in its OWN column — never in `resolved`.
2. **It NEVER DISPLACES A DECLARATION ANSWER.** A constructor delegation names no NAME, so there is
   no name for the key space to answer; the claim can only speak for a row that the name model has
   nothing to say about. The arbiter must therefore refuse the claim when the row's target IS a
   name the key space answers.
3. **IT IS REFUTABLE BY CONSTRUCTION.** The project's own facts decide it: if the owner declares NO
   constructor of that arity, the claim is REFUTED (`extFAIL`-class, counted against the lane). If
   the owner declares SEVERAL constructors of that arity, the claim is UNVERIFIABLE (a tie), never
   quietly accepted.
4. **IT IS CROSS-TABBED.** A claim on an ambiguous edge records its disposition, like every other
   claim kind in the arbiter.

**THE VERIFICATION EVIDENCE THE ARBITER WOULD NEED** (the `ProjectFacts` shape, the same channel the
`ownerMemberAbsent` claim reads):

* `constructorsByOwner: Map<string, Set<number>>` — owner → the ARITIES of the constructors it
  declares (the arity is what the delegation states, and it is what discriminates an overload set);
* `directBases: Map<string, string>` — owner → the simple name of its DIRECT SUPERCLASS.

**AND THE LANE'S HALF IS READY:** the analyzer already publishes the class's constructor set and the
invocation's arity, and it already emits the `extends` edge that names the direct superclass. The
emission the arbiter would read is `metadata.constructorDelegation = { owner, kind, arity }` on the
`super(...)` / `this(...)` edge — one line, in the analyzer, in this lane's write scope, ready the
moment the kind exists.

### 2 · THE PROJECT INDEX MUST CARRY JAVA'S ANCESTRY — MEASURED, NOT ASSERTED

**THE MEASUREMENT (2026-10-20, this lane, on the farm corpus):** java's `ProjectIndex` has **NO
ancestry** — `typeBases` is **0** over clojure (190 files, 9,132 `typeKinds`) and grails-core (1,942
files, 37,759 `typeKinds`). And the reason is **NOT** the one this proposal first wrote down, so
here is the measurement that replaces it:

| the question | the measured answer |
|---|---|
| `JAVA_DECLARATION_SPEC.baseNodes` | `["superclass", "super_interfaces", "extends_interfaces"]` — node **TYPES**, not a field |
| `JAVA_DECLARATION_SPEC.baseResolver` | **undefined** — java has **no working half** |
| `CPP_DECLARATION_SPEC.baseNodes` | **undefined** — cpp never enters the baseNodes path at all |
| `CPP_DECLARATION_SPEC.baseResolver` | a **function** — cpp's working half |
| the `superclass` node's children | `extends` (keyword), `type_identifier` — **the base is a bare CHILD, with no field name** |
| the `super_interfaces` / `extends_interfaces` node's children | `extends`/`implements` (keyword), `type_list` — the bases are the `type_list`'s identifiers |
| `childForFieldName("ancestor")` on those nodes | **ABSENT** |

**SO JAVA IS IN THE OPPOSITE SITUATION FROM CPP, AND THAT IS THE WHOLE DIAGNOSIS.** The shared base
branch is entered when a node's TYPE is in `baseNodes`, and it then looks for the base in the node's
`ancestor` **field**. **cpp** declares no `baseNodes` — so it never enters that path, and its
`baseResolver` does the work. **java** DOES declare `baseNodes` — so it **enters** the path, once per
superclass node and once per interface-list node, and the path **reads nothing**, because
tree-sitter-java carries the base as an unlabelled `type_identifier` child under a bare `extends`
keyword. **AND JAVA HAS NO `baseResolver` TO TAKE OVER** — so nothing else does the work, and
`typeBases` is empty. **The symptom was right; the story behind it belonged to another lane, and the
measurement is what settles it.**

**THE FIX — SPEC-LOCAL, AND THEREFORE IT CANNOT MOVE ANOTHER LANE'S NUMBER.** Give the java spec a
`baseResolver`, modelled on cpp's, in the **JAVA spec block** of `src/ast/project-index.ts` — a
region disjoint from the dart lane's uncommitted mixin hunk, so the two do not collide and the Lead
does not commit another lane's hunk inside a commit of the Lead's own. The alternative — teaching the
SHARED base branch to read a node's children when the node carries no `ancestor` field — would change
the instrument every lane's numbers flow through, and is the Lead's alone to make; **the spec-local
`baseResolver` is the same fix with a smaller blast radius, and it is the one this proposal asks for.**

**THE MEASUREMENT THE FIX OWES, BEFORE AND AFTER (the index is measured before it is changed):**

* **BEFORE:** java `typeBases` = **0** (clojure 190 files, grails-core 1,942 files) — the number
  above, and it is in this proposal so the AFTER can be compared against a stated baseline.
* **AFTER:** java `typeBases` **non-empty**, and every recorded base **CORRECT**: the **DIRECT**
  base, never a transitive one; a class with no `extends` clause records **no** base (java's
  implicit `java.lang.Object` is not a base the project declares); an interface list records each
  listed interface, and a type that extends and implements both records both.
* **THE CONTROL / FALSIFIER:** **the OTHER languages' `typeBases` counts must be byte-identical
  before and after.** That is what proves the fix is spec-local, and it is the same discipline every
  instrument in this campaign owes: a control in the gate's own self-test, in BOTH directions.

**WHY IT MATTERS BEYOND THIS CLASS:** the same empty `typeBases` is why the receiver-typing channel
cannot answer a `super.m()` whose parent lives in another file, and it is one of the six Lead-owned
instruments the lane re-sized (the package-space and classpath rows of §3 of the depth page).

### 3 · THE EXTERNAL CLASSPATH MEMBER MODEL — ALREADY PRICED, STILL LEAD-OWNED

The 752 `super` rows whose superclass is outside the project need a JDK/library **constructor**
table, not a member table: the same instrument as the 90,004-row classpath class, with constructors
in it. The lane's price is on `JAVA-DEPTH-2026-10-20.md` §3 (C5), with the receiver-shape read:
the classpath model's addressable share inside the receiver-shaped wall is 21,109 rows, and the
LARGEST class of that wall (47,279 rows) is one a classpath model does NOT reach, because the file
states no type at all.

## WHAT THE LANE WILL NOT DO

* **The lane will not change the edge's TARGET SPELLING.** `super` and `this` are the published
  spelling, pinned by the `java/ctor-delegation` fixture, and mirrored by the differential oracle.
* **The lane will not invent the claim kind.** The arbiter is the Lead's; this proposal is the
  lane's ask, with the statement spelled out and the evidence it would be verified against.
* **The lane will not claim the 247 rows that need the parameter types** until the index carries
  them: an arity is a discriminator, a parameter list is a signature, and a signature the index does
  not have is a fact the lane must not invent.
