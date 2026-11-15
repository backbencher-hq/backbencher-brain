/**
 * PHP UNRESOLVED-SHAPE PROBE — what do the unresolved edges actually NAME?
 *
 * `php` whole population: uses 52,917 unresolved, calls 21,279, imports 3,691. Before any of that
 * can be fixed or ruled, it has to be named: a PHP builtin the runtime declares, a member read whose
 * receiver type is unknowable, a name this analyzer failed to publish, or something else. The lane
 * doc's own census calls part of it a type-inference wall; this measures which part.
 *
 * One pass over the admitted population. Reports, per type: unresolved edges, how many carry
 * `metadata.owner`, how many name a PHP builtin (`PHP_BUILTINS`, the same table the CALL filter
 * uses), and the top unresolved target names with counts.
 *
 *   npx tsx validation/m14/fixtures/php/tools/unresolved-shape-probe.mts [--files=N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=0").split("=")[1])

// THE PRODUCTION PATH. `pool-worker.ts` derives `qualifiedName` from `metadata.fqn` when the
// analyzer leaves it null, so a probe that calls `analyzer.analyze` directly builds a SMALLER key
// space than production has and inflates the unresolved count — the FQN probe made exactly that
// mistake and reported a 16,202-edge win the gate had already banked.
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const mod: any = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))
const { PHP_BUILTINS } = mod as typeof import("../../../../../../../../../src/ast/real-php-analyzer.ts")
if (!PHP_BUILTINS) { console.error("FATAL: PHP_BUILTINS is not exported by real-php-analyzer.ts — the probe would report every builtin as a miss"); process.exit(2) }

const repos: { repo: string; files: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files })
}
if (N > 0) for (const r of repos) {
  const stride = Math.max(1, Math.floor(r.files.length / Math.max(1, N)))
  r.files = r.files.filter((_, i) => i % stride === 0).slice(0, N)
}

type Row = { edges: number; unres: number; unresOwner: number; unresBuiltin: number; unresSourceGlobal: number }
const perType: Record<string, Row> = {}
const topNames: Record<string, Map<string, number>> = {}
const examples: string[] = []

for (const { repo, files } of repos) {
  const nameCount = new Map<string, number>()
  const parsed: { file: string; rels: any[] }[] = []
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    void content
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ file: abs, rels: res.relationships ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length > 0) nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) nameCount.set(q, (nameCount.get(q) ?? 0) + 1)
    }
  }
  for (const { file, rels } of parsed) {
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      const tgt = String(r.target ?? "")
      if (tgt.length === 0 || (nameCount.get(tgt) ?? 0) > 0) continue
      const row = perType[t] ?? (perType[t] = { edges: 0, unres: 0, unresOwner: 0, unresBuiltin: 0, unresSourceGlobal: 0 })
      row.unres++
      const md = (r.metadata ?? {}) as any
      if (typeof md.owner === "string" && md.owner.length > 0) row.unresOwner++
      if (PHP_BUILTINS.has(tgt)) row.unresBuiltin++
      if (String(r.source ?? "") === "global") row.unresSourceGlobal++
      const m = topNames[t] ?? (topNames[t] = new Map<string, number>())
      m.set(tgt, (m.get(tgt) ?? 0) + 1)
      if (examples.length < 10) examples.push(`${t}: ${String(r.source)} -> ${tgt}   (${path.relative(CR, file)}:${r.line_number ?? "?"})`)
    }
  }
}

console.log(`php unresolved-shape probe — ${N === 0 ? "WHOLE admitted population" : `stride sample of ${N} per repo`}`)
console.log(`${"type".padEnd(14)} ${"unresolved".padStart(11)} ${"has owner".padStart(10)} ${"BUILTIN".padStart(8)} ${"src=global".padStart(11)}`)
let tot = 0, b = 0, o = 0
for (const [t, r] of Object.entries(perType).sort((a, b2) => b2[1].unres - a[1].unres)) {
  console.log(`${t.padEnd(14)} ${String(r.unres).padStart(11)} ${String(r.unresOwner).padStart(10)} ${String(r.unresBuiltin).padStart(8)} ${String(r.unresSourceGlobal).padStart(11)}`)
  tot += r.unres; b += r.unresBuiltin; o += r.unresOwner
}
console.log(`\nTOTAL unresolved ${tot} · naming a PHP builtin ${b} · carrying metadata.owner ${o}`)
for (const [t, m] of Object.entries(topNames)) {
  const top = [...m].sort((a, b2) => b2[1] - a[1]).slice(0, 15)
  console.log(`\ntop unresolved ${t} targets:`)
  console.log("  " + top.map(([n, c]) => `${n}×${c}${PHP_BUILTINS.has(n) ? "[builtin]" : ""}`).join("  "))
}
console.log(`\nexamples:`)
for (const e of examples) console.log(`  ${e}`)
