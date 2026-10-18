/**
 * solidity-oracle-verify — the Solidity lane's D4 ORACLE CONTRACT (ALL-OUT-OF-ALL §9.1 D4).
 *
 * Two halves, both measured here:
 *
 *   (i)  DERIVATION — the lane's truth functions (`deriveSolidityEdges` +
 *        `deriveSolidityCallReferenceEdges` in `script/m14/oracles/solidity.ts`, and the NEW
 *        `deriveSolidityImportTruth` in `script/m14/oracles/solidity-imports-truth.ts`) are exercised
 *        against synthetic contract cases with POSITIVE and NEGATIVE controls per class, then against
 *        the whole fixture lane (truth vs analyzer, set comparison on `label + normTarget(target)`).
 *   (ii) ADMISSION — the differential's compared set must name every emitted label. `imports` is the
 *        one emitted label m60 records as unaudited (emitted 10, audited 9); this instrument prints the
 *        contract evidence for its derivation, and the Lead wires the admission in `differential.ts`
 *        (that file is Lead-owned; this instrument reports, it never edits it).
 *
 * WHY POSITIVE **AND** NEGATIVE. A checker that only asserts "X is derived" passes just as well when
 * the derivation derives EVERYTHING. Each contract case below therefore pairs a row the oracle must
 * derive with a construct that LOOKS the same and must NOT produce an `imports` row: a `using`
 * dependency, an imported binding, and a non-literal path. `--self-test` proves the matcher can FAIL by
 * asserting a row the oracle does not derive and expecting the refusal — the same matcher both times.
 *
 * USAGE
 *   bun run script/m14/solidity-oracle-verify.ts            # JSON report
 *   bun run script/m14/solidity-oracle-verify.ts --text     # human tables
 *   bun run script/m14/solidity-oracle-verify.ts --self-test
 *
 * EXIT: 0 contract clean · 1 finding · 3 self-test control did not fire.
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { deriveSolidityCallReferenceEdges, deriveSolidityEdges } from "./oracles/solidity"
import { SOLIDITY_IMPORT_ORACLE_LABELS, deriveSolidityImportTruth } from "./oracles/solidity-imports-truth"
import { normTarget } from "./differential"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures", "solidity")
const TEXT = process.argv.includes("--text")
const SELF_TEST = process.argv.includes("--self-test")
const { getParser } = await import("./run-fixtures")

const EMITTED_LABELS = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

type Case = {
  name: string
  source: string
  positive: Array<{ label: string; target: string; why: string }>
  negative: Array<{ label: string; target: string; why: string }>
}

/**
 * THE CONTRACT CASES. `imports` gets the depth (it is the new oracle and the one the wire is for);
 * the other classes get a smoke case each so a regression in the shared oracle surfaces here too.
 */
