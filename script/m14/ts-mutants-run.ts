/**
 * TYPESCRIPT MUTANT RUNNER — proves this lane's own gates can FAIL.
 *
 * `script/m14/mutate-analyzer.ts` is MASTER-owned and imports the shared
 * `MUTANTS` array, which does not yet spread `TS_MUTANTS` (the two lines of
 * wiring are reported to master rather than made here). Until that lands, this
 * runs the same transforms against the same PINS — the lane's own
 * `validation/m14/fixtures/typescript/*.expectation.json` — so the claim "this
 * mutant is caught" is a measurement and not an assertion.
 *
 * A mutant that does NOT break a pin is reported as a SURVIVOR and the script
 * exits non-zero. That is the point of F4: a surviving mutant fails the suite,
 * and a pin that cannot fail is a false assurance.
 *
 * TWO INJECTION MECHANISMS, because the defect classes are two kinds:
 *
 *  - SOURCE mutants edit the analyzer file, re-run the REAL fixture runner
 *    (`script/m14/run-fixtures.ts`), and restore the file. A source edit is the
 *    only faithful way to inject "this branch never existed", which is the shape
 *    four of these mutants are. The edit is anchored on a fixed substring and
 *    the anchor is CHECKED first: a rename that stops the mutant matching is
 *    exactly how a mutant survives unnoticed, so that is reported as a survivor
 *    rather than as a pass.
 *  - RESULT mutants are applied in process to a parse of each fixture, because
 *    they are reverts expressed over the RESULT and need no analyzer source.
 *    They are checked against the same pins with the same rule, so the two
 *    mechanisms cannot disagree about what "caught" means.
 *
 * Usage: bun run script/m14/ts-mutants-run.ts [--only <id-substring>]
 */
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { TS_MUTANTS, type TsMutant } from "./ts-mutants"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const FIXTURE_DIR = path.join(ROOT, "validation", "m14", "fixtures", "typescript")
const onlyIdx = process.argv.indexOf("--only")
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

// ---------------------------------------------------------------------------
// The pin rule, the same one script/m14/run-fixtures.ts applies: an `expect`
// row must match at least one emitted row on every key it names, and NO `forbid`
// row may match any emitted row. Keys the runner does not know are dead weight,
// so only the keys this file actually compares are listed, and each one is a key
// the shared runner also allowlists.
// ---------------------------------------------------------------------------
type Row = Record<string, any>
type Entry = Row & { confidence?: number }
const DOC_KEYS = new Set(["note", "comment", "rationale", "fixtureId", "language", "authoredBeforeAnalyzerRun"])

function normRel(r: any): Row {
  return {
    type: String(r?.type ?? r?.relationshipType ?? ""),
    source: String(r?.source ?? r?.from ?? r?.fromSymbol ?? ""),
    target: String(r?.target ?? r?.to ?? r?.toSymbol ?? ""),
    line_number: r?.line_number ?? null,
    metadata: r?.metadata ?? {},
  }
}

function rowMatches(actual: Entry, want: Row): boolean {
  for (const [k, v] of Object.entries(want)) {
    if (DOC_KEYS.has(k)) continue
    if (k.startsWith("meta.")) {
      const got = (actual.metadata as any)?.[k.slice(5)]
      if (v === null) { if (got !== undefined && got !== null) return false; continue }
      if (got !== v) return false
      continue
    }
    if (k === "line_number") {
      if (v === null) { if (actual.line_number !== undefined && actual.line_number !== null) return false; continue }
      if (actual.line_number !== v) return false
      continue
    }
    // `from`/`to` are the shared runner's aliases for `source`/`target`; both
    // spellings appear in expectation rows across the lanes, so both are read.
    const canon = k === "from" ? "source" : k === "to" ? "target" : k
    if (canon === "type" || canon === "source" || canon === "target") {
      if (actual[canon] !== v) return false
      continue
    }
    // `confidence`/`confidenceMin`/`confidenceMax` and `*EndsWith` are the shared
    // runner's remaining relationship constraints. Read them with the SAME rule
    // it uses (run-fixtures.ts:344-357) so the two mechanisms cannot disagree.
    if (k === "confidence") { if (actual.confidence !== v) return false; continue }
    if (k === "confidenceMin") { if (!(typeof actual.confidence === "number" && actual.confidence >= v)) return false; continue }
    if (k === "confidenceMax") { if (!(typeof actual.confidence === "number" && actual.confidence <= v)) return false; continue }
    if (k.endsWith("EndsWith")) {
      const field = k.slice(0, -"EndsWith".length)
      const aliases: Record<string, string[]> = { target: ["target", "to", "toSymbol"], from: ["from", "source", "fromSymbol"] }
      const vals = (aliases[field] ?? [field]).map((a) => (actual as any)[a]).filter((x) => typeof x === "string")
      if (!vals.some((x) => x.endsWith(v))) return false
      continue
    }
    // A key this comparator does not implement would make the row vacuously
    // false (expect) or vacuously true (forbid). Refusing is the honest answer.
    throw new Error(`ts-mutants-run does not implement constraint key "${k}" — refusing to score the row`)
  }
  return true
}

