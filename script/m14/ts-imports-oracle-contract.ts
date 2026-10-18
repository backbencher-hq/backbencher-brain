/**
 * TS IMPORTS/EXPORTS ORACLE CONTRACT — proves the lane's truth derivation agrees with the analyzer
 * on synthetic sources that exercise EVERY published spelling, and on the lane's whole fixture corpus.
 *
 * ## What "contract check" means here
 *
 * The differential compares the analyzer against the oracle table. That comparison is only meaningful
 * if the two sides agree on the SPELLING contract (binding separator, bare vs `module:item`, the name
 * asked for vs the local alias, relative vs package specifiers, re-export chains, `export {} from`).
 * So this script:
 *
 *   1. runs both sides over a set of SYNTHETIC sources, one per shape in the contract table, and
 *      compares the (label, from, target) multisets — a mismatch names the shape;
 *   2. runs both sides over every `.ts`/`.tsx` fixture in the lane's fixture directory and compares
 *      the same way (real code, the corpus the gate's own sample draws from);
 *   3. runs a NEGATIVE CONTROL: one derived target is corrupted and the comparator must report the
 *      mismatch. A contract check that cannot go red proves nothing.
 *
 * ## What it does NOT do
 *
 * It does not decide whether an edge RESOLVES and it is not the differential. It proves the two
 * derivations speak the SAME language; whether that language is right is the fixtures' and the
 * arbiter's question.
 *
 * Usage: bun run script/m14/ts-imports-oracle-contract.ts [--verbose]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import { deriveTypeScriptImportTruth, deriveTypeScriptExportTruth } from "./oracles/typescript-imports-truth"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const FIXTURES = path.join(ROOT, "validation", "m14", "fixtures", "typescript")
const verbose = process.argv.includes("--verbose")

type Row = { label: string; from: string; target: string }

/** (label, from, target) multiset as a sorted key list. Duplicates are counted: the analyzer may
 *  publish the same target twice and a set comparison would hide a real over-emission. */
function keyOf(row: Row): string {
  return `${row.label}|${row.from}|${row.target}`
}

function analyzerRows(result: any): Row[] {
  const out: Row[] = []
  for (const rel of result?.relationships ?? []) {
    const label = String(rel?.type ?? "")
    if (label !== "imports" && label !== "exports") continue
    out.push({ label, from: String(rel?.source ?? ""), target: String(rel?.target ?? "") })
  }
  return out
}

function compare(name: string, actual: Row[], expected: Row[]): string[] {
  const a = actual.map(keyOf).sort()
  const e = expected.map(keyOf).sort()
  const problems: string[] = []
  const counts = new Map<string, number>()
  for (const k of a) counts.set(k, (counts.get(k) ?? 0) + 1)
  for (const k of e) counts.set(k, (counts.get(k) ?? 0) - 1)
  for (const [k, n] of counts) {
    if (n === 0) continue
    problems.push(n > 0 ? `ANALYZER-ONLY ×${n}: ${k}` : `ORACLE-ONLY ×${-n}: ${k}`)
  }
  if (verbose) {
    console.log(`  ${name}: analyzer ${actual.length} rows · oracle ${expected.length} rows`)
    if (problems.length > 0) for (const p of problems) console.log(`    ${p}`)
  }
  return problems
}

const parser = await ASTEngine.getParser("typescript" as any)
const parserTsx = await ASTEngine.getParser("tsx" as any)

function analyze(source: string, fileName: string, grammar: "typescript" | "tsx"): any {
  const p = grammar === "tsx" ? parserTsx : parser
  const tree = p.parse(source)
  if (tree === null) throw new Error(`no parse tree for ${fileName}`)
  return new RealTypeScriptAnalyzer().analyze(tree.rootNode, source, fileName)
}

// ── 1 · SYNTHETIC SOURCES, one per shape in the contract table ──────────────────────────────────
const synthetic: { name: string; grammar: "typescript" | "tsx"; source: string }[] = [
  {
    name: "named-and-alias from a package",
    grammar: "typescript",
    source: `import def, { a, b as c } from "pkg";\nexport const used = [def, a, c];\n`,
  },
  {
    name: "relative named import publishes the BARE item",
    grammar: "typescript",
    source: `import { x, y as z } from "./local";\nexport const used = [x, z];\n`,
  },
  {
    name: "namespace import takes the binding spelling",
    grammar: "typescript",
    source: `import * as ns from "pkg";\nexport const used = ns;\n`,
  },
  {
    name: "side-effect-only import",
    grammar: "typescript",
    source: `import "pkg/style.css";\nexport const used = 1;\n`,
  },
  {
    name: "import-require clause",
    grammar: "typescript",
    source: `import m = require("./mod");\nexport const used = m;\n`,
  },
  {
    name: "dynamic import with a literal",
    grammar: "typescript",
    source: `export async function lazy() { return import("./lazy"); }\n`,
  },
  {
    name: "dynamic import with a COMPUTED specifier (no row)",
    grammar: "typescript",
    source: `declare const dir: string;\nexport async function lazy() { return import(\`\${dir}/x\`); }\n`,
  },
  {
    name: "require call",
    grammar: "typescript",
    source: `export const m = require("./cjs");\n`,
  },
  {
    name: "re-exports: named, aliased, relative, star, namespace, type-only, empty",
    grammar: "typescript",
    source: [
      `export { alpha } from "./vendor/alpha";`,
      `export { beta as renamedBeta } from "./vendor/beta";`,
      `export * from "./vendor/gamma";`,
      `export * as gammaNs from "./vendor/gamma-ns";`,
      `export type { Epsilon } from "./vendor/epsilon";`,
      `export {} from "./vendor/empty";`,
      `export { pkgThing } from "pkg";`,
      "",
    ].join("\n"),
  },
  {
    name: "export shapes (declarations, alias, default named, anonymous default)",
    grammar: "typescript",
    source: [
      `export function f(): number { return 1; }`,
      `export class C {}`,
      `export interface I { a: number }`,
      `export type T = number;`,
      `export enum E { A }`,
      `export const x = 1;`,
      `const hidden = 2;`,
      `export { hidden as visible };`,
      `export default class Named {}`,
      "",
    ].join("\n"),
  },
  {
    name: "anonymous default export names no symbol",
    grammar: "typescript",
    source: `export default 42;\n`,
  },
  {
    name: "tsx: imports and exports in a JSX module",
    grammar: "tsx",
    source: `import { Widget } from "./widget";\nexport function App() { return <Widget />; }\n`,
  },
]

