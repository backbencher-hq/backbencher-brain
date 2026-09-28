// #924 cpp include-name A/B: capture every cpp include import module and
// include_dependency edge target across the two pinned cpp corpora, so the
// structural fix (the `path` node's own text, mirroring the C lane) is
// measured against the text-slice extraction it replaces.
//
// Run: bun script/m14/tmp/c924-include-ab.ts <out.json>
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../src/ast/engine"

const ROOTS = [
  "$HOME/fixtures/repositories/fmt",
  "$HOME/fixtures/repositories/nlohmann-json",
]
const EXTS = new Set([".h", ".hpp", ".hh", ".hxx", ".cpp", ".cc", ".cxx", ".c"])
const SKIP = new Set([".git", "build", "node_modules", "docs", "doc", "third_party", "test", "tests"])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = path.join(dir, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.has(path.extname(p))) out.push(p)
  }
  return out
}

const out: Record<string, any> = {}
let files = 0
for (const root of ROOTS) {
  for (const f of walk(root)) {
    if (f.includes("/build/")) continue
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    files++
    const modules: string[] = []
    const targets: string[] = []
    for (const imp of (r.imports ?? [])) if (imp?.module) modules.push(imp.module)
    for (const rel of (r.relationships ?? [])) {
      if (rel?.metadata?.relationshipType === "include_dependency") targets.push(String(rel.target))
    }
    if (modules.length || targets.length) {
      out[path.relative("$HOME/fixtures/repositories", f)] = {
        modules: modules.sort(), targets: targets.sort(),
      }
    }
  }
}
const dest = process.argv[2] ?? "/tmp/c924-after.json"
writeFileSync(dest, JSON.stringify(out, null, 1))
console.log(`files=${files} withIncludes=${Object.keys(out).length} -> ${dest}`)
const all = Object.values(out).flatMap((v: any) => [...v.modules, ...v.targets])
console.log(`module/edge names=${all.length} whitespace-bearing=${all.filter((s: string) => /\s/.test(s)).length}`)
