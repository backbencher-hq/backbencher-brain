// DEPENDENCY-POSITION CENSUS — every `yaml_depends_on` edge grouped by the POSITION it came from.
//
// WHY IT EXISTS. `DEPENDS_ON_KEYS` (depends_on|dependsOn|needs|requires) fires at ANY depth, so the
// corpus's `with.needs: check` — an ACTION INPUT, not a dependency — was emitted as a dependency
// reference. A position rule has to be written from the positions, not from the site that happened
// to be noticed, so this is the measurement behind `isDependencyPosition` and `dependencyTargets` in
// `src/ast/real-yaml-analyzer.ts`. Text-prefiltered, then parsed: 18,364 admitted files reduce to the
// 413 that mention a dependency key at all.
//
// MEASURED, before and after the rule, on the same instrument (whole admitted population):
//
//                                before   after
//   jobs.<id>.needs               1,655   1,655   TRUE (the fix that took `references` amb 879 -> 142)
//   services.<svc>.depends_on        74      80   compose: long-form KEYS added, `condition:` values gone
//   steps[].with.needs               48       0   FALSE — an action INPUT, removed by `isDependencyPosition`
//   Azure stages / CircleCI / rest  161     160   TRUE — other loaders' own spellings
//   TOTAL                          1,938   1,895 · resolved 1,764 -> 1,799 · unresolved 174 -> 96
//
// The net is not the point; the direction is. 48 edges that named no dependency are gone, and the 31
// edges that named a dependency's CONFIGURATION (`service_healthy`) are replaced by edges naming the
// services.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/dependency-position-census.ts > validation/m14/fixtures/yaml/dependency-position-yaml-whole-corpus.txt
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.ya?ml$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
console.log(`admitted .yaml/.yml: ${found.length}`)

const DEP = /\b(needs|depends_on|dependsOn|requires)\s*:/
const candidates: string[] = []
for (const f of found) {
  let text: string
  try { text = readFileSync(f, "utf8") } catch { continue }
  if (DEP.test(text)) candidates.push(f)
}
console.log(`candidates (text mentions a dependency key): ${candidates.length}`)

const repoOf = (abs: string): string => path.join(CR, path.relative(CR, abs).split(path.sep)[0] ?? "")
const rel = (f: string) => path.relative(CR, f)

/**
 * The POSITION of a `yaml_depends_on` edge, read off its source path — the structure the
 * analyzer already publishes, rather than the raw text.
 */
function position(source: string): string {
  const segs = source.split(".")
  // The source is `<document>.<path>.<key>`; the key is the last segment.
  const body = segs.slice(0, -1)
  const last = body[body.length - 1] ?? ""
  const secondLast = body[body.length - 2] ?? ""
  if (last === "jobs") return "jobs.<id>"
  if (secondLast === "jobs") return "jobs.<id>.<key>"   // e.g. jobs.test.needs
  if (last === "services") return "services.<svc>"
  if (secondLast === "services") return "services.<svc>.<key>"
  // `steps[N].with` -> the KEY sits under a step's `with:` block
  if (last === "with") return "steps[].with"
  if (last === "dependenttags") return "dependenttags"
  return `other:${body.slice(-2).join(".")}`
}

const byPosition = new Map<string, number>()
const byPositionTarget = new Map<string, Map<string, number>>()
const byPositionKey = new Map<string, Map<string, number>>()
const examples: string[] = []
let edges = 0, resolvedEdges = 0
let parsed = 0
for (const [i, f] of candidates.entries()) {
  if (i > 0 && i % 500 === 0) console.error(`  … ${i}/${candidates.length} (${parsed} parsed)`)
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r?.relationships) continue
  parsed++
  for (const e of r.relationships) {
    if (e?.metadata?.relationshipType !== "yaml_depends_on") continue
    edges++
    const source = String(e.source ?? "")
    const pos = position(source)
    const tgt = String(e.target ?? "")
    const resolved = e?.metadata?.resolved === true
    if (resolved) resolvedEdges++
    byPosition.set(pos, (byPosition.get(pos) ?? 0) + 1)
    const key = source.split(".").pop() ?? "?"
    const tm = byPositionTarget.get(pos) ?? new Map<string, number>()
    tm.set(tgt, (tm.get(tgt) ?? 0) + 1); byPositionTarget.set(pos, tm)
    const km = byPositionKey.get(pos) ?? new Map<string, number>()
    km.set(key, (km.get(key) ?? 0) + 1); byPositionKey.set(pos, km)
    if (examples.length < 60) examples.push(`${pos.padEnd(22)} key=${key.padEnd(12)} ${rel(f)} :: ${source} -> ${JSON.stringify(tgt)} resolved=${resolved}`)
  }
}

console.log(`\nparsed ${parsed} · yaml_depends_on edges ${edges} · resolved ${resolvedEdges} · unresolved ${edges - resolvedEdges}`)
console.log(`\n=== by POSITION ===`)
for (const [pos, n] of [...byPosition.entries()].sort((a, b) => b[1] - a[1])) {
  const keys = [...(byPositionKey.get(pos) ?? new Map()).entries()].map(([k, v]) => `${k}×${v}`).join(" ")
  const tgts = [...(byPositionTarget.get(pos) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`\n  ${String(n).padStart(5)}  ${pos}`)
  console.log(`         keys: ${keys}`)
  console.log(`         targets: ${tgts.map(([t, c]) => `${JSON.stringify(t)}×${c}`).join(" ")}`)
}
console.log(`\n=== examples ===`)
for (const e of examples) console.log(`  ${e}`)