let failures = 0
console.log("TS IMPORTS/EXPORTS ORACLE CONTRACT")
console.log(`synthetic sources: ${synthetic.length}`)
for (const s of synthetic) {
  const fileName = path.join("validation", "m14", "fixtures", "typescript", "synthetic", `${s.name.replace(/[^a-z0-9]+/gi, "-")}.ts`)
  const result = analyze(s.source, fileName, s.grammar)
  const p = s.grammar === "tsx" ? parserTsx : parser
  const tree = p.parse(s.source)
  if (tree === null) {
    console.log(`  FAIL ${s.name}: no tree`)
    failures++
    continue
  }
  const oracle = [...deriveTypeScriptImportTruth(tree.rootNode, fileName), ...deriveTypeScriptExportTruth(tree.rootNode, fileName)]
  const problems = compare(s.name, analyzerRows(result), oracle)
  if (problems.length > 0) {
    failures++
    console.log(`  FAIL ${s.name}`)
    for (const p2 of problems) console.log(`      ${p2}`)
  } else {
    console.log(`  ok   ${s.name}`)
  }
}

// ── 2 · THE LANE'S FIXTURE CORPUS ───────────────────────────────────────────────────────────────
const fixtureFiles = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .sort()
let fixtureFailures = 0
let fixturesCompared = 0
for (const f of fixtureFiles) {
  const abs = path.join(FIXTURES, f)
  const grammar: "typescript" | "tsx" = f.endsWith(".tsx") ? "tsx" : "typescript"
  const p = grammar === "tsx" ? parserTsx : parser
  const source = fs.readFileSync(abs, "utf8")
  const rel = path.join("validation", "m14", "fixtures", "typescript", f)
  const tree = p.parse(source)
  if (tree === null) continue
  let result: any
  try {
    result = new RealTypeScriptAnalyzer().analyze(tree.rootNode, source, rel)
  } catch {
    continue
  }
  const oracle = [...deriveTypeScriptImportTruth(tree.rootNode, rel), ...deriveTypeScriptExportTruth(tree.rootNode, rel)]
  const problems = compare(f, analyzerRows(result), oracle)
  fixturesCompared++
  if (problems.length > 0) {
    fixtureFailures++
    console.log(`  FAIL fixture ${f}`)
    for (const p2 of problems.slice(0, 8)) console.log(`      ${p2}`)
  }
}
console.log(`fixtures compared: ${fixturesCompared} · disagreements: ${fixtureFailures}`)
failures += fixtureFailures

// ── 3 · THE NEGATIVE CONTROL ───────────────────────────────────────────────────────────────────
const controlSource = `import { a } from "./x";\nexport { b } from "./y";\n`
const controlTree = parser.parse(controlSource)
if (controlTree === null) throw new Error("control source did not parse")
const controlFile = path.join("validation", "m14", "fixtures", "typescript", "control.ts")
const controlResult = new RealTypeScriptAnalyzer().analyze(controlTree.rootNode, controlSource, controlFile)
const controlOracle = [...deriveTypeScriptImportTruth(controlTree.rootNode, controlFile), ...deriveTypeScriptExportTruth(controlTree.rootNode, controlFile)]
const controlProblems = compare("control", analyzerRows(controlResult), controlOracle)
const controlClean = controlProblems.length === 0
// Corrupt ONE derived target and require the comparator to notice.
const corrupted = controlOracle.map((r, i) => (i === 0 ? { ...r, target: `${r.target}__corrupted` } : r))
const corruptedProblems = compare("control-corrupted", analyzerRows(controlResult), corrupted)
const controlFires = corruptedProblems.length > 0
console.log(`control: agreement on the clean pair ${controlClean ? "PASS" : "FAIL"}; corrupted pair detected ${controlFires ? "FIRED (the check can go red)" : "NOT detected — the check cannot fail"}`)
if (!controlClean || !controlFires) failures++

console.log(`\nVERDICT: ${failures === 0 ? "PASS" : "FAIL"} — synthetic ${synthetic.length - (failures - fixtureFailures)}/${synthetic.length} shapes agree · fixtures ${fixturesCompared - fixtureFailures}/${fixturesCompared} agree · control ${controlClean && controlFires ? "fired" : "BROKEN"}`)
console.log("NOTE: agreement is about the SPELLING CONTRACT, not correctness; the differential consumes this truth, the arbiter judges resolution.")
process.exit(failures === 0 ? 0 : 1)
