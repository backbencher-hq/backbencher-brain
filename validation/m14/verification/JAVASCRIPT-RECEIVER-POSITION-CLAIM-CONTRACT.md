# JavaScript — RECEIVER-POSITION CLAIM CONTRACT

**Author: Muhammad Ishaq Khan.**
**REGENERATED 2026-11-13.** The original of this page was deleted from this working tree by the 0.1.5
release cycle and exists in **no git history** (`git log --all` finds no commit for it), so it cannot be
restored. This is rewritten from the code and the instruments as they stand now; every shape below was
read out of `src/ast/real-javascript-analyzer.ts` rather than recalled.

## The claim

An edge whose target is a member of a receiver the file does NOT define (`window.fetch`,
`JSON.parse`, `Object.assign`) is a claim that the receiver is EXTERNAL. The analyzer publishes it as:

| metadata key | meaning |
|---|---|
| `isExternalTarget: true` | the row asserts the target is outside the project |
| `externalReason` | the closed reason code (for example `module-namespace`, `host-global-base`, `host-global-type`) |
| `externalClaimReason` | the human-readable citation the claim rests on |
| `externalReceiver` | the receiver root the claim is about |
| `externalSpecifier` | what the arbiter verifies a `module-namespace` claim against |

All five are emitted in one place (`applyProjectIndexFacts` / the external-claim pass around
`real-javascript-analyzer.ts:5005`), and the keys are named in the arbiter's `EXTERNAL_KEYS`
(`script/m14/incoming-rule.ts:56`) so a claim the arbiter cannot see cannot exist.

## Two rules that bound the claim

**1. A claim is only made when the evidence is closed.** Host and runtime globals come from a CITED
vocabulary (`hostGlobalCitation`, `runtimeGlobalCitation`) — a name is external because a citation says
so, never because it looks external.

**2. Module externality is FAIL-CLOSED.** For an import specifier the pass requires
`context.projectIndex.complete === true`:

> a complete project index is the project saying "no module of mine answers to this specifier"; a
> sampled or absent index is a fragment, and a fragment that says "no such file" says nothing.

So **without an index the lane claims NOTHING here**. This is why a cap-50 index-less
`incoming-gate` run shows the `imports` class as unresolved (354 of 397 on a 120-file draw) — that is
the design, not a gap. The measurable arm is `incoming-gate … 0 --index`.

## What it is NOT

It is not a static type system. `this.x.y` where `x` is a DOM element is not claimed external just
because the chain is long: the claim needs a CITED root, and the receiver owner is separately tracked
(field-owner work). A wrong owner was a real defect class and is measured by
`javascript-chain-owner-census.ts` and `javascript-field-owner-census.ts`.
