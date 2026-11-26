# JavaScript — the receiver-owner channel (member calls cannot fall to the name model)

**Author: Muhammad Ishaq Khan.**

## The defect (same class as TypeScript f87e44662)

A member call whose receiver the analyzer cannot type emitted **no `metadata.owner`**, so the row fell
through to the store's NAME model, which binds by bare name. When more than one file declares the
member, the ranking's tie-break picks one — and it can be a class the calling file never imports.

Reproduced in JavaScript before any change (three files, `Widget.run` in `used.js`, `Other.run` in
`other.js`, caller imports only `Widget`):

```
main.js: calls f -> "run"   md={"calleeExpression":"new Widget().run","evidenceClass":"usage_contextual"}
```

No `owner`. The class was literally in the constructor field and was never emitted.

## Four causes, all of which applied

1. **`new_expression` receiver** — the receiver-typing block handled only `identifier`, `this` and
   `member_expression`, so `new Widget().run()` matched nothing. The class is in the constructor field.
2. **Wrapper receivers** — `(new Widget()).run()` arrives as `parenthesized_expression`; branching on
   `object.type` matches nothing. Now stripped (`unwrapReceiver`).
3. **A cast is NOT a wrapper** — `(x as Widget).m()` STATES the type, so unwrapping it would throw the
   statement away and re-derive from the operand. Read as its own evidence (`castTypeName`, evidence
   `"cast"`). This is the one I got wrong first on the TS lane and it is the one worth remembering.
4. **Imported / untyped value receivers** — a member name on a receiver whose type lives elsewhere
   cannot identify a declaration, so the row is WITHDRAWN from name binding
   (`javascriptUnresolvedReceiver`, read by `member-owner-resolution.ts` alongside its existing
   `typescriptUnresolvedReceiver` / `phpMemberReference` keys) instead of being left to tie-break.

## Two traps, both confirmed on this lane

**1. The differential cannot see this.** Its key is `(label, target NAME)`, never which declaration.
After the fix the svelte and lodash differential hashes are **byte-identical**
(`1aa48514c0dab17a` / `494e1b94766e8ade`). Those numbers were already 100% and remain so — they are
coverage of NAMES, and this defect is a defect of WHICH declaration a name binds to.

**2. Gates must be proven to fail.** The first version of the new fixture used an invented
`assertions` / `forbid` shape that the harness silently ignored — it PASSED while asserting nothing,
which is the "blind, not passing" failure. Rewritten in the harness's real dialect
(`expectRelationships` / `forbidRelationships` with `meta.<key>`), and then **mutation-tested**:

| mutant | result |
|---|---|
| `new_expression` owner branch disabled | `FAIL javascript/receiver-owner-rival` ✔ killed |
| wrapper stripping disabled (`stripped = object`) | `FAIL javascript/receiver-owner-rival` ✔ killed |
| withdrawal disabled | survivor — not asserted by any fixture |

The surviving mutant is recorded rather than hidden: withdrawal is a CROSS-FILE property
(`import { shared } from "./x"` → `shared.run()`), and this harness's fixtures are single files, so the
case needs a store-level census, not a fixture.

## Measured population (member calls on `calls`/`uses`, by channel)

| corpus | member calls | owner | withdrawn | claimed |
|---|---|---|---|---|
| preact (207 files) | 7,111 | 473 — 6.7% | 6,578 — 92.5% | **99.2%** |
| nomad (967 files) | 19,294 | 830 — 4.3% | 17,375 — 90.1% | **94.4%** |

Evidence mix after the fix — preact `{this 278, jsdoc 169, new 26}`, nomad
`{this 675, new 129, assignment 18, class-static 5, jsdoc 3}`. The `new` counts are the rows this
change added (preact +26, nomad +129 on a base that previously emitted none from a `new_expression`
receiver); react gained +48 owner rows.

**Everything not owned is now withdrawn rather than left to the ranking.** A withdrawn row keeps its
edge and its spelling and has no binding — an honest NULL, which is the contract
`member-owner-resolution.ts` states for the untyped-receiver case.
