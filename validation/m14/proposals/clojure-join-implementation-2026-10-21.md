# THE QUALIFIED-NAME JOIN — proposal, landed patch, and what it measured

Author: Muhammad Ishaq Khan (the clojure lane). Date: 2026-10-21.
Status: the patch was landed by the Lead as commit `030c10dc1` (the arbiter `script/m14/incoming-rule.ts` and the gate `script/m14/incoming-gate.ts`, the Lead's files). The lane never edited either file.

Rewritten compactly on the Lead's instruction: the earlier revision was 111,401 bytes, of which 26,729 were arrow glyphs. A document that does not carry information is a document that hides the information it carries.

## 1. THE PROBLEM

Production resolves an imported target by a project-scoped QUALIFIED-NAME match (`_res_qname` over the store's symbols), and fills `target_symbol_id` from that match only when the qualified name is held by exactly one declaration. The arbiter knew nothing about that strategy, so rows production resolves came back ambiguous. The join is that strategy, as one rule.

## 2. THE SPEC (the Lead's, verbatim)

1. The shape test is "THE TARGET CONTAINS A `/`" — not `isBare`. A join gated on `isBare` moves 1 row, not 841 (measured).
2. The join branch is the probe's join branch, pasted verbatim.
3. The namespace source is the analyzer's `(ns ...)` MODULE symbol's name. The file's namespace is not a file-level fact: `in-ns` can give a file several, and the namespace is a property of the form.
4. The answer comes from the gate's own `projectDecl.get(repo)` map, holding the qualified form `ns/target`, with a count of exactly one.
5. It is passed into `classifyEdge(...)` as a new optional parameter after `edgeFile?: string`, at BOTH call sites.
6. In the arbiter, the join goes between the tie-break and the ambiguous return; the tie-break stays verbatim; exactly one qualified declaration resolves the row.

One rule in one place. Not a second oracle.

## 3. THE TWO LOAD-BEARING MEASUREMENTS

### 3.1 THE SHAPE TEST IS "THE TARGET CONTAINS A `/`"

A target that is already qualified is its own qualification; a bare target is qualified by its file's namespace. Measured on the clojure population, not reasoned.

The probe's join branch, verbatim (`validation/m14/fixtures/clojure/clojure-project-index-probe.ts`):

```ts
let joined = false
let joinDetail = ""
let joinQualified = ""
if (idx) {
  if (target.includes("/")) {
    joinQualified = target
    const c = idx.symbolCounts.get(target) ?? 0
    joinDetail = `${target} (count ${c})`
    joined = c === 1
  } else if (ns !== "") {
    const q = `${ns}/${target}`
    joinQualified = q
    const c = idx.symbolCounts.get(q) ?? 0
    joinDetail = `${q} (count ${c})`
    joined = c === 1
  } else {
    joinDetail = "the file declares no namespace"
  }
} else {
  joinDetail = "no index for the repository"
}
```

What the branch does NOT contain: `isBare`. The probe's `isBare` is used only in the floor's classification.

### 3.2 THE NAMESPACE'S SOURCE

The per-symbol `scope` is NOT a reliable carrier of the file's namespace. Measured over the population: 500 files agree with the production's per-file namespace, 13 disagree, 88 files carry more than one scope, 0 files carry none. The 88 multi-scope files and the 13 disagreements are the nested-type forms, whose scopes are DOT-qualified nested names (`clojure.core.VecNode`, `foo.foo`) rather than namespaces at all. The analyzer's `currentNamespace` is a running value, reassigned at each `ns`/`in-ns` form, so a file may carry several namespaces and the per-symbol scope is a range/shadow mechanism, not a file property.

The `(ns ...)` MODULE symbol's NAME is the namespace, exactly: 587 files have a module symbol, 543 agree with the production's per-file namespace, 44 disagree — and all 44 are files with NO namespace form at all, where the analyzer emits a module symbol named `user`. 0 files have no module symbol.

So the production's `clojureFileNamespace` (which matches only the `ns` head, not `in-ns`) and the analyzer's module symbol name are the same source for every file that declares a namespace. The price is 841 under either. It is 840 only if the namespace is taken from the per-symbol scope, and the scope must not be used.

## 4. THE KEY SPACES, AND WHY THE PRICE WAS 841 AND NOT 854

A price is a number in a key space, and the key space is part of the price. Two numbers existed: 854 in the INDEX's key space (the spec's extraction) and 841 in the GATE's key space (the analyzer's publication). The join looks in the analyzer's publication, so its reach was priced at 841. The 13-row difference is named in the lane's verdict page.

## 5. WHAT THE LANDED PATCH DOES, IN FIVE PLACES

1. `incoming-rule.ts`: `classifyEdge` gains one optional parameter, `qualifiedJoin`, after `edgeFile?: string`. `undefined` leaves the row exactly as it was.
2. `incoming-rule.ts`: one rule, between the tie-break and the ambiguous return. The tie-break is untouched. The join resolves the row only when the count is exactly one.
3. `incoming-gate.ts`: `nsByFile`, the per-file namespace, collected from the analyzer's `(ns ...)` module symbol (kind `module`, name = the namespace). The first module symbol in a file is that file's first namespace form.
4. `incoming-gate.ts`: `qualifiedJoinFor`, the shape test and the lookup, read from the gate's own `projectDecl` map — the same map the name model uses, so the answer is a lookup, not a second count and not a second key space.
5. `incoming-gate.ts`: the join is passed at BOTH `classifyEdge` call sites.

