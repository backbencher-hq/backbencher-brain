# CL4 — `bb_cross_language`: asking what the gate does NOT cover

**Status** — CL1 VERIFIED (324/324, 14/14 mutants) on BOTH corpora · CL1 wiring
VERIFIED (23/23, 14/14 anchors live) · M26 W3 VERIFIED 21/21, 5/5 mutants ·
CL1-T1 VERIFIED 19/19 · production path (`node bin/bb mcp` over stdio, from
`dist/`) VERIFIED on both corpora, including the absence sentence · tool docs PASS
(16 tools, 18 artifacts)
**Supersedes** — nothing. CL1, CL2 and CL3 all remain in force.
**Evidence** — `validation/m63/results/CL1.json`, `CL1-wiring.json`,
`absence-scope.json`, `open-gaps.json`, `mcp-stdio-*.json`
**Verifiers** — `npm run verify:m63`, `npm run verify:m63-wiring` (in
`verify:fast`, so CI runs it)

---

## 1. Why this round exists

The previous round closed its four items. The question that followed was whether
the tool was finished, and the honest way to answer that was not to look at what
had been done but to look at the gate's own check list and ask **what is not on
it**.

Three surfaces were missing, and asking took ten minutes. Four of them are now
covered, and one of the four was a real defect in the tool — a fifth, in the
sentence the tool is most often trusted for.

## 2. The defect: an absence that claimed more than it searched

The absence note read:

> no stored cross-language rows **anywhere in the index** for `'X'` or for any of
> its members — absence declared, never guessed

All three queries behind that answer bind a `projectId` as their first parameter.
The search covered **one project**. "Anywhere in the index" is a claim about the
whole store.

Measured, with both projects real (`lane/cl-absence-scope.ts`):

| | |
|---|---|
| project A holds `scopedName`, and no cross-language rows for it | 0 rows |
| project B holds `scopedName`, **and** a cross-language row for it | 1 row |
| asked about it, in A | "no stored cross-language rows anywhere in the index" |

`CLAIM_IS_FALSE: true`. The rows exist. The sentence is false as written, and the
absence *for A* is still correct — only the universality was wrong.

This is the same shape as the defects CL1 and CL2 fixed in the data: declaring more
than was measured. CL1's was a false **absence** (no rows where rows existed); this
is a false **universality** (rows elsewhere in the store, declared absent
everywhere). It matters more than a wrong count, because the absence note is what a
caller reads *instead of* checking: `absenceNote` exists precisely so that no
further query is needed.

**The fix is one word of scope** — "anywhere in **this project's** index" — and the
reason it took three rounds to find is worth recording:

- the CL1 gate **refuses a corpus with zero cross-language rows**, which is
  correct for a gate that asserts things about rows;
- so every absence it ever asserted was an absence in a project that *does* hold
  such rows for other names;
- and that is precisely the situation in which a global-sounding sentence happens
  to be harmless.

Nothing in the suite constructed the case that makes the difference visible: the
same name in **two** projects, rows in one and not the other. Measured again after
the fix: `CLAIM_IS_FALSE: false`, and the absence itself unchanged and still
correct.

## 3. The other three surfaces: correct, and never run

All three turned out to be right. They were still added, because "right because I
read the code" and "right because I ran it" are different claims.

**J — a project with no cross-language rows at all.** The single most common
real-world case: most repositories are single-language, so they hold no such rows.
The tool answered it correctly and unmeasured — `declaredAbsent: true`, an empty
fact set, `copyCount: 1`, and a stated reason. The subtle part is the last of
those: absence is about **rows**, not about **existence**, and the answer says the
name is still in the index.

**K — truncation driven by the member section.** The existing F2/F3 truncate a hub
with plenty of *own* rows, so `remaining` is already 0 by the time members are
considered. The only shape where `memberFacts.slice(0, remaining)` is genuinely
partial is `own < limit < own + member`, and it had never run. It is correct: own 0,
member 6, `limit: 4` → 4 shown, `truncated: true`, `totalCountIfKnown: 6`, and the
reason names the member section.

