// #907 A/B: dump the full C symbol surface (all kinds, with lines) so the same
// probe can run in two checkouts and be diffed. F5 cannot see symbol changes
// (symbols create no edges), so this is the only instrument that shows what a
// change to range/scope recovery actually did to the catalog.
//
// Run: bun script/m14/tmp/c907-symbol-dump.ts <out.json> [roots...]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const out = process.argv[2]
const ROOTS = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["/home/ishaq2321/bb_tests/repositories/jq", "/home/ishaq2321/bb_tests/repositories/sqlite"]

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[] = []
  try { entries = readdirSync(dir).sort() } catch { return acc }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, acc)
    else if (/\.(c|h)$/.test(e)) acc.push(p)
  }
  return acc
}

const files: string[] = []
for (const r of ROOTS) walk(r, files)
files.sort()

const result: Record<string, Array<{ kind: string; name: string; start: number; end: number; vis?: string; qn?: string }>> = {}
for (const f of files) {
  let r: any
  try { r = await parseFile(f, f.replace(/\/[^/]*$/, "")) } catch { result[f] = [{ kind: "ERR", name: "parse-failed", start: -1, end: -1 }]; continue }
  result[f] = (r.symbols ?? []).map((s: any) => ({
    kind: String(s.kind ?? s.type ?? "?"),
    name: String(s.name ?? ""),
    start: Number(s.startLine ?? -1),
    end: Number(s.endLine ?? -1),
    vis: s.visibility ? String(s.visibility) : undefined,
    qn: s.qualifiedName ? String(s.qualifiedName) : undefined,
  }))
}
writeFileSync(out, JSON.stringify({ files: result }, null, 0))
const total = Object.values(result).reduce((a, b) => a + b.length, 0)
console.log(`wrote ${out}: ${files.length} files, ${total} symbols`)