function checkPins(result: any, exp: any): string[] {
  const problems: string[] = []
  const rels: Entry[] = (result?.relationships ?? []).map((r: any) => ({ ...normRel(r), confidence: r?.confidence }))
  for (const want of exp.expectRelationships ?? []) {
    if (!rels.some((r) => rowMatches(r, want))) problems.push(`missing expected ${want.type}:${want.source}->${want.target}`)
  }
  for (const want of exp.forbidRelationships ?? []) {
    const hit = rels.find((r) => rowMatches(r, want))
    if (hit) problems.push(`forbidden present ${want.type}:${want.source}->${want.target}`)
  }
  const syms = result?.symbols ?? []
  for (const want of exp.expectSymbols ?? []) {
    const ok = syms.some((s: any) => s.name === want.name && (want.kind === undefined || String(s.kind) === want.kind))
    if (!ok) problems.push(`missing symbol ${want.name}:${want.kind ?? "?"}`)
  }
  return problems
}

function loadFixtures(): { fixture: string; exp: any }[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".expectation.json"))
    .map((f) => ({
      fixture: f.endsWith(".expectation.json") ? f.slice(0, -".expectation.json".length) : f,
      exp: JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf8")),
    }))
}

// ---------------------------------------------------------------------------
// SOURCE mutants: edit, run the REAL shared runner, restore.
// ---------------------------------------------------------------------------
const SOURCE_MUTANTS: Record<string, { file: string; from: string; to: string }> = {
  "typescript/parameterized-heritage-raw-text-target": {
    file: "src/ast/real-typescript-analyzer.ts",
    from: "result.implements.push(heritageTypeLeaf(type.text))",
    to: "result.implements.push(type.text)",
  },
  "typescript/re-export-dependency-not-emitted": {
    file: "src/ast/real-typescript-analyzer.ts",
    from: "for (const reExport of this._pendingReExportImports) {",
    to: "for (const reExport of [] as ASTEngine.ImportInfo[]) {",
  },
  "typescript/type-predicate-position-dropped": {
    file: "src/ast/real-typescript-analyzer.ts",
    from: 'case "type_predicate": {\n          const predicateType = n.childForFieldName("type")',
    to: 'case "type_predicate_DISABLED": {\n          const predicateType = n.childForFieldName("type")',
  },
  "typescript/type-parameter-constraint-position-dropped": {
    file: "src/ast/real-typescript-analyzer.ts",
    from: 'case "type_parameter": {\n          const constraint = n.childForFieldName("constraint")',
    to: 'case "type_parameter_DISABLED": {\n          const constraint = n.childForFieldName("constraint")',
  },
}