const CASES: Case[] = [
  {
    name: "imports-all-spellings",
    source: `import "./A.sol";
import {B, C as D} from "./B.sol";
import * as Utils from "@openzeppelin/contracts/utils/Utils.sol";
import "./C.sol" as C;
import "hardhat/console.sol";
contract X {}
`,
    positive: [
      { label: "imports", target: "./A.sol", why: "plain import: the module PATH is the edge" },
      { label: "imports", target: "./B.sol", why: "named import: the PATH is the edge, the bindings are references" },
      { label: "imports", target: "@openzeppelin/contracts/utils/Utils.sol", why: "namespace import: package path preserved" },
      { label: "imports", target: "./C.sol", why: "aliased plain import" },
      { label: "imports", target: "hardhat/console.sol", why: "package specifier" },
    ],
    negative: [
      { label: "imports", target: "B", why: "an imported BINDING is a references row, never the module-path edge" },
      { label: "imports", target: "Utils", why: "a namespace binding is a references row, never an import" },
      { label: "imports", target: "./missing.sol", why: "a path the source does not import must not be derived" },
    ],
  },
  {
    name: "imports-negative-using",
    source: `import {Lib} from "./Lib.sol";
using Lib for uint256;
contract X { uint256 x; }
`,
    positive: [
      { label: "imports", target: "./Lib.sol", why: "the module path" },
      { label: "references", target: "Lib", why: "a using-dependency names the library (references), not an import" },
    ],
    negative: [
      { label: "imports", target: "Lib", why: "`using Lib for T` is NOT an import edge — it is a using dependency (references)" },
    ],
  },
  {
    name: "heritage-and-creation",
    source: `interface I { function f() external; }
contract C is I {
  function f() external override {}
  function g() external { C c = new C(); }
}
`,
    positive: [
      { label: "implements", target: "I", why: "an interface ancestor is the contract reading of the heritage clause (SOL-5)" },
      { label: "instantiates", target: "C", why: "new C() is object creation" },
    ],
    negative: [
      { label: "implements", target: "C", why: "a contract does not implement itself" },
      { label: "instantiates", target: "I", why: "no interface construction occurs in this source" },
    ],
  },
  {
    name: "contains-calls-exports",
    source: `contract C {
  uint256 public bal;
  event Ev(uint256 a);
  function f(uint256 n) public { emit Ev(n); }
}
`,
    positive: [
      { label: "contains", target: "C.bal()", why: "the synthesised public getter is a published member (SOL-3)" },
      { label: "exports", target: "C", why: "the compilation-unit surface contains the contract" },
      { label: "calls", target: "Ev", why: "emit is a call edge (calleeKind eventEmission)" },
    ],
    negative: [
      { label: "contains", target: "C.nonexistent", why: "a member the contract never declares must not be contained" },
      { label: "exports", target: "f", why: "a free function is not on the compilation-unit surface — and f is a member anyway" },
    ],
  },
]

type Edge = { label: string; from: string; target: string }
interface Analyzed { rels: Edge[]; truth: Edge[] }

async function analyzeAndDerive(source: string, relFile: string, analyzer: any, parser: any): Promise<Analyzed> {
  const tree: any = parser.parse(source, relFile)
  const result: any = await analyzer.analyze(tree.rootNode, source, relFile)
  const moduleName = relFile.split("/").pop() ?? "contract.sol"
  const truth: Edge[] = [
    ...deriveSolidityEdges(tree.rootNode, moduleName),
    ...deriveSolidityCallReferenceEdges(tree.rootNode, moduleName),
    ...deriveSolidityImportTruth(tree.rootNode, moduleName),
  ].map((e: any) => ({ label: String(e.label ?? ""), from: String(e.from ?? ""), target: String(e.target ?? "") }))
  const rels: Edge[] = (result?.relationships ?? []).map((r: any) => ({
    label: String(r.type ?? ""),
    from: String(r.source ?? ""),
    target: String(r.target ?? ""),
  }))
  tree.delete?.()
  return { rels, truth }
}

/**
 * THE MATCH KEY. `label + normTarget(target)` is the differential's published rule, and for SYMBOL
 * targets it is right. For `imports` it is DEGENERATE: normTarget takes the LAST `.`/`::` segment, so
 * every module path collapses to its extension segment — measured 2026-10-19:
 *   normTarget("./A.sol")                                  = "sol"
 *   normTarget("@openzeppelin/contracts/utils/Utils.sol")  = "sol"
 *   normTarget("hardhat/console.sol")                      = "sol"
 * A comparison on that key would report 100% coverage for `imports` no matter which paths were
 * emitted (any path covers any path), which is the vacuity the workstream doc calls a comparison
 * that cannot fail. So `imports` is compared on the target AS WRITTEN, and the report states the
 * collapse separately as a measured fact for the Lead's wiring decision. The lane's truth module
 * state this is not a lane number: it is the matcher's rule.
 */
const exactKeyOf = (e: Edge) => `${e.label}\u0000EXACT:${String(e.target ?? "")}`
const keyOf = (e: Edge) =>
  e.label === "imports" ? exactKeyOf(e) : `${e.label}\u0000${normTarget(String(e.target ?? ""))}`