The patch was verified with `git apply --check` against the tree it was written for, and was generated from a real `diff -u` of edited COPIES (never a hand-written `@@` header).

## 6. WHAT THE JOIN ACTUALLY FIRES ON

The Lead's measurement on the clojure repo (gate `91c3a84fc`): 156 rows resolved, of which the SLASH branch was asked about 1,267 rows and answered none, and the NAMESPACE branch was asked about 17,579 rows and answered 156. The 156 rows came from the NAMESPACE branch, because the clojure analyzer publishes the `(ns ...)` form as a module-kind symbol, so a BARE target is qualified as `ns/target` by the file's namespace. The slash branch answered none, because a slash-carrying clojure target's exact spelling is not a key in the project's own declaration map.

The generalisation, which changes what the next instrument must be: THE REACH IS THE ANALYZER'S OWN KEY SPACES, not the shape test. Only four analyzers publish a module-kind symbol today (clojure, erlang, rust, typescript), so for every other language the namespace branch cannot fire at all, and the slash branch fires only where that analyzer's own qualified names are spelled with slashes. A cell whose join price is zero is a structural fact in those languages, not a coincidence. The next thing the join needs is not a wider shape test; it is a key space that holds the analyzer's own spellings.

## 7. THE FINDING ON THE CLOJURE POPULATION: 994, NOT 841

The lane's own population pair, run on the whole population (646 files / 3 repos, farm root `BB_CORPUS_ROOT=$PWD/.corpus`, the 43,324-edge population), against the landed patch:

| | before | after | movement |
|---|---|---|---|
| resolved | 28,911 | 29,905 | **+994** |
| amb(decl) | 2,139 | 1,145 | -994 |
| every other class | — | — | unchanged |

The gate's own counter agrees with its own number: `994 row(s) resolved by the qualified-name join · slash branch: 0 of 12262 row(s) asked · namespace branch: 994 of 31062 row(s) asked`.

The lane's probe priced the join at **841** in the gate's key space. **THE GATE SAYS 994. THE DIFFERENCE IS 153 ROWS.** Per the Lead's instruction, that difference is named here, not smoothed away. Two measurements differ and the lane does not yet know which is the price of the join:

- The gate counts the join's reach among the rows it ASKS about, in its own `projectDecl` map (the analyzer's publication).
- The probe counts the join's reach among rows whose qualified form the ANALYZER PUBLISHES, using the INDEX's `symbolCounts` for the count.

Both are the same join; they differ in where the COUNT is read and in what the row set is restricted to. The 153-row gap is the size of that difference, and it is not yet attributed to a specific key-space asymmetry.

THE CLASSIFICATION IS NOT YET CLOSED ⇒ the lane's class figure for the clojure population after the join is **NOT YET STATED**, because two instruments disagree about the movement and a class computed from a disputed movement is not a class.

### 7.1 A SECOND, SEPARATE DEFECT IN THE LANE's OWN HARNESS

The lane's acceptance harness (`run-postjoin-pair.sh`) compares three things, and two of them are structurally unsatisfiable:

- it compares the INSTRUMENT's resolved column (28,911) against `28,911 + price` — but the instrument reads the PROBE's dump, and the probe's own classification does not apply the arbiter's join, so that column CANNOT move with the join;
- it compares the non-resolved dump's row count (14,413) against `14,413 - price` — the same reason;
- it compares the GATE's resolved column against `28,911 + price` — this one is the real check, and it is the one that fired.

So the harness's RED is partly a harness defect, not only a price disagreement. The fix is for the harness's AFTER arm to be produced by something that APPLIES the join (the gate's own whole-population dump), not by the probe's classification. Until then the harness's verdict is: THE GATE'S NUMBER IS THE MOVEMENT, and the price is open.

## 8. TWO LESSONS FROM THE LANDING

**A LOST HUNK.** The patch's six hunks were applied in one pass and the rule body was LOST: the count assertion ran against a stale string, so it passed and the edit went nowhere. The Lead found it by reading the landed file back, not by trusting the assert. The rule for the lane's own instruments: assert against the LIVE string immediately before the write, and verify the landed text by reading it back. The lane's probe extension was applied under that rule and its six sites were read back.

**A HARD LINK.** A backup tree of the gate was a HARD LINK to the Lead's live gate file, so a write through the copy would have written into the Lead's file. The lane checked the landed tree for the same hazard: `script/m14/incoming-gate.ts` (inode 1448254) and `script/m14/incoming-rule.ts` (inode 29495750) each have exactly ONE link, and `find -samefile` over the tree returns only the file itself. A tree copy must be rebuilt with `rm` plus a write, and the inodes must be proved.

## 9. WHERE THE NUMBERS LIVE

- Instrument: `validation/m14/fixtures/clojure/clojure-project-index-probe.ts`
- Population: 646 files / 3 repos. Root: `BB_CORPUS_ROOT=$PWD/.corpus` (the farm).
- Scope: the 43,324-edge population.
- Logs: `validation/m14/fixtures/clojure/lane-logs/index-effect.txt` and `index-effect.json`; the pair's log `postjoin-pair-2026-10-21b.log`.
- Acceptance test: `validation/m14/fixtures/clojure/run-postjoin-pair.sh` (see §7.1 for its two unsatisfiable checks).
- The lane's verdict page: `validation/m14/verification/CLOJURE-VERDICT-2026-10-20.md`.
- The fleet cell: `validation/m14/verification/FLEET-FLOOR-REMASURE.md`.
