**CLOSED — the ruling is implemented, measured at full extent, and pinned in both directions.**

## What was wrong

The probe in the body stands: `class D { int foo() { return 1; } int foo() { return 2; } }` published ONE `foo` symbol with the FIRST body, and the later declaration was silently dropped — the #745 wrong-body class, one lane of the family matrix.

## The ruling

**Last declaration wins** (the family rule: js pinned last, python #748 both). Implemented as one shared `registerCallable` path rather than a second dedup:

- member scope keys on `(kind, name)`; `seenMembers` changed from `Set<string>` to `Map<string, number>` (dedupKey → symbol index), so the later declaration **replaces the earlier one in place** — same identity, later body/parameters/line — instead of being dropped, and returns `false` so the caller skips its own scope push;
- program scope keys on `module:${name}:${accessorKind}`, so a getter/setter pair stays TWO symbols while a true duplicate collapses.

## What the shape actually costs in the corpus (measured before the ruling)

A full-extent census over the lane's 2,547 corpus files, so the ruling is not a guess about blast radius:

| shape | count | verdict |
|---|---|---|
| member-scope "duplicates" | **5** | every one a census artifact — `(anon)` mixin containers, `fromMap: fn + ctor` |
| program-scope flags | 132 | mostly extension-type members (DARTD21 corpus) |
| constructor-name flags | 86 | false positives: `X()` vs `X.named()` — the name field is the class name |
| legal get/set pairs | 134 | legitimately two symbols |
| **genuine duplicate top-level callables** | **15** | all in test files |

So the ruling moves no production payload. That is exactly why it is pinned by a fixture rather than by a corpus delta.

## Evidence

- Fixture `validation/m14/fixtures/dart/dup-decl-last-wins.dart` + expectation: `expectSymbolCount foo=1 / top=1`, the surviving symbol's parameters carry `second`, `contains D -> foo @28` expected and `@24` **forbidden** (the first body's line).
- Mutant `dart/dup-decl-first-wins` — **CAUGHT**.
- Spec ruling **DARTD20** (status FIXED) in `script/m14/spec/dart-completeness.json`.
- Lane state at closure: dart fixtures **11/11**, mutants **39/39 caught**, dart-http **FULL EXTENT 335/335 files CLEAN** (`tree-truth=13654 covered=13654 MISSING=0 | analyzer-edges=12708 unexplained=0 (0%)`, sample hash `2dee60fd89aee7be`).

## A regression this round found and fixed

While landing the ruling, the lane's own fixtures caught a second node-shape trap: a bare `function_signature` nested inside a `method_signature` is a **separate visitable node**, so the signature dispatch processed it a second time and built a second, worse symbol — no body sibling (cyclomatic complexity 1) and no annotation sibling (`@override` lost). Guarded with `if (node.parent?.type === "method_signature") break`. It had broken `dart/payload-and-complexity` (complexity 4→1, 2→1) and `dart/dedup-and-attribution` (a missing `overrides` edge); both are green again, and the reasoning is recorded in the closure record `reviews/dart/m60-closure.md`.
