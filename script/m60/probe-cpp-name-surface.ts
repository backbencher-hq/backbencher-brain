// What whitespace-bearing names remain in the cpp lane AFTER the include fix?
// Symbols and edge targets (not imports): the `operator` name-surface class.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../src/ast/engine"
const ROOTS = ["$HOME/fixtures/repositories/fmt", "$HOME/fixtures/repositories/nlohmann-json"]
const EXTS = [".h", ".hpp", ".hh", ".cpp", ".cc", ".cxx"]
const SKIP = new Set([".git", "build", "node_modules", "docs", "doc", "third_party", "test", "tests"])
const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 7) return out
  let es: string[] = []; try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e); let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some(x => p.endsWith(x))) out.push(p)
  }
  return out
}
const sym = new Map<string, number>(), tgt = new Map<string, number>()
let files = 0
for (const root of ROOTS) for (const f of walk(root)) {
  let r: any; try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
  files++
  for (const s of r.symbols ?? []) if (/\s/.test(String(s.name))) sym.set(String(s.name), (sym.get(String(s.name)) ?? 0) + 1)
  for (const x of r.relationships ?? []) if (/\s/.test(String(x.target))) tgt.set(String(x.target), (tgt.get(String(x.target)) ?? 0) + 1)
}
console.log(`files=${files}`)
console.log(`whitespace SYMBOL names: ${sym.size}`)
for (const [k, n] of [...sym].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log("   " + String(n).padStart(4) + "  " + JSON.stringify(k))
console.log(`whitespace EDGE targets: ${tgt.size}`)
for (const [k, n] of [...tgt].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log("   " + String(n).padStart(4) + "  " + JSON.stringify(k))
