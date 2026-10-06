# The two inherited M42 honesty gaps — closed in code, still open in the inventory

Written by lane 6, task 6. The call-site migration itself is **not** attempted
here; another lane owns it. What follows is a reading of the current code plus
what hover should consume.

The two gaps are quoted verbatim from `validation/m42/results/KNOWN-GAPS.json`
at the commit this lane inherited, which is where a reader would look for them.

## Gap 1 — header count vs deduplicated list

> **H2** — "Header usage count keeps the M24 semantics (raw relationship-row
> count); the usages section lists deduplicated L3 locations — when several rows
> point at one site the numbers differ, honestly."

That is §13.4's named violation: *"Counts equal what is rendered. Header totals
count the groups the surface actually renders. A number the eye cannot verify
against the list is a violation."* The trailing "honestly" declares the
disagreement but does not cure it — §13.4 does not offer an exemption for a
disagreement that has been written down.

### Status: CLOSED in code

The header and the list are now **the same array's length and the same array**:

```ts
// src/lsp/hover.ts:510-519
const sites = richSitesForSymbol(raw, symbol.id)
const usageSiteRows = usageSitesOf(sites)
const usageCount = usageSiteRows.length          // <- the header number
// ...
// src/lsp/hover.ts:619
usagesSection: usagesSection(usageSiteRows, usageCount, /* … */)
```

`usageSitesOf` is `relations.ts`'s `usageSites()` — the vocabulary owner, applied
once. The header is that array's length; the rows are `usage.slice(0, MAX_USAGE_LINKS)`
of the same array plus a `+N more` line carrying `total - shown`. The eye can
verify it: three rows plus "+2 more" is five.

There is a second, independent count — `countUsages()` at `hover.ts:353`, which
delegates to `countUsageSites()` in `relations.ts:125`, a pure-SQL implementation
of the same rule. It is **not** what the header uses. It exists to be
differentially compared against the collector by `verify-relations.ts` (T3), so
that a drift between "what the list shows" and "what the rule says" is caught by
a gate rather than by a reader. That is the right shape: the header cannot lie
by construction, and the independent SQL is the check on the rule rather than a
second source of the number.

`relations.ts:153` also exports `isResolvableUsageSiteRow()` with a comment
recording why: the collector once dropped a row the SQL count kept, when a
stored byte column landed mid-code-point and `navigation.edgeLocation` threw.
A count that disagrees with its list is the defect; the predicate exists so both
sides can be compared under one rule.

### What hover should consume, going forward

Hover should keep taking its count from `usageSitesOf(...)` and **never** from a
second query. If a future surface needs a count on a different basis, §15 rule 1
requires it to state the filter — not to quietly answer a different question.

## Gap 2 — usage links pointing at a declaration, not a call site

> **H2** — "The analyzer stores no call-site byte ranges; usage links point at the
> referencing symbol's declaration (the same location the native references tree
> jumps to)."

§14 rule 3: *"A range handed to the editor points at the call site it names,
never at a declaration, never at a body, never at a fabricated line."*

### Status: CLOSED in code, by the commit this lane inherited

`src/lsp/rich_hover.ts:344-358` now reads `brain_relationship.line_number`,
classifies it through the declared owner
`src/intelligence/graph/line-address.ts`, and opens the call site when the store
holds one. When it does not, the link falls back to the declaration **and says
so on the card** — `addressNoteSuffix()` at `:206-212` appends
`ADDRESS_NOTES.substitute` to that row's own label, and the section header at
`:488-493` declares the split. §14 rule 2's "identity is stated" and rule 3's
"positions are where the thing is" are both satisfied by construction.

Measured by `verify-hover-coverage.ts` R4, at this commit:

```
usage rows whose stored line the address owner calls a REAL call site: 17
  a link opens the stored CALL SITE:   15
  a link opens the DECLARATION:         0
  no link rendered (the 3-row cap):     2
```

The residual 2 of 17 are the render cap, which the card states ("+N more"), not
a wrong position.

The one honest limitation still standing is in the current `H2.json` and is
**not** a lie: the store carries no call-site **byte** column, so a call-site
link opens at character 0. The line is exact; the column is not stored. The card
says which is which.

### What hover should consume, going forward

Hover must not re-derive the address. `line-address.ts` is the owner; the
collector passes its verdict through unchanged. The call-site **migration** —
making the index store a real call-site byte range, so character 0 becomes a real
column — belongs to the lane that owns `navigation.ts` and the analyzers. Until
that lands, the correct posture is the one the code now has: use the stored line,
declare the missing column, and never present character 0 as though it were
indexed.

## The third inherited item — and it was live

> **H1** and **H2** — "Warm-budget check uses mean-over-40 as a p95 proxy; the E5
> editor leg re-measures with the shared harness."

H2 was already fixed (`WARM_SAMPLES = 200`, real percentile).
**H1 was not**, and it is this lane's file:

```ts
// script/m42/verify-highlight.ts, before
const warmMs = (performance.now() - t1) / 40
check("H1/R5: warm p95 budget <= 25ms (mean over 40 steady-state calls)", warmMs < 25, …)
```

One number, two claims: the check's own name said *p95* and its arithmetic said
*mean*. Now fixed in commit `68a5d327d` — 200 individually-timed requests,
sorted, nearest-rank 95th percentile, no interpolation, plus a second check that
the distribution is genuinely spread (so 200 identical samples cannot pass as a
percentile). Measured: p50 5.66 ms, **p95 10.12 ms**, max 23.13 ms, mean 6.17 ms.
The p95 sits 64% above the mean the old check used, which is the whole reason
the substitution mattered.

## The finding underneath both gaps

`validation/m42/results/KNOWN-GAPS.json` still carries **all three** of the
entries above, including the two whose code is fixed and the one that was fixed
in H2 three waves ago. Nothing removes an entry when its gap closes.

So the file a reader consults to learn what is wrong with the hover is wrong in
three places, and two of its entries describe behaviour the code deliberately
replaced. The M44 sibling (`validation/m44/results/KNOWN-GAPS.json`) has a
generator — `script/m44/verify-closure.ts` "Pass 4: the compiled KNOWN-GAPS
inventory is regenerated over the evidence". The m42 file has no generator this
lane could find, so it appears hand-maintained.

This is worth stating plainly because it is the same shape as the bug classes
this lane gated elsewhere: **a record that only grows.** A limitations list that
never shrinks is a list whose entries stop being evidence, and a reader who
finds one stale entry has no way to tell which of the other seventeen are
current.

Recommended, not done — `validation/m42/results/` is not in this lane's owned
file list:

1. derive the m42 inventory the way m44 does, from the `limitations` arrays the
   verifiers already emit, so a closed gap disappears the moment its wording
   changes; and
2. add a check that fails when an inventory entry is **verbatim** present in a
   verifier's `limitations` AND in that verifier's `status: verified` record with
   no corresponding open item — the mechanical form of "this list is stale".

## Numbers not in this document

- Whether the call-site byte column will exist. Not this lane's to decide.
- Any editor leg. Nothing here clicks a link in VS Code.
- A measurement that the two closed gaps stayed closed under load or on a real
  index. The numbers quoted are this lane's fixture runs at this commit.