**L — own-first precedence at limit 1.** The handler states the intent: one budget
over the union, own rows first, and the rows naming the symbol itself must never be
crowded out by a member's edges. At `limit: 1` that intent is a single fact, and it
is the owner's. Correct — and an off-by-one in the precedence arithmetic would have
shown up here first.

## 4. A probe that was wrong in the safe-looking direction

GAP3's first draft seeded the owner's own row as `.ts → .ts`. Both ends shared a
language, so the row was **unpairable**, so the tool correctly refused to emit it —
and the probe reported `ownRowAlwaysWinsTheBudget: false`.

That reads like a tool defect and was entirely the fixture's fault. It is the same
lesson as M13 this round (a probe that seeded a row for the wrong query arm) and as
the wiring checker that rejected a deletion mutant: **a failing assertion is a
question about the fixture before it is a question about the code.** Fixed by
seeding pairable rows — the two ends in files of genuinely different languages —
and the rule then measured correct.

Every fixture added in CL4 follows that rule, and the gate section says so at the
top, because the next person to add a fixture will hit the same trap.

## 5. What is now covered that was not

| section | surface | reachable from a corpus? |
|---|---|---|
| J | a project with no cross-language rows | no — the gate refuses such a corpus |
| K | member-driven truncation | no — F2/F3 truncate an own-rows hub |
| L | own-first precedence at limit 1 | no — F2/F3 never go that low |
| M | the absence note's project scope | no — needs the same name in two projects |

**M15** removes the scope word and is caught, because a wording fix with no mutant is
a wording fix the next editor silently undoes — and this one is the tool's strongest
claim.

The gate is now **324/324, 14/14 mutants** on both corpora.

## 6. Verified over the wire, not just in process

The production-path probe now asks for a **silent** symbol as well as the hub, and
discovers it per run rather than hardcoding a name that goes stale on re-index. It
had to: a name absent from the index is answered with a loud declared **error**, so
it cannot test the absence wording at all. If no silent symbol is found the runner
reports a failure rather than dropping the check — a probe that quietly skips its
own assertion is the vacuous pass this lane has hit three times.

Over `node bin/bb mcp`, from `dist/`, on both corpora: 16 tools listed,
`bb_cross_language` dispatched by name, `isError: false`, every fact naming both
ends, no duplicated `rowId`, an unknown name a loud error, and for a symbol that is
present but silent — `declaredAbsent: true`, `claimsWholeIndex: false`,
`scopesToTheProject: true`.

## 7. Still open, and whose it is

Unchanged, and re-confirmed on both corpora (`docs/m63/CL3.md` §7):

1. **`name-resolution` is 100% of stored bridges** — 1,642/1,642 and 1,168/1,168 on
   two unrelated corpora. *Analyzer's.*
2. **52% of cross rows carry no analyzer `evidenceClass`**. *Analyzer's.*
3. **`cross-language-intelligence-persister.ts` mints non-project-prefixed ids** and
   is imported without being called. *Analyzer's.*
4. **M48.C1's predicate should be replaced for all 16 tools.** *Governance's.*

None of these are this tool's to fix. It reports what was stored, declares what it
cannot see, and does not re-derive a value the analyzer owns — which is the most it
may claim, and is the claim every gate here now checks.

## 8. The general lesson

Three rounds in, every defect was found by asking a question the evidence could
answer, and none by reading the code carefully:

| defect | found by |
|---|---|
| false absence from a bare `.get()` | running the handler against a real corpus |
| cross-project leak | injecting a row from another project |
| member cascade vs. false absence | cross-checking `bb_graph` on the same index |
| hover door leaking another project's rows | re-reading CL1's own "latent" reasoning |
| absence claiming the whole index | **asking what the gate's check list did not contain** |

The last one is the newest and the cheapest. A gate that cannot fail is not a gate,
and neither is a gate whose list of cases was never questioned.
