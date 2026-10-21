/**
 * cpp-spec-table — the D1 deliverable, GENERATED from measurements rather than typed.
 *
 * `script/m14/spec/cpp-spec-table.json` is the C++ applicable set as a machine-readable
 * table (ALL-OUT-OF-ALL charter §9.1 D1): one row per canonical relationship value the C++
 * language can express, with the PINNED-GRAMMAR constructs that justify it, the emission
 * site read out of the analyzer source, at least one fixture that can go RED (measured by
 * `script/m14/cpp-applicable-set.ts`, not asserted), and the cap-50 triage columns from a
 * committed gate log — plus the ruled non-applicable values and the C++-specific
 * construct/ruling tables the D1 handoff asked for.
 *
 * INPUTS (all in the tree, so the table is reproducible from a clean checkout):
 *   validation/m14/fixtures/cpp/measurements/applicable-set.json      (the instrument)
 *   validation/m14/fixtures/cpp/measurements/gate-cpp-cap50-baseline.txt (the gate log)
 *
 * WHOLE-POPULATION COLUMNS ARE EXPLICITLY OWED until the D2/D3 arms land; the generator
 * writes `owed` rather than leaving a 0 that a reader would read as a measured zero.
 *
 * USAGE
 *   bun run script/m14/cpp-spec-table.ts            # rewrite script/m14/spec/cpp-spec-table.json
 *   bun run script/m14/cpp-spec-table.ts --check    # fail if the committed table is stale
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const ARTIFACT = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/applicable-set.json")
const GATE_LOG = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/gate-cpp-cap50-baseline.txt")
const OUT = path.join(ROOT, "script/m14/spec/cpp-spec-table.json")
const CENSUS = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-emission-census-whole.json")
const D3_NOINDEX = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-d3-noindex-arm.json")
const D3_INDEXED = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-d3-indexed-arm.json")
const D7_PRICE = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-w1-price.json")
const D7_WALLS = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-wall-disposition.json")
const CHECK = process.argv.includes("--check")

interface GateRow {
  type: string
  edges: number
  resolved: number
  collRes: number
  ambDecl: number
  ambKind: number
  unresolved: number
  extOK: number
  extUnknown: number
  extFAIL: number
  bindOK: number
  bindUnknown: number
  bindFAIL: number
  causeOK: number
  causeFAIL: number
}

/** Parse TABLE 1 out of the committed gate log. The parser FAILS LOUDLY on a missing table:
 *  a spec table built from an absent measurement must not be written. */
function parseGateLog(log: string): { population: string; exit: string; rows: Record<string, GateRow>; total: GateRow } {
  const lines = log.split("\n")
  const population = lines.find((l) => l.startsWith("population: ")) ?? ""
  const exitLine = lines.find((l) => l.startsWith("EXIT=")) ?? ""
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
    throw new Error(`cpp-spec-table: could not parse TABLE 1 out of ${path.relative(ROOT, GATE_LOG)} — refusing to write a spec table from a missing measurement`)
  }
  return { population, exit: exitLine, rows: parsed, total }
}

/** Lane-authored cells: the residual CLASS of the cap-50 sample per type, and the
 *  whole-population columns the D2/D3 arms fill. Every string here cites the measurement
 *  it rests on (the gate log's own worklist / CPP-RESIDUAL.md for the earlier whole-pop run). */