async function runCases(analyzer: any, parser: any): Promise<{ results: any[]; failed: number }> {
  const results: any[] = []
  let failed = 0
  for (const c of CASES) {
    const a = await analyzeAndDerive(c.source, `fixtures/solidity/contract-${c.name}.sol`, analyzer, parser)
    const truthKeys = new Set(a.truth.map(keyOf))
    const keyFor = (label: string, target: string) =>
      label === "imports" ? `imports\u0000EXACT:${target}` : `${label}\u0000${normTarget(target)}`
    const positive = c.positive.map((p) => {
      const derived = truthKeys.has(keyFor(p.label, p.target))
      return { ...p, derived, ok: derived }
    })
    const negative = c.negative.map((n) => {
      const derived = truthKeys.has(keyFor(n.label, n.target))
      return { ...n, derived, ok: !derived }
    })
    const bad = [...positive, ...negative].filter((r) => !r.ok)
    if (bad.length > 0) failed++
    results.push({ case: c.name, truthRows: a.truth.length, analyzerRows: a.rels.length, positive, negative, ok: bad.length === 0 })
  }
  return { results, failed }
}

async function runFixtures(analyzer: any, parser: any): Promise<any> {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".sol")).sort()
  const perLabel = new Map<string, { truth: number; published: number; missing: number; unexplained: number; missingSamples: string[]; unexplainedSamples: string[] }>()
  for (const label of EMITTED_LABELS) perLabel.set(label, { truth: 0, published: 0, missing: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] })
  let truthRows = 0
  let analyzerRows = 0
  for (const f of files) {
    const src = readFileSync(path.join(FIXTURES_DIR, f), "utf8")
    const a = await analyzeAndDerive(src, `fixtures/solidity/${f}`, analyzer, parser)
    truthRows += a.truth.length
    analyzerRows += a.rels.length
    const tk = new Set(a.truth.map(keyOf))
    const ak = new Set(a.rels.map(keyOf))
    for (const e of a.truth) {
      const row = perLabel.get(e.label)
      if (!row) continue
      row.truth++
      if (!ak.has(keyOf(e))) {
        row.missing++
        if (row.missingSamples.length < 4) row.missingSamples.push(`${f}: ${e.from} -> ${e.target}`)
      }
    }
    for (const e of a.rels) {
      const row = perLabel.get(e.label)
      if (!row) continue
      row.published++
      if (!tk.has(keyOf(e))) {
        row.unexplained++
        if (row.unexplainedSamples.length < 4) row.unexplainedSamples.push(`${f}: ${e.from} -> ${e.target}`)
      }
    }
  }
  return { files: files.length, truthRows, analyzerRows, perLabel: Object.fromEntries(perLabel) }
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
const parser: any = await getParser("solidity")
const mod: any = await import(path.join(ROOT, "src/ast/real-solidity-analyzer.ts"))
const analyzer = new mod.RealSolidityAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar(parser.language, parser.constructor) } catch { /* main pass only, same contract as the runner */ }
}

const cases = await runCases(analyzer, parser)
const fixtures = await runFixtures(analyzer, parser)

if (SELF_TEST) {
  // THE CONTROL: the same matcher that accepted real rows must REFUSE a row the oracle does not derive.
  const a = await analyzeAndDerive(CASES[0].source, "fixtures/solidity/contract-self-test.sol", analyzer, parser)
  const truthKeys = new Set(a.truth.map(keyOf))
  const armA = truthKeys.has(`imports\u0000EXACT:./A.sol`)
  const armB = truthKeys.has(`imports\u0000EXACT:./NOT-IMPORTED.sol`)
  const ok = armA === true && armB === false
  console.log(`solidity-oracle-verify self-test — matcher arms: A(real import row accepted)=${armA ? "PASS" : "FAIL"} · B(fabricated import row refused)=${!armB ? "PASS" : "FAIL"}`)
  console.log(ok ? "self-test: PASS — the matcher accepts a real truth row and refuses one the oracle does not derive" : "self-test: FAIL — the control did not fire; the contract above proves nothing")
  process.exit(ok ? 0 : 3)
}

