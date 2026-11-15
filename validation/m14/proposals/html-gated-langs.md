**§1 OF THIS PROPOSAL IS WITHDRAWN. Its 7-kind line was built on an emitted set contaminated by html's three committed `.ts` tools, and its "exports 3" counted three `forbidRelationships` rows as pins. The Lead's reader fix collapsed section B to ONE kind — `exports` — which the html contract FORBIDS and which the embedded-script delegation emits. That is the Lead's decision, not a row line. §2 and §3 below still stand.**

# PROPOSAL — add `html` to `GATED_LANGS` (SECTION 1 WITHDRAWN — see HTML-STATE.md §6)

**TO THE LEAD. `completeness-inventory.ts` is yours; the two changes below are one line each and I have prepared the
evidence for both.**

## 1 · SECTION B — ADD THE 7 EMITTED KINDS TO `LANG_CONFIGS.html.requiredKinds`

**Current:**
```ts
requiredKinds: ["uses", "contains"],
```
**Proposed:**
```ts
requiredKinds: ["uses", "contains", "calls", "exports", "extends", "imports", "instantiates", "overrides", "references"],
```
**Section B's own failure names exactly those 7 as "EMITTED but absent from requiredKinds".**
**THE FORWARD CHECK CANNOT REGRESS: every one of the 7 is already pinned by an existing expectation file —
`references` 28 · `calls` 7 · `extends` 4 · `imports` 3 · `exports` 3 · `instantiates` 3 · `overrides` 3.**
**Deliberately NOT added: `implements`** — it is pinned in three fixtures but was NOT in the emitted list, so adding
it would require something the instrument did not observe. It is flagged in `HTML-STATE.md` §3 for a decision
(coverage question vs stale pin).

## 2 · AFTER YOUR E/F SWEEP, ADD `html` TO `GATED_LANGS`

**At this HEAD html is 5 pass / 3 fail:** A · C · D · G · H pass; **B is fixed by §1**; **E and F are your central
`--update-baseline` sweep** (`no baseline floor row for otp:html` · `no avgMsPerFile for otp:html`).
**With §1 applied and E/F swept, no lane-side section fails and html is 8/8 — the CONFORMANT rung.** **I did not run
`--update-baseline` (yours by instruction) and did not edit `completeness-inventory.ts`.**

## 3 · WHAT html STILL OWES AFTER GATING (so gating is not mistaken for done)

The lane's residual is **32,656 unresolved over a 400-file draw**, and the measurement (`HTML-STATE.md` §4) splits it
into two named, DOABLE classes:
1. **≈26,083 verbatim URL targets** (`22,260` navigation + `≈3,823` fetches) — **the qualifier is computable and
   never computed**: `filePath` and `context.projectRoot` are both in hand at emission time.
2. **6,416 embedded-delegation edges with BARE-NAME targets** — a **routing gap, not a silence**: the delegates run
   and emit, but the target carries no path so nothing can bind it.
**Gating html should be understood as "its sections are honest", not "its edges resolve".**
