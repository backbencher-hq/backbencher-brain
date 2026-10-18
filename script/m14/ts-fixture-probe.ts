/**
 * TS FIXTURE PROBE — the executable pin for the two fixtures the shared runner cannot execute.
 *
 * ## Why this is a script and not only a fixture
 *
 * The shared fixture runner (`script/m14/run-fixtures.ts`) admits ONE extension per language and
 * parses every fixture with that language's grammar; the typescript lane's entry is `.ts` with
 * `tree-sitter-typescript.wasm`, and a `.tsx` fixture needs a DIFFERENT grammar
 * (`tree-sitter-tsx.wasm`) for the same analyzer. So the `renders` fixture would have no
 * executable check at all. This probe is that check for it, and it reads the SAME expectation
 * file the runner would read, so the rows a reader sees are one set rather than two.
 *
 * It also runs the `decorates` fixture, and that one IS admitted by the shared runner — it is
 * here as well because this probe is the instrument that reports the vocabulary relabel as a
 * relabel: it verifies the OLD label is gone (forbid rows) beside the new one being present.
 *
 * ## What it proves, and the control that proves it can fail
 *
 * It runs the REAL analyzer over the fixture, applies the expectation's own rows:
 *   `expectRelationships`  each must match >=1 actual row
 *   `forbidRelationships`  no actual row may match ANY row
 *   `expectExactly`        an exact count — the only way to pin "ONE row for the paired element",
 *                          because `expectRelationships` is >=1 and structurally cannot fail on a
 *                          duplicate (which is precisely the defect it is there to catch)
 * then runs a NEGATIVE CONTROL: the same checks against a copy with the new label swapped back to
 * the old one. If the control does not go red, a lane that never relabelled would have printed
 * PASS, so the probe reports its own control failure and exits non-zero
 * (`docs/M14-HONESTY-CONTRACT.md`: a pin that cannot fail proves nothing).
 *
 * Usage:
 *   bun run script/m14/ts-fixture-probe.ts [--verbose]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const FIXTURES = path.join(ROOT, "validation", "m14", "fixtures", "typescript")
const verbose = process.argv.includes("--verbose")

/** Every fixture this probe is responsible for, with the grammar its extension routes to. */
const FIXTURES_TO_PROBE: { base: string; grammar: "typescript" | "tsx" }[] = [
  { base: "decorator-emission", grammar: "typescript" },
  { base: "tsx-renders", grammar: "tsx" },
]

type Row = Record<string, any>

/** The fixture runner's own matching rule, reduced to the keys these expectations use:
 *  type/from/target/line_number exact, `meta.<key>` against the relationship metadata. */
function matches(rel: Row, want: Row): boolean {
  if (want.type !== undefined && String(rel.type) !== String(want.type)) return false
  if (want.from !== undefined && String(rel.source ?? "") !== String(want.from)) return false
  if (want.target !== undefined && String(rel.target ?? "") !== String(want.target)) return false
  if (want.line_number !== undefined) {
    const actual = Number((rel as any).line_number ?? (rel as any).metadata?.line ?? 0) || null
    const expected = want.line_number === null ? null : Number(want.line_number)
    if (actual !== expected) return false
  }
  const md = (rel.metadata ?? {}) as Record<string, any>
  for (const k of Object.keys(want)) {
    if (!k.startsWith("meta.")) continue
    if (md[k.slice("meta.".length)] !== want[k]) return false
  }
  return true
}

type Verdict = { ok: boolean; rows: { what: string; ok: boolean; detail: string }[] }

function check(rels: Row[], exp: any): Verdict {
  const rows: Verdict["rows"] = []
  for (const want of exp.expectRelationships ?? []) {
    const hit = rels.find((r) => matches(r, want))
    rows.push({
      what: `expect ${JSON.stringify(want)}`,
      ok: hit !== undefined,
      detail: hit ? `found ${hit.type}[${hit.source}->${hit.target}]@${(hit as any).line_number ?? "-"}` : "NO matching row",
    })
  }
  for (const want of exp.forbidRelationships ?? []) {
    const hit = rels.find((r) => matches(r, want))
    rows.push({
      what: `forbid ${JSON.stringify(want)}`,
      ok: hit === undefined,
      detail: hit ? `FORBIDDEN row present: ${hit.type}[${hit.source}->${hit.target}]` : "absent (correct)",
    })
  }
  for (const want of exp.expectExactly ?? []) {
    const n = rels.filter((r) => matches(r, want)).length
    rows.push({
      what: `exactly ${want.count} × ${JSON.stringify({ type: want.type, from: want.from, target: want.target })}`,
      ok: n === want.count,
      detail: `actual ${n}`,
    })
  }
  return { ok: rows.every((r) => r.ok), rows }
}

