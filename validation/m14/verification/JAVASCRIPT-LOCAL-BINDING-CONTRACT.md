# JavaScript — LOCAL-BINDING CLAIM CONTRACT

**Author: Muhammad Ishaq Khan.**
**REGENERATED 2026-11-13.** The original of this page was deleted from this working tree by the 0.1.5
release cycle and exists in **no git history** (`git log --all` finds no commit for it), so it cannot be
restored. This is rewritten from the code and the instruments as they stand now; every shape below was
read out of `src/ast/real-javascript-analyzer.ts` rather than recalled.

## The claim

A row whose target is a name the file declares LOCALLY carries a **binding claim** instead of a bare
name. The spelling is:

```
<source>\u0000<name>
```

`BINDING_SEP = "\u0000"` is defined once in `src/ast/types.ts:321` and imported by the analyzer
(`real-javascript-analyzer.ts:646`); the claim is built at `:4835` as
`` `${source}${BINDING_SEP}${name}` ``.

**Why a separator at all.** A bare name cannot say WHICH declaration it means — two files can declare
`run`, and one file can declare a local `run` and a class member `run`. The claim names the container
explicitly so the store re-resolves inside it rather than by global name ranking.

## The decision path

1. `collectBindingModel(rootNode)` builds a **positional** scope model: every scope carries
   `startIndex`/`endIndex`, `published`, `names`, `decls`. It is built **once, at the top of
   `analyze()`** — a fix in this campaign, because the class heritage emission runs before the
   containment/call/use passes and used to read a `null` model (`importedBinding` was therefore never
   populated; 0 of 702 rows on consul).
2. `resolveBindingKind(model, index, name)` answers `published` / `local` / null for a NAME at an
   OFFSET. The offset is load-bearing: minified files are one line, so line-based answers are wrong.
3. A **published** (program-scope) name is a real symbol, so the target keeps the bare name and gains
   `metadata.importedBinding` instead; a LOCAL name yields the `BINDING_SEP` spelling.

## What a consumer must do with it

The arbiter (`script/m14/incoming-gate.ts`) treats the separator as a claim class: a target speelled
with a binding is resolved against the container, not against the project's name table. A row that
carries the claim and cannot be resolved inside its container is counted, not silently passed.

## Verified

- `script/m14/javascript-target-validity-census.ts`: **0 invalid** of 3,271 rows examined, 871 of which
  use `BINDING_SEP` — i.e. the claim class exists at scale and every instance is well-formed.
- `script/m14/javascript-source-attribution-census.ts`: **0 unattributed**.

## Known limit

A capability-dependent pass that holds an OFFSET rather than a node asks the same question through
`importedBindingAt(index, name)` (added for decorators, which are recorded as NAME STRINGS by the symbol
walk). Both forms delegate to one implementation, so a node-based and an offset-based caller cannot
disagree about what the model says.
