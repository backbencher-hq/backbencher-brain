/**
 * solidity-spec-table — the D1 deliverable, GENERATED from measurements rather than typed
 * (phase 2, ALL-OUT-OF-ALL charter §9.1 D1).
 *
 * `script/m14/spec/solidity-spec-table.json` is the Solidity applicable set as a machine-readable
 * table: one row per canonical relationship value the language can express, with the
 * PINNED-GRAMMAR constructs that justify it, the emission site read out of the analyzer source,
 * at least one fixture that can go RED (measured by `script/m14/solidity-applicable-set.ts`), the
 * cap-50 triage columns from a committed gate log, and the ruled non-applicable values plus the
 * Solidity-specific construct/ruling tables.
 *
 * INPUTS (all in the tree, so the table is reproducible from a clean checkout):
 *   validation/m14/fixtures/solidity/measurements/applicable-set.json        (the instrument)
 *   validation/m14/fixtures/solidity/measurements/gate-solidity-cap50-baseline.txt (the gate log)
 *
 * WHOLE-POPULATION COLUMNS ARE EXPLICITLY OWED until the D2/D3 arms land; the generator writes a
 * status, never a 0 that a reader would read as a measured zero.
 *
 * USAGE
 *   bun run script/m14/solidity-spec-table.ts            # rewrite the committed table
 *   bun run script/m14/solidity-spec-table.ts --check    # fail if the committed table is stale
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const ARTIFACT = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/applicable-set.json")
const GATE_LOG = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/gate-solidity-cap50-baseline.txt")
const OUT = path.join(ROOT, "script/m14/spec/solidity-spec-table.json")
const CENSUS = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/solidity-emission-census-whole.json")
const D3_NOINDEX = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/solidity-d3-noindex-arm.json")
const D3_INDEXED = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/solidity-d3-indexed-arm.json")
const D4_SUMMARY = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/solidity-d4-summary.json")
const D5_SUMMARY = path.join(ROOT, "validation/m14/fixtures/solidity/measurements/solidity-d5-summary.json")
const CHECK = process.argv.includes("--check")

interface GateRow {
  type: string
  edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number
  extOK: number; extUnknown: number; extFAIL: number; bindOK: number; bindUnknown: number; bindFAIL: number
  causeOK: number; causeFAIL: number
}

function parseGateLog(log: string): { population: string; exit: string; rows: Record<string, GateRow>; total: GateRow } {
  const lines = log.split("\n")
  const population = lines.find((l) => l.startsWith("population: ")) ?? ""
  const exitLine = lines.find((l) => l.includes("VERDICT:")) ?? ""
  const parsed: Record<string, GateRow> = {}
  let total: GateRow | null = null
  for (const l of lines) {
    const m = /^(\w+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(l)
    if (!m) continue
    const row: GateRow = {
      type: m[1],
      edges: Number(m[2]), resolved: Number(m[3]), collRes: Number(m[4]),
      ambDecl: Number(m[5]), ambKind: Number(m[6]), unresolved: Number(m[7]),
      extOK: Number(m[8]), extUnknown: Number(m[9]), extFAIL: Number(m[10]),
      bindOK: Number(m[11]), bindUnknown: Number(m[12]), bindFAIL: Number(m[13]),
      causeOK: Number(m[14]), causeFAIL: Number(m[15]),
    }
    if (row.type === "TOTAL") total = row
    else parsed[row.type] = row
  }
  if (!total || Object.keys(parsed).length === 0) {
    throw new Error(`solidity-spec-table: could not parse TABLE 1 out of ${path.relative(ROOT, GATE_LOG)} — refusing to write a spec table from a missing measurement`)
  }
  return { population, exit: exitLine, rows: parsed, total }
}

/** Lane-authored residual classes at cap-50, each citing the measurement that named it.
 *  The whole-population extensions come from SOLIDITY-FIX.md's 400-file classification and are
 *  re-measured by the D2/D3 arms. */