/** THE CONTROL: swap the new vocabulary back to the label it replaced in a COPY of the
 *  expectation. The positive rows must go RED — otherwise a lane that never relabelled passes. */
const RELABELS: Record<string, string> = { renders: "uses", decorates: "references" }
function controlGoesRed(rels: Row[], exp: any): boolean {
  const swapped = JSON.parse(JSON.stringify(exp))
  for (const row of [...(swapped.expectRelationships ?? []), ...(swapped.forbidRelationships ?? []), ...(swapped.expectExactly ?? [])]) {
    if (row.type !== undefined && RELABELS[row.type] !== undefined) row.type = RELABELS[row.type]
  }
  return check(rels, swapped).ok === false
}

let allOk = true
for (const { base, grammar } of FIXTURES_TO_PROBE) {
  const sourcePath = findSource(base)
  const expectationPath = path.join(FIXTURES, `${base}.expectation.json`)
  if (!sourcePath || !fs.existsSync(expectationPath)) {
    console.log(`FAIL  ${base} — fixture source or expectation missing (${sourcePath ?? "no source"})`)
    allOk = false
    continue
  }
  const content = fs.readFileSync(sourcePath, "utf8")
  const exp = JSON.parse(fs.readFileSync(expectationPath, "utf8"))
  const parser = await ASTEngine.getParser(grammar as any)
  const tree = parser.parse(content)
  if (tree === null) {
    console.log(`FAIL  ${base} — the ${grammar} grammar returned no tree; the pin cannot measure a null parse`)
    allOk = false
    continue
  }
  const relPath = path.relative(ROOT, sourcePath)
  if (tree.rootNode.hasError) {
    console.log(`FAIL  ${base} — the fixture does not parse cleanly under the ${grammar} grammar; the pin is measuring a damaged tree`)
    allOk = false
    continue
  }
  const analyzer = new RealTypeScriptAnalyzer()
  const result: any = analyzer.analyze(tree.rootNode, content, relPath)
  const rels: Row[] = result?.relationships ?? []
  const byType = new Map<string, number>()
  for (const r of rels) byType.set(String(r.type), (byType.get(String(r.type)) ?? 0) + 1)
  const verdict = check(rels, exp)
  const controlOk = controlGoesRed(rels, exp)
  const ok = verdict.ok && controlOk
  allOk = allOk && ok
  console.log(`\n${base}  (${grammar})  — fixture: ${relPath} · relationships: ${rels.length} · ${[...byType.entries()].map(([t, n]) => `${t}=${n}`).join(" ")}`)
  for (const r of verdict.rows) console.log(`${r.ok ? "  ok  " : "  FAIL"}  ${r.what} — ${r.detail}`)
  if (verbose) {
    console.log("  all rows:")
    for (const r of rels) console.log(`    ${r.type} ${r.source} -> ${r.target} @${(r as any).line_number ?? "-"}`)
  }
  console.log(`  control (new labels swapped back to the pre-relabel spelling): ${controlOk ? "FIRED" : "DID NOT FIRE — this fixture's checks cannot fail"}`)
  console.log(`  VERDICT: ${ok ? "PASS" : "FAIL"} — ${verdict.rows.filter((r) => r.ok).length}/${verdict.rows.length} rows, control ${controlOk ? "fired" : "SILENT"}`)
}

/** The fixture's source file: `.tsx` for the renders fixture, `.ts` otherwise. */
function findSource(base: string): string | null {
  for (const ext of [".tsx", ".ts"]) {
    const p = path.join(FIXTURES, `${base}${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

console.log(`\nOVERALL: ${allOk ? "PASS" : "FAIL"} — probes that can fail, with their controls reported above`)
process.exit(allOk ? 0 : 1)
