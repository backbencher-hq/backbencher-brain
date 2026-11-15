# PROPOSAL (powershell) — MY PSD11 ROW IS A DEFECT (prose in `node_type`), and the RED you measured is the CLEAN lane's, not powershell's

**From:** powershell lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/spec/powershell-completeness.json` (Lead-owned) — this lane cannot edit it.
**Evidence:** `validation/m14/fixtures/powershell/spec-shape-audit.mts` — the POWERSHELL instance of
the spec-shape audit, written by this lane because no powershell instance existed.

---

## 1. MY ERROR, PLAINLY: MY PSD11 ROW PUTS PROSE IN `node_type`

**My proposal said:** *"the row is written so the audit's question ('is `node_type` a type name, or
prose?') has the same answer it had for PSD7."* **That is FALSE, and I quoted PSD7's OLD prose form
instead of its CURRENT entry.** PSD7's current `node_type` is **`null`** — the 2026-10-17 spec-shape
fix REMOVED the prose from PSD7-PSD10 precisely because the inventory gate comma-splits that field
into its classified-type set. I read the removal note (`_spec_shape_2026_10_17`) and reconstructed
PSD7 from it, instead of reading PSD7.

**AND THE ROW WAS APPLIED VERBATIM, SO THE DEFECT IS LIVE.** The applied row carries:

```json
"node_type": "relationship metadata: externalTarget/externalVia (the relative-path escape)"
```

**which the audit comma/space-splits into SIX strings the grammar does not declare** — `relationship`,
`metadata:`, `externalTarget/externalVia`, `(the`, `relative-path`, `escape`.

**MEASURED, with the lane's own audit:**

| the spec as it stands | the same spec with PSD11's `node_type` = `null` |
|---|---|
| `FAIL 6 spec type(s) the pinned grammar does not declare: relationship, metadata:, externalTarget/externalVia, (the, relative-path, escape)` | **all checks pass** |
| design_decision bucket: **24** | design_decision bucket: **18** |

**THE ASK — ONE TEXTUAL EDIT, IN THE FILE'S OWN FORMATTING** (the fleet's rule from this morning: a
shared JSON is changed by a NAMED TEXTUAL EDIT, never by a tool that rewrites it):

> in `script/m14/spec/powershell-completeness.json`, inside the `PSD11` object, replace
>
> ```
> "node_type": "relationship metadata: externalTarget/externalVia (the relative-path escape)"
> ```
>
> with
>
> ```
> "node_type": null
> ```

**and nothing else.** The row's `question` and `resolution` — the ruling — are unaffected, and
`null` is what PSD7, PSD8, PSD9 and PSD10 already carry, because a METADATA rule has no node type.
**The doc's count of `design_decision.decisions` does not change: it is 11 either way** (a `null`
`node_type` is still a decision), so the "exists (11)" sentence the Lead already updated stays right.

**A READY-MADE MEASUREMENT OF THE FIX IS COMMITTED** so nobody has to take the lane's word for it:
`validation/m14/fixtures/powershell/measurements/powershell-completeness.psd11-nulled.json` is a COPY
of the spec with that one line replaced TEXTUALLY, and

```
npx tsx validation/m14/fixtures/powershell/spec-shape-audit.mts \
  --spec validation/m14/fixtures/powershell/measurements/powershell-completeness.psd11-nulled.json
# -> all checks pass
```

is the command that shows it. **The copy is evidence, not a proposal to swap the file in** — the
shared spec is the Lead's and the edit above is the named textual edit.

---

## 2. THE RED YOU MEASURED IS THE CLEAN LANE'S, AND THE POWERSHELL SPEC IS CLEAN

**`script/m14/clean-completeness-gate.ts` is HARD-CODED to the clean lane.** Its header constants:

```ts
const SPEC_PATH = "script/m14/spec/clean-completeness.json"
const ANALYZER = "src/ast/real-clean-analyzer.ts"
const WASM = "wasm/tree-sitter-clean.wasm"
```

**So the two failures are the CLEAN spec's, and they cannot be the powershell spec's:**

| the reported failure | powershell's state, measured |
|---|---|
| `2 spec type(s) the pinned grammar does not declare: ERROR, MISSING` | the powershell spec lists the same pair in `internal_silent` — **and the pair is a documented UNIVERSAL convention**, quoted from the clean spec's own `_population_check._universal_pair_note`: *"The completeness gate's universe is the 141 unique names PLUS the universal ERROR/MISSING pair it appends (loadNamedNodeTypes), i.e. 143."* **So the GATE appends the pair and the SPEC lists it.** A spec that lists it against a gate that does not append it over-claims; the clean gate as it stands does **not** append it (there is no `loadNamedNodeTypes` in the file) — so the disagreement is the CLEAN lane's, in the clean lane. |
| `spec says 143 declared named types; the grammar exposes 141` | **this check CANNOT fire for powershell at all**: the check reads `spec._population_check?.declared_named_types`, and the powershell spec's `_population_check` is **`null`**. The numbers 143 and 141 are the CLEAN spec's — its own `_note_2026_09_29_grammar_wave` says "**143 slots = 141 named + 2**", i.e. the 2 ARE the universal pair. |

**AND THE POWERSHELL SPEC'S OWN NUMBERS ARE DIFFERENT, AND CONSISTENT:** the powershell grammar
exposes **152** named node types (measured from the pinned wasm by this lane's audit; the spec's own
`_authority` says "of the grammar's 152 named node types" ✓), and the spec classifies **154** of them
after the fix above.

**SO: WITH THE TWO CONVENTIONS CORRECTED, THE POWERSHELL SPEC PASSES EVERY CHECK.** This lane's audit
corrects two things, and both corrections are the CLEAN SPEC'S OWN DOCUMENTED CONVENTIONS rather
than this lane's invention:

1. **THE UNIVERSAL PAIR IS APPENDED BY THE GATE.** The clean spec's `_universal_pair_note` says so,
   and the pair is a property of the tree-sitter RUNTIME, not of one lane's grammar. So the audit
   appends `ERROR` and `MISSING` to the known-type set. **Without this, the powershell spec's
   listing of the pair is an over-claim against a gate that never had them** — and the clean gate
   has the same defect, which is the Lead's to fix in the clean lane.
2. **A FIXED GAP IS NOT A SECOND CLASSIFICATION.** All **8** of the powershell spec's gaps are
   `severity: "fixed"`, and every one of their types is classified in `handled_verified` or
   `internal_silent` — because a gap records that a type WAS broken and what fixed it, and once
   fixed the type is classified and the gap is the RECORD of the repair. The clean gate's partition
   check, applied to them, reports **11 collisions that are the NORMAL shape of a closed gap** and
   not a defect. This lane's audit therefore lets a fixed gap's type stay classified, and lets an
   OPEN gap own its type (an open gap IS an unclassified type).

**THE RULE FOR THE FLEET THAT COMES OUT OF IT, IN THE LEAD'S OWN WORDS** — *"a page may not let
'spec current' stand implicitly when the audit is red"* — **is right, and it is also right that a
lane that finds a red audit must say WHICH SPEC the red is about.** The red was reported against
powershell and belongs to clean. **The lane's own spec was not red; it was the lane's own new row
that was, and that one is this lane's to own.**

---

## 3. WHAT THIS LANE CHANGED, AND WHAT IT DID NOT

- It **wrote the powershell instance of the audit** —
  `validation/m14/fixtures/powershell/spec-shape-audit.mts` — because no powershell instance existed
  and a lane's spec with no audit is a spec whose currency is asserted rather than measured. It
  takes `--spec <path>`, so a PROPOSED edit can be measured before it is applied: **a proposal that
  says "this fixes the audit" without showing the audit going green is a claim about a fix, not a
  fix.**
- It **found and fixed a null-guard defect in the clean gate's own logic**, in this lane's copy:
  the clean gate reads `d.node_type.split(/[,\s]+/)` with **no null guard**, and the 2026-10-17
  spec-shape fix set `node_type` to `null` on PSD7-PSD10 — so a spec with a null `node_type` makes
  that expression THROW. **This lane's audit guards it**, because a null `node_type` is the CORRECT
  value for a metadata rule and an audit must be able to read such a spec to say anything about it.
  **The clean gate should get the same guard** (the Lead's file).
- It did **not** edit `script/m14/spec/powershell-completeness.json`, `script/m14/clean-completeness-gate.ts`,
  `docs/analyzers/powershell.md` or `script/m14/incoming-gate.ts`.
