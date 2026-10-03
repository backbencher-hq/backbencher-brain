/**
 * M14.0.F3 for lua — the fixture runner this lane can actually run.
 *
 * WHY THIS EXISTS. `script/m14/run-fixtures.ts` is shared machinery (§8: report,
 * do not edit) and its `LANGS` map has no `lua` entry, so
 * `bun run script/m14/run-fixtures.ts --lang lua` reports an unknown language and
 * the SIX fixtures already committed under validation/m14/fixtures/lua/ have never
 * been executed by the shared runner. A lane whose fixtures cannot run is not a
 * lane with weak tests; it is a lane with no tests. This runner reads the SAME
 * `.lua` + `.expectation.json` pair format and the SAME matching semantics, so the
 * day the shared map gains its `lua` entry these fixtures run there too and this
 * file becomes redundant rather than wrong.
 *
 * MATCHING SEMANTICS, copied from the shared runner's header so the two cannot
 * drift into disagreeing about what a passing fixture means:
 *   expectSymbols / expectRelationships : each entry must match >=1 actual item.
 *       An entry matches when EVERY specified constraint field matches
 *       (unspecified fields are wildcards). Extra actual items are fine.
 *   forbidSymbols / forbidRelationships : NO actual item may match the entry.
 *   Relationship constraints: type, from, target, confidenceMin, confidenceMax,
 *       line_number, and `meta.<key>` (e.g. "meta.relationshipType").
 *   Symbol constraints: name, kind, ownerName.
 *
 * THIS RUNNER'S OWN EXTENSIONS, each one a thing the shared runner cannot express
 * and each one load-bearing for a claim in this lane:
 *   expectOverrideOverridesLine  the prior declaration's line on a redefinition
 *   expectEvidenceClassOnEveryRelationship  LUA-43: no edge may omit its tier
 *   expectEvidenceClasses        the tier PER TYPE, so a tier cannot be silently
 *                                reassigned from `structural` to a weaker word
 *
 * Usage: npx tsx script/m60/run-lua-fixtures.ts [--fixture <name>]
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "lua")
const only = process.argv.includes("--fixture") ? process.argv[process.argv.indexOf("--fixture") + 1] : null

/** Every `meta.<key>` constraint on one expectation row, flattened. */
function metaConstraints(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) if (k.startsWith("meta.")) out[k.slice(5)] = String(v)
  return out
}

function relMatches(row: Record<string, any>, edge: any): boolean {
  if (row.type !== undefined && String(edge.type).toLowerCase() !== String(row.type).toLowerCase()) return false
  if (row.from !== undefined && edge.source !== row.from) return false
  if (row.target !== undefined && edge.target !== row.target) return false
  if (row.line_number !== undefined && Number(edge.line_number) !== Number(row.line_number)) return false
  if (row.confidenceMin !== undefined && !(Number(edge.confidence) >= Number(row.confidenceMin))) return false
  if (row.confidenceMax !== undefined && !(Number(edge.confidence) <= Number(row.confidenceMax))) return false
  for (const [k, v] of Object.entries(metaConstraints(row))) {
    if (String(edge.metadata?.[k] ?? "") !== v) return false
  }
  return true
}

function symMatches(row: Record<string, any>, s: any): boolean {
  if (row.name !== undefined && s.name !== row.name) return false
  if (row.kind !== undefined && String(s.kind) !== String(row.kind)) return false
  if (row.ownerName !== undefined && s.ownerName !== row.ownerName) return false
  return true
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".lua") && !only || f === `${only}.lua`)
if (!files.length) {
  console.error(`no fixture matched ${only ?? "*"} in ${DIR}`)
  process.exit(2)
}

let failures = 0
let assertions = 0