function runSharedRunner(): { fail: number; firstProblem: string } {
  const r = spawnSync(process.execPath, [
    path.join(ROOT, "script", "m14", "run-fixtures.ts"),
    "--lang",
    "typescript",
  ], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  const m = out.split("\n").find((l) => l.startsWith("summary: "))
  if (!m) return { fail: -1, firstProblem: `runner produced no summary line: ${out.slice(-400)}` }
  const parsed = JSON.parse(m.slice("summary: ".length))
  const t = parsed.typescript ?? {}
  const detail = out.split("\n").find((l) => l.includes("forbidden relationship present") || l.includes("expected relationship") || l.includes("missing symbol"))
  return { fail: Number(t.fail ?? 0), firstProblem: (detail ?? "").trim().slice(0, 170) }
}

function runSourceMutant(m: TsMutant): { caught: boolean; detail: string } {
  const src = SOURCE_MUTANTS[m.id]
  const abs = path.join(ROOT, src.file)
  const original = readFileSync(abs, "utf8")
  if (!original.includes(src.from)) {
    return { caught: false, detail: `ANCHOR NOT FOUND in ${src.file}: the mutant cannot be injected, which is itself a survivor` }
  }
  writeFileSync(abs, original.replace(src.from, src.to))
  let r: { fail: number; firstProblem: string }
  try {
    r = runSharedRunner()
  } finally {
    writeFileSync(abs, original)
  }
  if (r.fail < 0) return { caught: false, detail: r.firstProblem }
  return r.fail > 0
    ? { caught: true, detail: `${r.fail} fixture(s) failed in the shared runner; first: ${r.firstProblem}` }
    : { caught: false, detail: `${r.fail} fixture(s) failed — SURVIVOR` }
}

// ---------------------------------------------------------------------------
// RESULT mutants: apply in process, check against the same pins.
// ---------------------------------------------------------------------------
async function runResultMutant(m: TsMutant): Promise<{ caught: boolean; detail: string }> {
  const { getParser } = await import("../../src/ast/engine")
  const mod: any = await import("../../src/ast/real-typescript-analyzer")
  const Cls = Object.values(mod).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer")) as any
  const parser = await getParser("typescript")
  const fixtures = loadFixtures()
  let broken = 0
  let first = ""
  for (const f of fixtures) {
    const abs = path.join(FIXTURE_DIR, `${f.fixture}.ts`)
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    let base: any
    try {
      const tree = await parser.parse(content)
      if (!tree) throw new Error("parser.parse returned no tree (null result)")
      base = new Cls().analyze(tree.rootNode, content, abs)
    } catch { continue }
    const baseProblems = checkPins(base, f.exp)
    if (baseProblems.length > 0) {
      // A pin that does not hold BEFORE the mutation is a broken fixture, not a
      // caught mutant. Reporting it as caught would be a false positive.
      first ||= `${f.fixture}: pin already broken before mutation (${baseProblems[0]})`
      broken++
      continue
    }
    let mutated: any
    try { mutated = m.transform(base, content) } catch (e) {
      first ||= `${f.fixture}: transform threw ${String(e).slice(0, 90)}`
      broken++
      continue
    }
    const after = checkPins(mutated, f.exp)
    if (after.length > 0) { broken++; first ||= `${f.fixture}: ${after[0]}` }
  }
  return broken > 0
    ? { caught: true, detail: `${broken} fixture pin(s) broken by the mutation; first: ${first}` }
    : { caught: false, detail: `no fixture pin broken — SURVIVOR` }
}

const selected: TsMutant[] = TS_MUTANTS.filter((m) => !only || m.id.includes(only))
if (only && selected.length === 0) {
  console.error(`--only ${only} matched 0 of ${TS_MUTANTS.length} mutants — nothing was verified`)
  process.exit(6)
}

console.log(`typescript lane mutants — ${selected.length} of ${TS_MUTANTS.length}`)
console.log(`fixtures read: ${loadFixtures().length}\n`)

let survived = 0
for (const m of selected) {
  const r = SOURCE_MUTANTS[m.id] ? runSourceMutant(m) : await runResultMutant(m)
  if (!r.caught) survived++
  console.log(`${r.caught ? "CAUGHT  " : "SURVIVED"} ${m.id}\n        ${r.detail}`)
}
console.log(`\n${selected.length - survived}/${selected.length} mutants caught - ${survived} survived`)
if (survived > 0) process.exit(1)