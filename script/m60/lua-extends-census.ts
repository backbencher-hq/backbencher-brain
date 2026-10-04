/**
 * M60 LUA-51 census — how many `extends` edges the factory-supertype reader publishes
 * over the corpus, and of what kind.
 *
 * The probe (script/m60/lua-supertype-arg-probe.ts) counts 7 written supertype
 * arguments across 5 files, but it does NOT apply the analyzer's narrowing — that the
 * factory's body must fold the role parameter into a `__`-prefixed metamethod. So the
 * 7 is an upper bound on the inheritance edges and the lower bound on the tree-traversal
 * ones, and this census is what turns it into the number the document publishes.
 *
 * Every `lua_factory_supertype` edge is listed with its source line, because an edge
 * synthesized with no line is indistinguishable from one the analyzer invented.
 *
 * Usage: npx tsx script/m60/lua-extends-census.ts [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/extends-census.json")!)

const files: { repo: string; dir: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "lua") continue
    files.push({ repo: e, dir, abs })
  }
}
console.log(`extends census — ${files.length} admitted files`)

const byKind = new Map<string, { n: number; files: Set<string>; rows: string[] }>()
const selfEdges: string[] = []
let total = 0
const bump = (kind: string, file: string, row: string): void => {
  const r = byKind.get(kind) ?? { n: 0, files: new Set<string>(), rows: [] }
  r.n++; r.files.add(file); if (r.rows.length < 40) r.rows.push(row)
  byKind.set(kind, r)
}

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const label = `${f.repo}/${path.relative(f.dir, f.abs)}`
    for (const e of r.relationships ?? []) {
      if (String(e.type).toLowerCase() !== "extends") continue
      total++
      const kind = String(e.metadata?.relationshipType ?? "unknown")
      const line = e.range?.startLine ?? e.symbolRange?.startLine ?? e.line_number ?? "?"
      bump(kind, label, `${label}:${line}: ${e.source} -> ${e.target}  conf=${e.confidence ?? "-"} ev=${e.metadata?.evidenceClass ?? "-"}`)
      if (e.source === e.target) selfEdges.push(`${label}:${line}: ${e.source} -> ${e.target}`)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const kinds = [...byKind.entries()].map(([kind, r]) => ({ kind, occurrences: r.n, files: r.files.size, rows: r.rows })).sort((a, b) => b.occurrences - a.occurrences)
console.log(`\ntotal extends edges: ${total}`)
for (const k of kinds) console.log(`  ${String(k.occurrences).padStart(6)}  ${k.kind}  (${k.files} files)`)
console.log(`\nself-edges (must be 0): ${selfEdges.length}`)
for (const s of selfEdges.slice(0, 10)) console.log(`  ${s}`)
console.log("\nlua_factory_supertype rows:")
for (const k of kinds) if (k.kind === "lua_factory_supertype") for (const r of k.rows) console.log(`  ${r}`)

writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  kind: "lua_extends_census",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: { root: CR, filesAdmitted: files.length },
  totalExtendsEdges: total,
  byKind: kinds,
  selfEdges: { occurrences: selfEdges.length, rows: selfEdges },
  note: "LUA-51. `lua_metatable` is the pre-existing setmetatable reader; `lua_factory_supertype` is this pass's addition and is the only one that can carry a 0.95 confidence.",
}, null, 2))
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