for (const file of files.sort()) {
  const stem = file.replace(/\.lua$/, "")
  const expPath = path.join(DIR, `${stem}.expectation.json`)
  let exp: any
  try {
    exp = JSON.parse(readFileSync(expPath, "utf8"))
  } catch (e: any) {
    console.error(`RED   ${stem}: no readable expectation file (${e?.message})`)
    failures++
    continue
  }
  const abs = path.join(DIR, file)
  const r: any = await parseFile(abs, DIR)
  const problems: string[] = []

  if (r.fallback === true) {
    // A degraded parse reports success with an EMPTY error list (pool-worker
    // `extractFallback` returns `{success: true, errors: [], fallback: true}`), so a
    // fixture that ran on the regex fallback would pass or fail on output the
    // tree-sitter analyzer never produced. Refusing is the only honest reading.
    problems.push(`the file fell back to pool-worker's TEXT extractor (fallback=true), so nothing here exercised the analyzer`)
  }

  const edges: any[] = r.relationships ?? []
  const syms: any[] = r.symbols ?? []

  for (const row of exp.expectRelationships ?? []) {
    assertions++
    if (!edges.some((e) => relMatches(row, e))) {
      problems.push(
        `expectRelationships ${row.type} ${row.from ?? "*"} -> ${row.target ?? "*"} L${row.line_number ?? "-"}` +
          `${row.confidenceMin !== undefined ? ` conf[${row.confidenceMin},${row.confidenceMax ?? 1}]` : ""}` +
          `${Object.keys(metaConstraints(row)).length ? ` meta{${JSON.stringify(metaConstraints(row))}}` : ""}: no actual edge matched`,
      )
    }
  }
  for (const row of exp.forbidRelationships ?? []) {
    assertions++
    const hit = edges.find((e) => relMatches(row, e))
    if (hit) {
      problems.push(
        `forbidRelationships ${row.type} ${row.from ?? "*"} -> ${row.target ?? "*"} L${row.line_number ?? "-"} MATCHED` +
          `${Object.keys(metaConstraints(row)).length ? ` meta{${JSON.stringify(metaConstraints(row))}}` : ""}: ${hit.source} -> ${hit.target} at L${hit.line_number}`,
      )
    }
  }
  for (const row of exp.expectSymbols ?? []) {
    assertions++
    if (!syms.some((s) => symMatches(row, s))) {
      problems.push(`expectSymbols ${row.name}${row.kind ? ` (${row.kind})` : ""}${row.ownerName ? ` in ${row.ownerName}` : ""}: not found`)
    }
  }
  for (const row of exp.forbidSymbols ?? []) {
    assertions++
    if (syms.some((s) => symMatches(row, s))) problems.push(`forbidSymbols ${row.name}: matched`)
  }
  for (const row of exp.expectOverrideOverridesLine ?? []) {
    assertions++
    const hit = edges.find((e) => relMatches({ type: "overrides", from: row.from, target: row.target }, e))
    if (!hit) problems.push(`expectOverrideOverridesLine ${row.from} -> ${row.target}: no overrides edge to carry a line`)
    else if (Number(hit.metadata?.overridesLine) !== Number(row.overridesLine)) {
      problems.push(`expectOverrideOverridesLine ${row.from} -> ${row.target}: overridesLine=${hit.metadata?.overridesLine}, expected ${row.overridesLine}`)
    }
  }
  if (exp.expectEvidenceClassOnEveryRelationship) {
    for (const e of edges) {
      assertions++
      if (!e.metadata?.evidenceClass) {
        problems.push(`evidenceClass: ${e.source} -[${e.type}]-> ${e.target} at L${e.line_number} carries NO tier`)
        break
      }
    }
  }
  for (const [type, tier] of Object.entries(exp.expectEvidenceClasses ?? {})) {
    assertions++
    const ofType = edges.filter((e) => String(e.type).toLowerCase() === type.toLowerCase())
    if (!ofType.length) {
      problems.push(`expectEvidenceClasses: this fixture produced no ${type} edge, so the tier for ${type} was not checked`)
      continue
    }
    const wrong = ofType.filter((e) => e.metadata?.evidenceClass !== tier)
    if (wrong.length) {
      problems.push(
        `expectEvidenceClasses ${type}="${tier}": ${wrong.length}/${ofType.length} edges carry "${wrong[0].metadata?.evidenceClass}"`,
      )
    }
  }

  if (problems.length) {
    failures++
    console.log(`RED   ${stem}  (${edges.length} edges, ${syms.length} symbols)`)
    for (const p of problems) console.log(`        ${p}`)
  } else {
    console.log(`green ${stem}  (${edges.length} edges, ${syms.length} symbols)`)
  }
}

console.log(`\n${files.length} fixture(s), ${assertions} assertion(s), ${failures} failing`)
process.exitCode = failures === 0 ? 0 : 1