const LANE_NOTES: Record<string, { cap50ResidualClass: string; wholePopulationCensus: Record<string, unknown> }> = {
  calls: {
    cap50ResidualClass:
      "member-leaf calls on receivers declared outside the stride (the file's own project can answer them only when the declaring file is in the sample), plus C++ template FUNCTION heads whose callee is a template_function/qualified_identifier. The earlier whole-population residual analysis (`CPP-RESIDUAL.md`, 6,641 files) attributed 83% of the calls residual to declarations living in `.h` files the gate's discovery does not admit — a POPULATION boundary (proposal cpp-h-routing.md), declared here rather than folded into this type.",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  uses: {
    cap50ResidualClass: "member reads on receivers whose class is not in the sampled project slice; bare reads of names declared in headers outside the run.",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  contains: {
    cap50ResidualClass:
      "none on this stride — every contains edge resolved (1,891/1,891, collRes 571 = resolved picks among duplicate member names). The whole-population collRes axis is tracked separately: it must not grow when other types are fixed.",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  imports: {
    cap50ResidualClass:
      "path-target-not-a-symbol (442/443 on this stride) — declared by construction: an `#include` target is a module path, not a published symbol, and the no-index per-file axis cannot resolve it. The earlier whole-population run measured 45,091/45,829 (99.5%) in this class; the .h-route proposal measures the 924/990 quoted includes that DO name a repo file.",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  references: {
    cap50ResidualClass: "qualified type mentions whose declaring file is outside the stride (type_identifier/qualified_identifier leaves).",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  exports: {
    cap50ResidualClass: "no edges on this stride — the sample carries no export marker; the whole-population count is the type's evidence (the earlier residual run measured 1,527 edges / 692 resolved).",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  extends: {
    cap50ResidualClass: "bases declared in headers outside the run (the per-file model cannot see another file); on this stride 5 of 10 extend edges resolved and 5 name an undeclared-in-run base.",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  implements: {
    cap50ResidualClass: "no edges on this stride — an implements edge requires the BASE's body in the same file (in-file pure-virtual set); the whole-population count is the type's evidence (171 (derived→contract) pairs measured by the analyzer's own comment, re-measured by the D2 census).",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  overrides: {
    cap50ResidualClass: "member-leaf ambiguity (3 amb on this stride) — the target is the declared member's leaf, so two classes declaring a method of that name are two declarations; the intended base rides metadata.overriddenOwner. Whole-population state in CPP-RESIDUAL.md.",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
  instantiates: {
    cap50ResidualClass: "constructed types declared in a header outside the run (9 unresolved / 10 on this stride).",
    wholePopulationCensus: { status: "OWED — filled by the D2 whole-population census arm" },
  },
}

const applicable = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"))
const gate = parseGateLog(fs.readFileSync(GATE_LOG, "utf8"))
/** The D2 whole-population emission census, when it has landed. Absent => the cells stay
 *  explicitly OWED; a census from a different population than the one its file names is a
 *  defect, so the population block travels with every per-type number below. */
const census: any = fs.existsSync(CENSUS) ? JSON.parse(fs.readFileSync(CENSUS, "utf8")) : null
/** The D3 no-index whole-population gate arm + its closure-exact classifier. */
const d3: any = fs.existsSync(D3_NOINDEX) ? JSON.parse(fs.readFileSync(D3_NOINDEX, "utf8")) : null
const d3Indexed: any = fs.existsSync(D3_INDEXED) ? JSON.parse(fs.readFileSync(D3_INDEXED, "utf8")) : null
/** The D7 four-bucket partition of the W1 wall + the whole-wall disposition ledger. Both are
 *  MEASURED on the production population and both carry their own closure controls. */
const d7Price: any = fs.existsSync(D7_PRICE) ? JSON.parse(fs.readFileSync(D7_PRICE, "utf8")) : null
const d7Walls: any = fs.existsSync(D7_WALLS) ? JSON.parse(fs.readFileSync(D7_WALLS, "utf8")) : null
/** TABLE 1 lines of the gate arm, parsed into per-type rows (the table IS the verdict's scope). */
const d3Table: Record<string, any> = {}
if (d3?.table1) {
  const header = String(d3.table1.find((l: string) => l.trim().startsWith("type") && l.includes("edges")) ?? "").trim().split(/\s+/)
  for (const line of d3.table1 as string[]) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < header.length) continue
    const t = cols[0]
    if (!/^[a-z_]+$/.test(t) || t === "type") continue
    const num = (name: string) => {
      const i = header.indexOf(name)
      return i >= 0 && cols[i] !== undefined ? Number(cols[i]) : 0
    }
    d3Table[t] = {
      edges: num("edges"), resolved: num("resolved"), collRes: num("collRes"),
      ambDecl: num("amb(decl)"), ambKind: num("amb(kind)"), unresolved: num("unresolved"),
      extOK: num("extOK"), extUnknown: num("ext?"), extFAIL: num("extFAIL"),
      bindOK: num("bindOK"), bindUnknown: num("bind?"), bindFAIL: num("bindFAIL"),
      causeOK: num("causeOK"), causeFAIL: num("causeFAIL"),
    }
  }
}
const censusPopulation = census
  ? {
      command: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-emission-census.ts --cap=0 --json",
      artifact: "validation/m14/fixtures/cpp/measurements/cpp-emission-census-whole.json",
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
    gateNoIndex: d3Table[value]
      ? { ...d3Table[value], command: d3.command, population: { parsed: 7435, admitted: 7435, repos: 31, failed: 0, degraded: 0 } }
      : { status: "OWED — the D3 no-index arm has not landed" },
    cap50ResidualClass: LANE_NOTES[value]?.cap50ResidualClass ?? "",
    wholePopulation: census && censusPopulation && census.perType?.[value]
      ? {
          status: "MEASURED",
          command: censusPopulation.command,
          population: {
            parsed: censusPopulation.parsed,
            admitted: censusPopulation.admitted,
            repos: censusPopulation.repos,
            failed: censusPopulation.failed,
            degraded: censusPopulation.degraded,
          },
          rows: census.perType[value].edges,
          files: census.perType[value].files,
          repos: census.perType[value].repos,
        }
      : { status: "OWED — filled by the D2 whole-population census arm" },
  }
}

/** Attach the census counts the rulings are re-measured against (R1/R2/R4 are population claims). */
if (census) {
  const byId: Record<string, any> = {}
  for (const r of applicable.rulings) byId[r.id] = { ...r }
  if (byId["CPP-R1"]) byId["CPP-R1"].wholePopulation = `implements ${census.perType.implements.edges} edges in ${census.perType.implements.files} files across ${census.perType.implements.repos} repos (D2 census, 7,435 admitted files); payload split by pureVirtualCount in wholePopulationArms.census.implementsPayload`
  if (byId["CPP-R2"]) byId["CPP-R2"].wholePopulation = `instantiates ${census.perType.instantiates.edges} edges / template_instantiation ${census.constructs.template_instantiation.edges} construct sites — different populations, as ruled`
  if (byId["CPP-R4"]) byId["CPP-R4"].wholePopulation = `extends ${census.perType.extends.edges} edges; ${census.multipleInheritance.classesWithMultipleBases.edges} classes with more than one base in ${census.multipleInheritance.classesWithMultipleBases.files} files / ${census.multipleInheritance.classesWithMultipleBases.repos} repos`
  applicable.rulings = applicable.rulings.map((r: any) => byId[r.id])
}

const spec = {
  schemaVersion: 1,
  language: "cpp",
  programme: "ALL-OUT-OF-ALL (charter validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md §9.1 D1)",
  purpose:
    "THE C++ APPLICABLE SET, machine-readable: one row per relationship type the C++ language can express (decided from the PINNED GRAMMAR's own enumeration, never from the ten-value matrix), with the emission site in src/ast/real-cpp-analyzer.ts and at least one fixture that can go RED for it (measured by the real fixture runner with the emission removed) — plus the ruled non-applicable canonical values, the C++ construct surface, and the C++-specific rulings the D1 handoff asked to be proved rather than assumed.",
  generatedBy: "script/m14/cpp-spec-table.ts (inputs named in that file's header; do not hand-edit the OWED cells without re-running)",
  grammar: {
    wasm: applicable.grammar.wasm,
    sha256: applicable.grammar.sha256,
    slotCount: applicable.grammar.slotCount,
    namedTypeCount: applicable.grammar.namedTypeCount,
    anonymousTokenCount: applicable.grammar.anonymousTokenCount,
    enumeration: "the pinned wasm enumerated through web-tree-sitter's Language API (nodeTypeCount / nodeTypeIsNamed / nodeTypeForId). ERROR and MISSING are universal parser outputs, not grammar productions, and are classified separately in cpp-completeness.json.",
    instrument: "script/m14/cpp-applicable-set.ts",
    command: "bun run script/m14/cpp-applicable-set.ts --out validation/m14/fixtures/cpp/measurements/applicable-set.json",
    artifact: "validation/m14/fixtures/cpp/measurements/applicable-set.json",
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
      "cap-50 columns are TRIAGE from a committed no-index gate log over a 50-of-3,425-file stride sample — never a population claim. Whole-population columns are EXPLICITLY OWED until the D2/D3 arms land (the `wholePopulation` cell says so); a number here without its command is a defect.",
    cap50Command: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts cpp cpp 50",
    cap50Log: "validation/m14/fixtures/cpp/measurements/gate-cpp-cap50-baseline.txt",
    cap50Population: {
      line: gate.population,
      sample: 50,
      corpusTotalCpp: 3425,
      corpusRepos: 22,
      exclusionLine: "excluded from that population: 55 tracked-but-absent/unreadable + 4 over the 1 MB cap (largest 3.5 MB) — above the cap the engine extracts structurally, not as an analyzer",
      parseFailures: 0,
      degraded: 0,
      exit: gate.exit,
      exitMeaning: "FAIL on clause 1 (unresolved/ambiguous rows on the sample) — the state being worked, not an instrument error; self-test PASS",
      admittedExtensionsNote:
        "the gate's population spelling is `.cpp` ONLY on this command (the D2/D3 whole-population arms admit the lane's full router spelling set: cpp,cc,cxx,hpp,hxx,ipp,inl,cu; `.h` is content-routed in production and the boundary is proposal cpp-h-routing.md).",
    },
    TOTAL: gate.total,
    types,
  },
  wholePopulationArms: {
    status: census
      ? `D2 census MEASURED (${census.population.parsed}/${census.population.admitted} files, ${census.population.repos} repos, ${census.closure.totalEdges} rows); D3 BOTH arms MEASURED with a closure-exact classification (no-index in .d3.noIndexArm; --index in .d3.indexedArm is a measured STRUCTURAL NON-ARM — production builds no cpp project index, so the A->B delta is 0 in every column).`
      : "OWED — filled by the D2 whole-population emission census and the D3 incoming-gate arms.",
    census: census
      ? {
          ...censusPopulation,
          perType: census.perType,
          perMarker: census.perMarker,
          callPayload: census.callPayload,
          exportPayload: census.exportPayload,
          overridePayload: census.overridePayload,
          implementsPayload: census.implementsPayload,
          importsPayload: census.importsPayload,
          instantiatesPayload: census.instantiatesPayload,
          usesPayload: census.usesPayload,
          referencesPayload: census.referencesPayload,
          containsPayload: census.containsPayload,
          multipleInheritance: census.multipleInheritance,
          constructPopulations: census.constructs,
          parseErrors: census.parseErrors,
        }
      : null,
    d3: d3
      ? {
          noIndexArm: {
            command: d3.command,
            population: d3.population,
            selfTest: d3.selfTest,
            table1: d3.table1,
            bindingIntent: d3.bindingIntent,
            verdict: d3.verdict,
            claimCarrying: d3.claimCarrying,
            classifier: d3.classifier,
            arbitraryTwin: d3.classifier?.arbitraryTwin ?? null,
            closure: d3.classifier?.control?.closure ?? null,
            evidencePage: "validation/m14/verification/CPP-D3.md",
          },
          indexedArm: d3Indexed
            ? {
                status:
                  "SUPERSEDED — the 'measured STRUCTURAL NON-ARM' reading was TRUE when production's " +
                  "PROJECT_INDEX_EXTENSIONS carried no C++ spelling and the gate's INDEX_SPECS had no cpp entry. " +
                  "BOTH halves are now wired (PROJECT_INDEX_EXTENSIONS carries .cpp/.cc/.cxx/.c++/.hpp/.hxx/.ipp/" +
                  ".inl/.cu -> cpp, specByLang.cpp = CPP_DECLARATION_SPEC, and the gate's INDEX_SPECS.cpp carries the " +
                  "spec + the tree-sitter-cpp wasm), so the `--index` arm now BUILDS 31 repo indexes (0 damaged) over " +
                  "the 7,435-file population and the analyzer CONSUMES the index behind BB_CPP_INDEX_CONSUME=1. The " +
                  "A->B delta is still 0 in every column for the INDEX ALONE (measured: arm A == arm B-off, column for " +
                  "column) — the index is an INSTRUMENT and the movement comes from the CONSUMPTION, which is a separate " +
                  "flag and a separate arm (+17,955 resolved, -22,656 amb, +4,701 honest NULLs). The POPULATION caveat " +
                  "is measured and stated in CPP-POPULATION-RECONCILIATION.md: the gate's discovery admits 7,435 " +
                  "extension-only files while production's ROUTER admits 11,146 (a difference of exactly 3,711 " +
                  "C++-looking .h headers), so the arm is production-parsed for the 7,435 and the .h boundary is the one " +
                  "open population question.",
                command: d3Indexed.command,
                population: d3Indexed.population,
                table1: d3Indexed.table1,
                evidencePage: "validation/m14/verification/CPP-D3.md",
                aToBDelta: { classified: 0, resolved: 0, ambiguous: 0, unresolved: 0, arbitraryTwin: 0, classRows: 0 },
              }
            : { status: "OWED — the --index arm has not landed" },
        }
      : { status: "OWED — the D3 no-index arm has not landed" },
    noNewValueConfirmations:
      "The constructs that carry NO relationship (or a DIFFERENT one than their spelling suggests) and are therefore carried as METADATA/symbol facts rather than as a vocabulary value — each counted at whole population by the same census, so the ruling is a number and not a silence: concepts+requires (concept_definition 2 · requires_clause 10 · requires_expression 2 — RULED construct, no symbol/no edge); template instantiation (template_instantiation 267 sites, versus `instantiates` 3,093 rows emitted from new_expression only — CPP-R2); structured bindings (structured_binding_declarator 389 sites; binding names are declarations, the initializer read is the uses edge); lambda expressions (lambda_expression 5,614 · lambda_capture_specifier 5,670 — captures of declared names are uses, the lambda publishes no symbol); operator/destructor names (operator_name 3,335 · operator_cast 159 · destructor_name 2,873 — symbols contained, no `overloads` value exists); friend declarations (573 — a friend declaration publishes no edge); namespace aliases (83 — a namespace is not a published declaration); pure-virtual clauses (75 — the pure-virtual CONTRACT is why `implements` fires, CPP-R1); multiple inheritance (114 classes with >1 base in 58 files across 5 repos — N extends edges, CPP-R4).",
    /**
     * THE D7 WALL LEDGER — the four-bucket partition of the W1 wall and the disposition of every
     * named wall, MEASURED on the production population. Both blocks carry their own closure
     * controls (the partition refuses to report a zero-row bucket; the ledger refuses a wall whose
     * sub-classes do not sum to its count), and the two instruments agree on all four bucket totals.
     */
    d7: d7Price || d7Walls
      ? {
          fourBucketPartition: d7Price
            ? {
                instrument: d7Price.instrument,
                measuredAt: d7Price.measuredAt,
                w1RowsPriced: d7Price.population.w1RowsPriced,
                fourWay: d7Price.fourWay,
                buckets: Object.fromEntries(Object.entries(d7Price.buckets).map(([k, v]: any) => [k, v.rows])),
                partitionHolds: d7Price.totals.partitionHolds,
                reposIndexed: d7Price.population.reposIndexed,
                vocabulary: d7Price.rule.vocabulary,
                evidencePage: "validation/m14/verification/CPP-D7-WALLS.md",
              }
            : null,
          wallLedger: d7Walls
            ? {
                instrument: d7Walls.instrument,
                measuredAt: d7Walls.measuredAt,
                wallRows: d7Walls.totals.wallRows,
                closureHolds: d7Walls.totals.closureHolds,
                walls: d7Walls.walls.map((w: any) => ({ wall: w.wall, rows: w.rows, share: w.share, disposition: w.disposition })),
                evidencePage: "validation/m14/verification/CPP-D7-WALLS.md",
              }
            : null,
        }
      : { status: "OWED — the D7 four-bucket partition and the wall ledger have not landed" },
  },
}

const json = JSON.stringify(spec, null, 1) + "\n"
if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : ""
  if (current !== json) {
    console.error(`cpp-spec-table: STALE — ${path.relative(ROOT, OUT)} differs from what the measurements generate. Re-run without --check.`)
    process.exit(1)
  }
  console.log(`cpp-spec-table: current (${path.relative(ROOT, OUT)})`)
} else {
  fs.writeFileSync(OUT, json)
  console.log(`cpp-spec-table: wrote ${path.relative(ROOT, OUT)} — ${applicable.applicableValues.length} applicable · ${applicable.notApplicableValues.length} ruled · ${Object.keys(applicable.constructTable).length} constructs`)
}
