# PROPOSAL — admit `yaml` to the gate (two Lead-owned lines + one instrument defect)

**From: yaml lane owner. Status: 7/8 sections pass; section B is blocked on two items in
Lead-owned files, not on lane work. Lane memory: `validation/m14/verification/YAML-STATE.md`.**

## THE TWO LINES

**1 · `script/m14/completeness-inventory.ts`, yaml's config row (line ~1084).** Add `"uses"`:

```ts
requiredKinds: ["contains", "extends", "imports", "references", "calls", "exports", "overrides", "uses"],
```

`uses` is a real yaml emission (`real-yaml-analyzer.ts:1814` `resolveAliases`: `type = alias.merge ? Extends :
Uses` — a non-merge alias READS the anchored declaration). It is **now fixture-pinned** by
`validation/m14/fixtures/yaml/uses-alias-nonmerge.expectation.json` (positive `uses` row with
`meta.evidenceClass: usage_contextual`, `meta.relationshipType: yaml_alias`, resolved; plus two forbid rows
holding the merge arm (`extends`) and the plain alias apart). So the forward check (`required => pinned`) stays
green. Fixtures after adding the pin: **37 pass / 0 fail**.

**2 · `GATED_LANGS` (same file).** Add `"yaml"` after the two lines above are applied and section B is re-run
green. This is the admission line; do not add it before the reader defect below is fixed.

## THE INSTRUMENT DEFECT SECTION B IS ALSO READING (`instantiates`)

**`instantiates` is NOT an emitted yaml kind.** The inventory's `emittedKinds()` (`completeness-inventory.ts:1215`)
reads `fs.readdirSync(cfg.fixturesDir)`, drops only `.json`, and parses **every remaining FILE** with
`ASTEngine.parseFile`. `validation/m14/fixtures/yaml/` contains **four committed `.ts` probe instruments**
(`lane-census.ts`, `ontology-census.ts`, `marker-reach-probe.ts`, `workflow-call-probe.ts`) and dozens of `.txt`
census artifacts. Parsing a `.ts` file runs the **TypeScript** analyzer, and its `instantiates` edges are
attributed to yaml.

Evidence, in order:
* The 4 offending edges were located by running the same parse loop: `marker-reach-probe.ts:15`
  `marker-reach-probe -> Cls`, `ontology-census.ts:139 main -> ParserClass`, `workflow-call-probe.ts:20`,
  `lane-census.ts:137` — **all from `.ts` probes, zero from any `.yaml` source**.
* The yaml analyzer has **no `instantiates` emission site**: the string occurs once, at
  `real-yaml-analyzer.ts:2764`, as an evidence-class case label. A `grep -c Instantiates` = 0.
* The lane's contract already rules it: YAML-D11 "`instantiates` — grammar-absence", and the whole-corpus
  census records 0 edges / 0 sites / no node type that could express construction.

**Recommended fix (data-side, no yaml change):** add a source-extension field to `LangConfig` (e.g.
`sourceExts: [".yaml", ".yml"]`) and filter both `emittedKinds()` and the `pinned` reader by it. **Do not
move the `.ts` probes**: the spec and `ruling-attestation.json` cite `validation/m14/fixtures/yaml/lane-census.ts`
and `ontology-census.ts` as committed instruments at those exact paths (`yaml-completeness.json:125,402`), and
moving them would break documented usage for a reading bug that belongs in the reader.

## VERIFICATION AFTER APPLYING

```
bun run script/m14/completeness-inventory.ts --lang yaml     # expect: 8/8 pass
bun run script/m14/run-fixtures.ts --lang yaml               # expect: 37 pass / 0 fail
```

Then the central `--update-baseline` sweep for sections E/F is yours (the scoped run currently reads
`kubernetes:yaml missing=0, unexplained=0` and 31.459 ms/file, but the canonical evidence is the sweep's).
Then `GATED_LANGS` gets the lane.

## WHAT WAS NOT DONE, STATED

No analyzer edit and no spec edit: the lane's emitted behaviour was already correct and all 8 kinds are named
in `yaml-completeness.json` `coverage.implemented`. The `sourcePath` claim kind is **not** emitted by this lane
(`grep -c sourcePath src/ast/real-yaml-analyzer.ts` = 0), so the project-absolute refiner cannot reach its
shapes; the rows the Lead asked about sit at **`ext?` 184 (imports 155 + references 29)** in the recorded
whole-population read, with `extOK 10,014` and `unresolved 696`. Adopting `sourcePath` for the path-shaped
targets is a real resolution option but an analyzer change with its own before/after, not an admission need.
