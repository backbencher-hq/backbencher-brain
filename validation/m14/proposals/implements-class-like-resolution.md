# PROPOSAL — `implements` rows: resolve the CLASS among the key's declarations

**Status:** **TAKEN 2026-10-29.** Implemented in the shared classifier
(`script/m14/incoming-gate.ts` — `implementsClassLike`/`classLikeStatus`; `script/m14/incoming-rule.ts`
— the `classLike` branch), with the analyzer untouched. Measured on the live arm, whole population:
**284 rows resolved, exactly the price** — `implements` 417 → **701** resolved, ambiguous 333 → **49**;
overall resolved 21,791 → **22,075**, ambiguous 1,360 → **1,076**, every other column identical
(`extFAIL` still 0). The rule prints its own count on every arm (`implements class-like resolution: N`).

## What the rows are

`clean icl,dcl --binding-collapse`: `implements` **306 resolved · 333 ambiguous · 15 unresolved**.
The 333 ambiguous rows are not a name-model wall. An `implements` row's target is a **CLASS**, and a
class is the one entity in Clean whose name is guaranteed to collide with its own members: every
`instance == Bool` publishes a member `Bool.==`, so the key `==` answers 37 MEMBER declarations
beside the class. The class itself is published under the DECLARATION's spelling, which for an
operator is parenthesised (`class (==) infix 4`), while the instance writes it bare
(`instance == Bool`).

The analyzer is right on both ends and must stay that way: `implements -> ==` is what the SOURCE
writes in that position, and `(==)` is what the source writes in the declaration. What is missing is
a classifier rule that knows the row's LABEL.

## The measurement (instrument: `validation/m14/fixtures/clean/implements-class-spelling.mts`)

Input: the arm's own `--dump` for `implements` (352 rows) + the project's own symbols, read through
`parseFile` over `git ls-files` — the same arithmetic the differential uses.

| bucket | rows |
| --- | --- |
| **decided by the PARENTHESISED spelling** — `(T)` is declared class-like and collapses to one | **153** |
| **decided by the BARE spelling** — `T` is declared class-like and collapses to one | **131** |
| no class-like under either spelling — **47** in another project of the corpus, **2** declared nowhere (`JSONEncode`/`JSONDecode`) | **49** |
| class-like declarations under either spelling that do NOT collapse to one | **0** |
| total ambiguous | **333** |

The 131 was the surprise, and it is what makes this different from the analyzer-side rewrite the
declaration already declined: `~` is declared BARE (`class ~ a ::`), and every non-operator class
(`toString`, `fromString`, `zero`, `abs`, …) shares its spelling with its members. A rule that tried
only the parenthesised spelling would leave those ambiguous; trying BOTH spellings decides them.

The 49 remaining are honest, and the split was MEASURED rather than assumed: **47** name a class
declared in ANOTHER project of the corpus (Clyde's `instance == Processor` names `StdOverloaded`'s
class, declared in `clean-stdlib`), and **2** — `JSONEncode` and `JSONDecode` in eastwood's
`SemVer.dcl:38-39` — are declared NOWHERE in the corpus. No project-local evidence can bind either
kind, and none should be invented.

## The rule

In the classifier's AMBIGUOUS branch, for a row whose label is `implements` (a conformance row —
its target is a class by construction), before the row is declared ambiguous:

1. Take the key's declarations whose kind is **class-like** (`class`, `interface`, `generic`,
   `trait`, `protocol`; NOT `method`/`function`/`variable`, which are the members).
2. If that subset is non-empty and the gate's own **binding collapse** makes it ONE declaration
   (every one carries the same non-empty `qualifiedName` that differs from the key), resolve to it.
3. Otherwise, when the target is an operator spelling (no letter, digit, `_`, `'`, `.`, `:` — the
   predicate the analyzer uses for the same decision), repeat 1–2 for the key `(target)`.

Nothing else changes: a key with two class-like entities in different modules still answers two,
a single class declaration without a qualification still does not collapse, and no row moves from
ambiguous to unresolved (the failure mode of the analyzer-side rewrite, which the declaration
declined for exactly that reason).

## Why the analyzer cannot do it

A per-file analyzer does not know whether `(T)` is declared in the project. The `~` counterexample is
decisive: `~` is declared BARE, so a per-file rule that parenthesises every operator target would
turn 7 currently-decidable rows into unresolved ones. The spelling is a PROJECT fact, and the
classifier is the first place in the pipeline that has the project.

## Effect, if taken

| clean, whole population | now | with the rule |
| --- | --- | --- |
| `implements` resolved | 306 | **590** |
| `implements` ambiguous | 333 | **49** |
| `implements` unresolved | 15 | 15 |
| resolved (all labels) | 21,791 | **22,075** |
| ambiguous (all labels) | 1,360 | **1,076** |

The lane's verdict does not change: clause 1 stays red, because 2,142 rows name declarations that
exist nowhere in this corpus. This is 284 real rows closed with real evidence, not a label move.

## Result after landing (measured, same arm)

| clean, whole population | before | after |
| --- | --- | --- |
| `implements` resolved | 417 | **701** |
| `implements` ambiguous | 333 | **49** |
| resolved (all labels) | 21,791 | **22,075** |
| ambiguous (all labels) | 1,360 | **1,076** |
| open column | 3,871 | **3,587** |
| `extFAIL` / `ext?` | 0 / 0 | 0 / 0 |

The cause census over the new dump closes exactly: 3,587 rows = 590 module-halves + 181 module-level
collisions + 132 class-name-is-its-member + 95 module-name-as-a-type + 78 instance-members-without-the
class + 222 imports on a search path + 110 module-in-another-project + 37 symbol-in-another-project +
2,142 declared-nowhere. The two buckets the rule touched are `class-name-is-its-members-name`
(313 → 132) and `instance-members-without-the-class` (181 → 78).

## Guard for the Lead

The rule is generic, so other lanes' `implements` rows can move too — only where the class-like
subset collapses to one, which is the same evidence standard the gate already applies to dcl/icl
twins. Suggested check before accepting: run every lane's arm and confirm no row changes except
`implements → resolved`, and that no lane's `resolved` DECREASES.