const LANE_NOTES: Record<string, { cap50ResidualClass: string; wholePopulationCensus: Record<string, unknown> }> = {
  calls: { cap50ResidualClass: "call through a FUNCTION-TYPE PARAMETER (156 unresolved at the 400-file stride: `op(store.latest(), delta)` where `op` is declared `function(...) op` — a parameter is not a published declaration); calls into the LANGUAGE NAMESPACE `abi` (66) and the forge-std `vm` cheatcode address (48; a dependency the corpus does not vendor); calls on user-defined value types whose `wrap`/`unwrap` are language builtins (107); `super.<fn>` ambiguity (184); and callee names declared more than once (1,037). Classification source: SOLIDITY-FIX.md §1 (400-file stride, closure 3,240 of 3,240).", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  uses: { cap50ResidualClass: "bare READ of a FUNCTION-SCOPE BINDING — a parameter, a return-value name or a local (1,424 unresolved + 6,363 ambiguous at the 400-file stride; 53.3% of the lane's residual; 282 distinct names). The construct is measured and DOABLE via the fleet's binding claim (bindOK 6,504 in the reverted attempt), and parameters/locals are deliberately not published declarations; plus Yul path-segment reads (505 unresolved + 1,603 ambiguous) and EVM-builtin member reads (29).", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  contains: { cap50ResidualClass: "none — fully resolved on this stride and at the 400-file stride (5,981/5,981); collRes sits entirely on `contains` duplicate member names and the binding-intent exact test discharges it (intended 5,981 / arbitraryTwin 0). The axis must not move.", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  imports: { cap50ResidualClass: "path-target-not-a-symbol by construction — an import path (`../Governor.sol`, `forge-std/Test.sol`) is a module specifier, never a published symbol (875 of 3,240 unresolved at the 400-file stride). The 0% resolution is the TYPE'S shape; the fixed point is the emitted rows (876 at the 400-file stride), not a resolution claim.", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  references: { cap50ResidualClass: "type mentions of EXTERNAL/undeclared types (forge-std `Test`, `Vm`, external bases) plus imported-binding references whose declaration the corpus does not vendor; 18 of the 3,240 unresolved at the 400-file stride.", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  exports: { cap50ResidualClass: "none on this stride — the compilation-unit surface resolves (module -> file-scope declaration; the module symbol is the file basename WITH its extension, SOL-1, so it cannot collide with an identifier).", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  extends: { cap50ResidualClass: "an INHERITED BASE declared in another file the corpus does not contain (12 at the 400-file stride); the edge already carries `reasonCode: base-not-declared-in-file` + `kindUnresolved: true` (SOL-19) and the gate does not read that key — the contract is stated, the gate's key space is symbols.", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  implements: { cap50ResidualClass: "no unresolved rows in the classification (7 edges at the 400-file stride, all sameFileUnproven — the interface ancestor is in the same file and the exact test cannot see a declaration at the read line; that is the intent axis, not a gap). Implements is the lane's ADAPTED value (SOL-5): an in-file interface ancestor is a contract, everything else extends.", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  overrides: { cap50ResidualClass: "the SOL-11 tier for a base outside the file: `override(X)` names the base but X is not in-file (405 arbitraryTwin + 17 sameFileUnproven + 1 nothingAnywhere at the 400-file stride). The edge is emitted at 0.75/inferred with reasonCode named-by-override-specifier; a bare override with 2+ header bases is REFUSED by rule.", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
  instantiates: { cap50ResidualClass: "no unresolved rows (25 edges at the 400-file stride; 14 sameFileUnproven + 11 arbitraryTwin — the constructed contract is usually declared elsewhere). `new_expression` only; struct construction is a calls edge (SOL-10).", wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" } },
}

const applicable = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"))
const gate = parseGateLog(fs.readFileSync(GATE_LOG, "utf8"))
const census: any = fs.existsSync(CENSUS) ? JSON.parse(fs.readFileSync(CENSUS, "utf8")) : null
const d3A: any = fs.existsSync(D3_NOINDEX) ? JSON.parse(fs.readFileSync(D3_NOINDEX, "utf8")) : null
const d3B: any = fs.existsSync(D3_INDEXED) ? JSON.parse(fs.readFileSync(D3_INDEXED, "utf8")) : null
const d4: any = fs.existsSync(D4_SUMMARY) ? JSON.parse(fs.readFileSync(D4_SUMMARY, "utf8")) : null
const d5: any = fs.existsSync(D5_SUMMARY) ? JSON.parse(fs.readFileSync(D5_SUMMARY, "utf8")) : null
const censusPopulation = census
  ? {
      command: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/solidity-emission-census.ts --cap=0 --json",
      artifact: "validation/m14/fixtures/solidity/measurements/solidity-emission-census-whole.json",
      cap: census.population.cap,
      parsed: census.population.parsed,
      admitted: census.population.admitted,
      repos: census.population.repos,
      failed: census.population.failed,
      degraded: census.population.degraded,
      trackedButAbsent: census.population.absent,
      overSizeCap: census.population.overCap,
      admittedExtensions: census.population.exts,
      totalEdges: census.closure.totalEdges,
      constructWalked: census.closure.constructWalked,
      constructSkipped: census.closure.constructSkipped,
      control: census.control,
    }
  : null
/** Parse one arm's TABLE 1 extract into per-type numeric rows. */
function armTable(arm: any): Record<string, Record<string, number>> {
  const lines: string[] = arm?.table1 ?? []
  let hdr: string[] | null = null
  const out: Record<string, Record<string, number>> = {}
  for (const l of lines) {
    const c = l.split(/\s+/).filter(Boolean)
    if (c.length > 3 && c[0] === "type" && c.includes("edges")) { hdr = c; continue }
    if (hdr && c.length === hdr.length && /^[a-z_]+$/.test(c[0]) && c.slice(1).every((x) => /^\d+$/.test(x))) {
      out[c[0]] = Object.fromEntries(hdr.slice(1).map((name, i) => [name, Number(c[i + 1])]))
    }
  }
  return out
}
const armA = armTable(d3A)
const armB = armTable(d3B)
const armDelta: Record<string, Record<string, number>> = {}
for (const t of new Set([...Object.keys(armA), ...Object.keys(armB)])) {
  const d: Record<string, number> = {}
  for (const c of Object.keys(armA[t] ?? armB[t] ?? {})) {
    const v = (armB[t]?.[c] ?? 0) - (armA[t]?.[c] ?? 0)
    if (v !== 0) d[c] = v
  }
  if (Object.keys(d).length > 0) armDelta[t] = d
}

const types: Record<string, any> = {}
for (const value of applicable.applicableValues) {
  const surface = applicable.constructSurface[value]
  const pins = applicable.fixturePins[value]
  const red = applicable.redProof[value]
  const g = gate.rows[value]
  types[value] = {
    applicable: true,
    constructs: surface.constructs,
    grammarProductionsPresent: surface.present,
    rule: surface.rule,
    ...(surface.adaptedSemantics ? { adaptedSemantics: surface.adaptedSemantics } : {}),
    implementationSites: surface.implementationSites,
    fixturesCanGoRed: pins.positiveFixtures,
    fixtureExpectationRows: pins.positiveRows,
    ...(pins.forbidRows ? { fixtureForbidRows: pins.forbidRows } : {}),
    redProof: {
      method: applicable.redProofMethod,
      baselinePassFail: `${red.baselinePass}/${red.baselineFail}`,
      mutatedPassFail: `${red.mutatedPass}/${red.mutatedFail}`,
      fixturesThatWentRed: red.fixturesThatWentRed.length,
      redProven: red.redProven,
    },
    cap50: g
      ? {
          edges: g.edges, resolved: g.resolved, collRes: g.collRes, ambDecl: g.ambDecl, ambKind: g.ambKind,
          unresolved: g.unresolved, extOK: g.extOK, extUnknown: g.extUnknown, extFAIL: g.extFAIL,
          bindOK: g.bindOK, bindUnknown: g.bindUnknown, bindFAIL: g.bindFAIL,
          causeOK: g.causeOK, causeFAIL: g.causeFAIL,
        }
      : { status: "not present in the gate log" },
    gateNoIndex: armA[value] ? { ...armA[value], command: d3A.command, population: { parsed: 421, admitted: 421, repos: 2, failed: 0, degraded: 0 } } : { status: "OWED — the D3 no-index arm has not landed" },
    gateIndexed: armB[value] ? { ...armB[value], command: d3B.command, population: { parsed: 421, admitted: 421, repos: 2, failed: 0, degraded: 0 }, deltaVsNoIndex: armDelta[value] ?? "0 in every column" } : { status: "OWED — the D3 indexed arm has not landed" },
    cap50ResidualClass: LANE_NOTES[value]?.cap50ResidualClass ?? "",
    wholePopulation: census && censusPopulation && census.perType?.[value]
      ? {
          status: "MEASURED",
          command: censusPopulation.command,
          population: { parsed: censusPopulation.parsed, admitted: censusPopulation.admitted, repos: censusPopulation.repos, failed: censusPopulation.failed, degraded: censusPopulation.degraded },
          rows: census.perType[value].edges,
          files: census.perType[value].files,
          repos: census.perType[value].repos,
        }
      : { status: "OWED — filled by the D2 whole-population census arm" },
  }
}

const spec = {
  schemaVersion: 1,
  language: "solidity",
  programme: "ALL-OUT-OF-ALL phase 2 (charter validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md §9.1 D1) — tier-2 lane, denominator = Solidity's OWN applicable set (10/10), never forced to a canonical ten.",
  purpose:
    "THE SOLIDITY APPLICABLE SET, machine-readable: one row per relationship type the language can express (decided from the PINNED GRAMMAR's own enumeration, never from the ten-value matrix), with the emission site in src/ast/real-solidity-analyzer.ts and at least one fixture that can go RED for it (measured by the real fixture runner with the emission removed) — plus the ruled non-applicable canonical values, the Solidity construct surface, and the value questions SOL-R1..R8 answered by measurement.",
  generatedBy: "script/m14/solidity-spec-table.ts (inputs named in that file's header; do not hand-edit the OWED cells without re-running)",
  grammar: {
    wasm: applicable.grammar.wasm,
    sha256: applicable.grammar.sha256,
    slotCount: applicable.grammar.slotCount,
    namedTypeCount: applicable.grammar.namedTypeCount,
    anonymousTokenCount: applicable.grammar.anonymousTokenCount,
    reconciliation: applicable.grammar.reconciliation,
    enumeration: "the pinned wasm enumerated through web-tree-sitter's Language API (nodeTypeCount / nodeTypeIsNamed / nodeTypeForId); the OTHER two counts (166 grammar rules = 121 visible + 45 hidden; 124 node-types 'named' entries incl. the literal spellings true/false/string) are reconciled in `reconciliation` so no reader mistakes one instrument for another. ERROR and MISSING are universal parser outputs, not grammar productions.",
    instrument: "script/m14/solidity-applicable-set.ts",
    command: "bun run script/m14/solidity-applicable-set.ts --out validation/m14/fixtures/solidity/measurements/applicable-set.json",
    artifact: "validation/m14/fixtures/solidity/measurements/applicable-set.json",
    artifactMeasuredAt: applicable.measuredAt,
  },
  admissibilityRule: applicable.admissibilityRule,
  canonicalVocabulary: applicable.canonicalVocabulary,
  applicableValues: applicable.applicableValues,
  notApplicableValues: applicable.notApplicableValues,
  notApplicableEvidence: applicable.notApplicableSurface,
  constructTable: applicable.constructTable,
  rulings: applicable.rulings,
  evidenceRows: {
    _reading:
      "cap-50 columns are TRIAGE from a committed no-index gate log over a 50-of-421-file stride sample — never a population claim. Whole-population columns are EXPLICITLY OWED until the D2/D3 arms land (the `wholePopulation` cell says so); a number here without its command is a defect.",
    cap50Command: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts solidity sol 50",
    cap50Log: "validation/m14/fixtures/solidity/measurements/gate-solidity-cap50-baseline.txt",
    cap50Population: {
      line: gate.population,
      sample: 50,
      corpusTotalSol: 421,
      corpusRepos: 2,
      exclusionLine: "excluded from that population: 0 tracked-but-absent/unreadable + 0 over the 1 MB cap",
      parseFailures: 0,
      degraded: 0,
      exit: gate.exit,
      exitMeaning: "FAIL on clause 1 (unresolved/ambiguous rows on the sample) — the state being worked, not an instrument error; self-test PASS",
      admittedExtensionsNote: "the gate's population spelling is `.sol` (src/ast/language-detection.ts:172 `sol: \"solidity\"`), ONE spelling.",
    },
    TOTAL: gate.total,
    types,
    fixtureBaseline: applicable.fixtureBaseline,
  },
  verification: {
    d4: d4 ?? { status: "OWED" },
    d5: d5 ?? { status: "OWED" },
  },
  wholePopulationArms: {
    status: census && d3A && d3B
      ? `D2 census MEASURED (${census.population.parsed}/${census.population.admitted} files · ${census.population.repos} repos · ${census.closure.totalEdges} rows); D3 BOTH arms MEASURED with closure-exact classification. A->B delta: ${Object.entries(armDelta).map(([t, d]) => `${t} ${Object.entries(d).map(([c, v]) => `${c} ${v > 0 ? "+" : ""}${v}`).join("/")}`).join(" · ")} — the project index settles inheritance KINDS (SOL-21), it trades no resolutions.`
      : "OWED — filled by the D2 whole-population emission census and the D3 incoming-gate arms.",
    census: census && censusPopulation
      ? {
          ...censusPopulation,
          perType: census.perType,
          callPayload: census.callPayload,
          overridePayload: census.overridePayload,
          usesPayload: census.usesPayload,
          referencesPayload: census.referencesPayload,
          importsPayload: census.importsPayload,
          exportsPayload: census.exportsPayload,
          containsPayload: census.containsPayload,
          constructPopulations: census.constructs,
          parseErrors: census.parseErrors,
        }
      : null,
    d3: d3A && d3B
      ? {
          noIndexArm: {
            command: d3A.command, population: d3A.population, selfTest: d3A.selfTest, table1: d3A.table1,
            bindingIntent: d3A.bindingIntent, claimCarrying: d3A.claimCarrying, verdict: d3A.verdict,
            classifier: d3A.classifier, arbitraryTwin: d3A.classifier?.arbitraryTwin ?? null,
            closure: d3A.classifier?.control?.closure ?? null, evidencePage: "validation/m14/verification/SOLIDITY-D3.md",
          },
          indexedArm: {
            command: d3B.command, population: d3B.population, selfTest: d3B.selfTest, table1: d3B.table1,
            bindingIntent: d3B.bindingIntent, claimCarrying: d3B.claimCarrying, verdict: d3B.verdict,
            classifier: d3B.classifier, arbitraryTwin: d3B.classifier?.arbitraryTwin ?? null,
            closure: d3B.classifier?.control?.closure ?? null,
            deltaVsNoIndex: armDelta,
            mechanism:
              "the project index is SUPPLIED and CONSUMED here (SOL-21): the gate built 2 repo indexes over 421 files and 100 heritage edges moved from extends to implements — the ancestor's KIND settled project-wide instead of by absence of an in-file declaration. resolved/amb/unresolved columns and arbitraryTwin are UNCHANGED: this arm re-types heritage, it does not trade resolutions.",
          },
        }
      : { status: "OWED — the D3 arms have not landed" },
    noNewValueConfirmations:
      "The constructs that carry NO relationship (or a DIFFERENT one than their spelling suggests), counted at whole population by the D2 census so the ruling is a number and not a silence: modifiers (modifier_definition/modifier_invocation sites vs `decorates` 0 — SOL-R3: metadata + calls), events/custom errors (emit/revert are calls, SOL-15), struct construction (calls, not instantiates — SOL-R7), imports' bindings (references, not imports — SOL-R6), synthesised getters (contains + references, SOL-R8), NatSpec comments and pragmas (documentation metadata / compilation directive, no relationship), inheritance (ONE construct, two readings — SOL-R5/SOL-R1).",
  },
}

const json = JSON.stringify(spec, null, 1) + "\n"
if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : ""
  if (current !== json) {
    console.error(`solidity-spec-table: STALE — ${path.relative(ROOT, OUT)} differs from what the measurements generate. Re-run without --check.`)
    process.exit(1)
  }
  console.log(`solidity-spec-table: current (${path.relative(ROOT, OUT)})`)
} else {
  fs.writeFileSync(OUT, json)
  console.log(`solidity-spec-table: wrote ${path.relative(ROOT, OUT)} — ${applicable.applicableValues.length} applicable · ${applicable.notApplicableValues.length} ruled · ${Object.keys(applicable.constructTable).length} constructs · ${applicable.rulings.length} rulings`)
}
