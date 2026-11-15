# PROPOSAL (powershell) — the ANALYZER'S OWN CO-EDIT LIST, unsatisfied twice, with the EXACT text to apply

**From:** powershell lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `docs/analyzers/powershell.md` and
`script/m14/spec/powershell-completeness.json` — **neither is in this lane's write scope**, so this is
a proposal and not an edit.
**Why now:** this lane changed `src/ast/real-powershell-analyzer.ts`, and that file's OWN header says
what must change with it.

## THE CO-EDIT LIST, AND WHY THIS LANE CANNOT SATISFY IT

`src/ast/real-powershell-analyzer.ts:9-11` — the analyzer's own header:

```
// WHEN THIS FILE CHANGES, EDIT THESE TOO (the co-edit list): docs/analyzers/powershell.md,
// the spec JSON's emission sites, and every fixture/expectation pinning an edge whose type or target
// moved. A kind this file emits must be named in the contract row, or the reverse check fails.
```

**THIS LANE SATISFIED ONE OF THE THREE AND CANNOT SATISFY THE OTHER TWO:**

| co-edit item | status |
|---|---|
| every fixture/expectation pinning an edge whose type or target moved | **DONE** — the change moves METADATA, not any edge's type or target, and the suite is **20 pass / 0 fail** (was 19/0) |
| `docs/analyzers/powershell.md` | **PROPOSED BELOW** — outside this lane's write scope |
| the spec JSON's emission sites | **PROPOSED BELOW** — outside this lane's write scope |

**AND THE LIST WAS ALREADY UNSATISFIED BEFORE THIS LANE TOUCHED THE FILE.** The first incident's fix
(`8cd43c988`, "the fleet's first clause-4 red closed") changed the analyzer and added the
`isRelativeScriptPath` rule — and **neither file records that rule**:

- `grep -n "PS-RELATIVE-PATH" docs/analyzers/powershell.md` → **no match**. The doc's
  append-only record has a section for **PS38** (`:1455`, the arbiter's key) and one for the
  **#419 completeness inventory** (`:1566`) — and nothing for the rule that came between them.
- `grep -n "PS-RELATIVE-PATH\|relative path\|dot-sourc" script/m14/spec/powershell-completeness.json`
  → **no match** for the rule. The spec's `design_decision.decisions` has **10** entries, `PSD1` …
  `PSD10`, and the last is `PSD10: "relationship metadata: noDeclarationInFile (rejected as an
  externality claim)"` — **the relative-path rule is not among them.**

**SO THE DOC AND THE SPEC ARE BOTH ONE RULE BEHIND, AND THIS LANE'S CHANGE MAKES IT TWO.** That is
worth saying plainly, because the co-edit list is the analyzer's own contract and a contract that is
silently stale is the "the doc drifts because the doc is not the thing anyone reads" shape the fleet
keeps finding. **This lane proposes the text; it does not edit the files.**

---

## 1. THE SPEC — `script/m14/spec/powershell-completeness.json`

**THE SHAPE.** `design_decision.decisions` is a list of 10 objects, each
`{id, node_type, status, question, resolution}`. The proposal adds an **11th**:

```json
{
  "id": "PSD11",
  "node_type": "relationship metadata: externalTarget/externalVia (the relative-path escape)",
  "status": "RULED",
  "question": "A dot-sourced path is a PROJECT FILE reference, not an external target — but WHICH paths? The first incident's rule answered 'a relative path ending in .ps1', and the ARBITER asks a different question: 'is this path one of the PROJECT's admitted files?' (pathTargetInProject, script/m14/incoming-rule.ts). The two disagree on three axes: the EXTENSION (the gate admits `powershell: \"ps1,psm1,psd1\"` — incoming-gate.ts:134 — and the arbiter's match is by SUFFIX, so the extension is irrelevant to it and decisive to the rule), the SEPARATOR (the arbiter matches a BARE `Helper.psm1` against any admitted file with that basename, so a separator requirement hides nothing), and the ABSOLUTE case (the gate's project facts are REPO-RELATIVE — path.relative(repoRoot, abs), incoming-gate.ts:577 — so an absolute path can never be refuted, and withholding it discards a TRUE claim). Which spelling may carry an externality reading?",
  "resolution": "RULED: A RELATIVE path naming one of the lane's ADMITTED spellings carries NO externality reading, and a path that names something OUTSIDE any project KEEPS it. The 2026-10-19 rule (a relative path ending in .ps1) was correct for the two rows it was written for and too narrow in two directions, and BOTH were measured. (1) THE SECOND REFUTED CLAIM: powershell/test/powershell/Modules/Microsoft.PowerShell.Security/FileCatalog.Tests.ps1:365 and :366 publish `uses -> DSCResources\\UserConfigProviderModVersion1\\UserConfigProviderModVersion1.psm1` with `externalTarget: true`, and that file IS in the project — the arbiter's own `verifyExternalClaim` answers `externalRefuted` on both. The lane's extFAIL column read 0 anyway, because PS38 withholds the arbiter-readable key on a bare owner and `externalTarget` is not in EXTERNAL_KEYS, so the false claim was published AND INVISIBLE. The 2026-10-19 rule missed it because .psm1 is not .ps1. MEASURED, whole population (1,181 files / 30 repos, root /home/ishaq2321/bb_tests/repositories and the .corpus symlink farm, which admit the SAME multiset of (repo, relative path)): 47 distinct target spellings name an admitted project file — 26 .ps1, 13 .psm1, 8 .psd1 — and 2 of them were published as claims. (2) THE DISCARDED TRUE CLAIM: /usr/lib/x.ps1 and C:\\x.ps1 were WITHHELD by the 2026-10-19 rule (it matched any .ps1 carrying a separator), and the arbiter could have checked them. The rule now withholds the reading when the target ends in .ps1, .psm1 or .psd1 AND its spelling is a RELATIVE path — not /unix-rooted, not C:\\drive, not a URI scheme — which is the bash lane's rule applied to powershell's own admitted spellings. THE CLASS IS NAMED: THE ESCAPE WAS WRITTEN FROM A SPELLING RATHER THAN FROM THE ARBITER'S QUESTION, and a spelling-keyed answer to a project-keyed question hides in BOTH directions. Pinned by fixture powershell/relative-path-psb18 (9 path rows; 8 of the 9 FLIP between the 2026-10-19 rule and this one, and the 9th is a control that does not), with two mutants that must both go red: `relative-path-psb18-escape-narrowed` (the 2026-10-19 rule VERBATIM) and `relative-path-psb18-escape-widened` (every admitted-suffix path, absolute and URI exceptions removed)."
}
```

**A NOTE ON `node_type`:** PSD7-PSD10 once carried prose there and it was REMOVED, because the
inventory gate comma-splits that field into the classified-type set. The string above is a
`relationship metadata:` label of the same shape as PSD7's — and **the shape audit must be re-run
after this row is added** (`design_decision.decisions` is documented at
`docs/analyzers/powershell.md:1596` as "exists (10)"). **A count is a count: that
number becomes 11, and the doc's own statement of it must be updated with it.** This lane has NOT
applied the row, so it has NOT verified the shape audit against it — **the Lead's verification
should, and the row is written so the audit's question ("is `node_type` a type name, or prose?") has
the same answer it had for PSD7.**

---

## 2. THE DOC — `docs/analyzers/powershell.md`

**THE DOC'S OWN CONVENTION** (`:1457-1459`): *"This section is APPENDED rather than woven in, because
every number above it was measured at a different revision and rewriting them would destroy the
comparison."* So the co-edit is an **appended section**, and it goes at the end of the file (after
`:1566`, `## #419 completeness inventory (2026-10-17) — the reading`).

**AND THE APPENDED SECTION MUST CARRY BOTH RULES** — the 2026-10-19 one, which the doc never
recorded, and the 2026-10-20 widening, which is what this lane changed:

```markdown
## PS-B18 (append-only record, 2026-10-20) — the relative-path escape, and the SECOND refuted claim

**THE RULE, AND WHY IT IS NOT A RULE ABOUT SPELLINGS.** A dot-sourced path is a PROJECT FILE
reference, not an external target. The 2026-10-19 form of the rule read "a relative path ending in
`.ps1`"; the ARBITER asks a different question — "is this path one of the PROJECT's admitted files?"
(`pathTargetInProject`, `script/m14/incoming-rule.ts`) — and the two disagreed on three axes, each
MEASURED:

- **THE EXTENSION.** The gate admits `powershell: "ps1,psm1,psd1"` (`incoming-gate.ts:134`) and
  `pathTargetInProject` matches the admitted list by SUFFIX, so the extension is irrelevant to the
  arbiter and decisive to the rule. Population census by the arbiter's own match (1,181 files /
  30 repos): **47** distinct target spellings name an admitted project file — **26** `.ps1`,
  **13** `.psm1`, **8** `.psd1`.
- **THE SEPARATOR.** The old rule required one; the arbiter's suffix match does not — a bare
  `Helper.psm1` matches any admitted file with that basename.
- **THE ABSOLUTE CASE.** `/usr/lib/x.ps1` and `C:\x.ps1` were WITHHELD — a TRUE claim thrown away,
  because the gate's project facts are REPO-RELATIVE (`path.relative(repoRoot, abs)`,
  `incoming-gate.ts:577`) and no admitted path can answer an absolute norm.

**THE SECOND REFUTED CLAIM.** `powershell/test/powershell/Modules/Microsoft.PowerShell.Security/
FileCatalog.Tests.ps1:365` and `:366` publish `uses -> DSCResources\UserConfigProviderModVersion1\
UserConfigProviderModVersion1.psm1` with `externalTarget: true`, and that file IS in the project; the
arbiter's own `verifyExternalClaim` answers `externalRefuted` on both. The lane's `extFAIL` column
read 0 anyway, because PS38 withholds the arbiter-readable key on a bare owner and `externalTarget`
is not in `EXTERNAL_KEYS` — **the false claim was published AND INVISIBLE.**

**THE RULE AS IT NOW STANDS.** Withhold the externality reading when the target ends in one of the
lane's ADMITTED spellings (`.ps1`, `.psm1`, `.psd1`) AND its spelling is a RELATIVE path — not
`/unix-rooted`, not `C:\drive`, not a URI scheme. This is the bash lane's rule ("withheld for all
non-absolute paths now, kept only for /unix-rooted and C:\ drive", RESOLUTION-LEDGER) applied to
powershell's own admitted spellings.

**THE CLASS, NAMED.** THE ESCAPE WAS WRITTEN FROM A SPELLING RATHER THAN FROM THE ARBITER'S
QUESTION, and a spelling-keyed answer to a project-keyed question hides in BOTH directions: it
publishes false claims and discards true ones.

**PINS.** Fixture `powershell/relative-path-psb18` — 9 path rows, the production shape (a
CONSTANT-KEY ELEMENT ACCESS, published UNQUOTED), **8 of the 9 FLIP** between the 2026-10-19 rule and
this one, and the 9th is a control that does not. Two mutants, both CAUGHT, each failing only that
fixture: `relative-path-psb18-escape-narrowed` (the 2026-10-19 rule VERBATIM) and
`relative-path-psb18-escape-widened`. Arms, the row-level reconciliation and the wall dispositions:
`validation/m14/verification/POWERSHELL-VERDICT-2026-10-20.md`.
```

**THE DOC ALSO STATES A COUNT THAT THIS LANE'S CHANGE MAKES A COUNT THAT MUST BE UPDATED:** the
doc's tail says `design_decision.decisions` "exists (10)". If the spec row above is added, that
becomes 11 and the doc's sentence changes with it.

---

## 3. WHAT THIS LANE DID NOT DO, AND WHY

- It did not edit `docs/analyzers/powershell.md` or
  `script/m14/spec/powershell-completeness.json` — **they are not in this lane's write scope**, and
  the analyzer's co-edit list is a CONTRACT, and a contract a lane cannot see is a contract the lane
  must not silently break. It states the contract, measures what it obliges, and proposes the text.
- It did not run the spec-shape audit against the proposed row, because the row is not applied. **The
  Lead's verification should, and the row is written so the audit's question has the same answer it
  had for PSD7.**

**THE MEASUREMENT THAT MAKES THIS PROPOSAL WORTH APPLYING:** the doc and the spec are ONE RULE
BEHIND today, and TWO behind after this lane's change. The rule that closed the fleet's FIRST
refuted-claim incident — the rule whose narrowness this lane then found the SECOND refuted claim
through — **is recorded in neither file.** The file that changed is documented; the files that say
what the change MEANS are not.
