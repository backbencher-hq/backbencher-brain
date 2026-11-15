import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const files: string[] = []
const seen = new Set<string>()
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!fs.statSync(dir).isDirectory()) continue; (await import("node:child_process")).execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = (await import("node:child_process")).execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512*1024*1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).size > 512*1024) continue } catch { continue }
    if (!abs.endsWith(".icl") && !abs.endsWith(".dcl")) continue
    if (seen.has(abs)) continue
    seen.add(abs); files.push(abs)
  }
}
for (const l of fs.readFileSync(WIDE, "utf8").split("\n")) {
  const abs = l.trim()
  if (!abs || seen.has(abs) || !fs.existsSync(abs)) continue
  if (!abs.endsWith(".icl") && !abs.endsWith(".dcl")) continue
  seen.add(abs); files.push(abs)
}
files.sort()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P(); parser.setLanguage(grammar)

const TARGETS = ["class_declaration", "instance_declaration", "class_context", "derive_declaration", "derive"]
const shape = new Map<string, Map<string, number>>()
const fieldUse = new Map<string, Set<string>>()
let n = 0
for (const f of files) {
  let t: any
  try { t = parser.parse(fs.readFileSync(f, "utf8")) } catch { continue }
  if (!t) continue
  const v = (x: any) => {
    if (TARGETS.includes(x.type)) {
      let m = shape.get(x.type); if (!m) { m = new Map(); shape.set(x.type, m) }
      const fieldOf = new Map<number, string>()
      for (let i = 0; i < x.childCount; i++) { const c = x.child(i); const fn = c.fieldNameForChild ? String(c.fieldNameForChild(i) ?? "") : ""; fieldOf.set(i, fn) }
      const direct = new Set<string>()
      for (let i = 0; i < x.namedChildCount; i++) direct.add(x.namedChild(i).type)
      const key = [...direct].sort().join("+")
      m.set(key, (m.get(key) ?? 0) + 1)
      const fs2 = fieldUse.get(x.type) ?? new Set<string>()
      for (let i = 0; i < x.childCount; i++) { const c = x.child(i); const fn = c.fieldNameForChild ? String(c.fieldNameForChild(i) ?? "") : ""; if (fn) fs2.add(`${c.type}.${fn}`) }
      fieldUse.set(x.type, fs2)
      n++
    }
    for (let i = 0; i < x.childCount; i++) v(x.child(i))
  }
  v(t.rootNode); t.delete?.()
}
console.log(`files ${files.length}; target nodes ${n}`)
for (const [k, m] of shape) {
  console.log(`\n### ${k}  (${[...m.values()].reduce((a,b)=>a+b,0)} occurrences, ${m.size} distinct named-child sets)`)
  const rows = [...m.entries()].sort((a,b)=>b[1]-a[1])
  for (const [s, c] of rows.slice(0, 25)) console.log(`  ${String(c).padStart(6)}  ${s.slice(0,150)}`)
}
console.log(`\n=== fields used on each target ===`)
for (const [k, s] of fieldUse) console.log(`  ${k}: ${[...s].sort().join(", ")}`)