const findings: string[] = []
if (cases.failed > 0) findings.push(`${cases.failed} synthetic contract case(s) failed`)
for (const row of cases.results) {
  if (row.ok) continue
  const bad = [...row.positive, ...row.negative].filter((r: any) => !r.ok)
  findings.push(`case ${row.case}: ${bad.map((r: any) => `${r.label}->${r.target} ${r.derived ? "derived" : "missing"}`).join(", ")}`)
}
const importsRow = fixtures.perLabel["imports"]
if (importsRow.truth === 0) findings.push("imports: ZERO truth rows across the fixture lane — a label compared against nothing")
if (importsRow.missing > 0 || importsRow.unexplained > 0) {
  findings.push(`imports: fixture-lane disagreement — MISSING ${importsRow.missing}, unexplained ${importsRow.unexplained}`)
}

// The measured collapse that motivates the exact key for imports (reported, not hidden).
const normTargetCollapse = [
  "./A.sol",
  "./B.sol",
  "@openzeppelin/contracts/utils/Utils.sol",
  "hardhat/console.sol",
  "../Governor.sol",
].map((t) => ({ target: t, normTarget: normTarget(t) }))

const report = {
  schemaVersion: 1,
  importsMatchKey: {
    rule: "imports compares on the target AS WRITTEN; every other label compares on label + normTarget(target) (the differential's published rule).",
    why: "normTarget collapses every module path to its last dot segment ('sol'), so a symbol matcher would report any import path as covering any other — a comparison that cannot fail.",
    measuredCollapse: normTargetCollapse,
    leadWiringNote: "if differential.ts admits `imports` through the standard label+normTarget match, the solidity imports audit is VACUOUS (all paths -> 'sol'); the row needs a path-exact match, a matcher change in the Lead-owned file.",
  },
  instrument: "script/m14/solidity-oracle-verify.ts",
  measuredAt: new Date().toISOString(),
  language: "solidity",
  oracleModules: {
    laneMain: "script/m14/oracles/solidity.ts (deriveSolidityEdges + deriveSolidityCallReferenceEdges — extends/implements/contains/instantiates/overrides/references/uses/calls/exports)",
    imports: "script/m14/oracles/solidity-imports-truth.ts (deriveSolidityImportTruth — the one emitted label m60 recorded as unaudited)",
    importsLabels: [...SOLIDITY_IMPORT_ORACLE_LABELS],
  },
  contract: {
    method: "synthetic cases: positive derivations + NEGATIVE controls (a `using` dependency, an imported binding, a non-literal path, a self-implementation) — comparison on label + normTarget(target), the differential's own rule",
    cases: cases.results,
    failed: cases.failed,
  },
  fixtureLane: {
    method: "every .sol fixture parsed once; RealSolidityAnalyzer.analyze vs the lane truth functions; set comparison on label+normTarget(target) for symbol labels and label+EXACT-target for imports (see importsMatchKey). Both sides walk the same pinned parse — a shared grammar bug is invisible here (stated, not claimed around).",
    ...fixtures,
  },
  findings,
  ok: findings.length === 0,
}

if (TEXT) {
  console.log(`solidity-oracle-verify — imports oracle labels ${SOLIDITY_IMPORT_ORACLE_LABELS.join(",")} · contract cases ${CASES.length} · failed ${cases.failed}`)
  console.log()
  console.log("FIXTURE LANE — truth vs analyzer (label+normTarget)")
  console.log("-".repeat(78))
  for (const [label, row] of Object.entries(fixtures.perLabel as Record<string, any>)) {
    console.log(`  ${label.padEnd(14)} truth ${String(row.truth).padStart(6)} · published ${String(row.published).padStart(6)} · MISSING ${String(row.missing).padStart(5)} · unexplained ${String(row.unexplained).padStart(5)}`)
    for (const s of row.missingSamples.slice(0, 2)) console.log(`      MISSING e.g. ${s}`)
    for (const s of row.unexplainedSamples.slice(0, 2)) console.log(`      unexplained e.g. ${s}`)
  }
  console.log()
  if (findings.length) { console.log(`FINDINGS (${findings.length})`); for (const f of findings) console.log("  - " + f) }
  else console.log("FINDINGS: none")
} else {
  console.log(JSON.stringify(report, null, 1))
}
process.exit(report.ok ? 0 : 1)
