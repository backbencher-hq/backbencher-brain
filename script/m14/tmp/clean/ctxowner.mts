import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const files: string[] = []
const seen = new Set<string>()
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!fs.statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512*1024*1024 }).split("\0").filter(Boolean) } catch { continue }
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

// field-name census with the CORRECT api: node.fieldNameForChild(i)
const fieldUse = new Map<string, Set<string>>()
// class declarations that carry a class_context, with the constraint names
const ctxOnClass: { file: string; line: number; cls: string; con: string }[] = []
const clsNames = new Set<string>()
let ctxTotal = 0
for (const f of files) {
  let t: any
  try { t = parser.parse(fs.readFileSync(f, "utf8")) } catch { continue }
  if (!t) continue
  const rel = path.relative(CR, f)
  const cname = (n: any): string => { const x = n.childForFieldName?.("name"); return x?.text ?? "" }
  const v = (x: any) => {
    if (["class_declaration","instance_declaration","class_context","derive_declaration","derive","definition","type_definition","class_member"].includes(x.type)) {
      const s = fieldUse.get(x.type) ?? new Set<string>()
      for (let i = 0; i < x.childCount; i++) { const c = x.child(i); let fn = ""; try { fn = String(x.fieldNameForChild?.(i) ?? "") } catch {} if (fn) s.add(`${c.type}·${fn}`) }
      fieldUse.set(x.type, s)
    }
    if (x.type === "class_declaration") {
      const nm = cname(x); if (nm) clsNames.add(nm)
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        if (c.type === "class_context") {
          const cons: string[] = []
          const cs = (y: any) => { if (y.type === "constructor") cons.push(String(y.text ?? "")); for (let j = 0; j < y.childCount; j++) cs(y.child(j)) }
          cs(c)
          for (const k of cons) ctxOnClass.push({ file: rel, line: c.startPosition.row + 1, cls: nm, con: k })
        }
      }
    }
    if (x.type === "class_context") ctxTotal++
    for (let i = 0; i < x.childCount; i++) v(x.child(i))
  }
  v(t.rootNode); t.delete?.()
}
console.log(`files ${files.length}`)
console.log(`class_context nodes total: ${ctxTotal}`)
console.log(`class_context constraints carried BY A class_declaration: ${ctxOnClass.length}`)
const byCls = new Map<string, number>()
for (const c of ctxOnClass) byCls.set(`${c.cls} | ${c.con}`, (byCls.get(`${c.cls} | ${c.con}`) ?? 0) + 1)
console.log(`distinct (class, constraint) pairs: ${byCls.size}`)
const rows = [...byCls.entries()].sort((a,b)=>b[1]-a[1])
for (const [k,v] of rows.slice(0,40)) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`\nconstraints naming a class DECLARED IN THE CORPUS: ${ctxOnClass.filter(c=>clsNames.has(c.con)).length}`)
console.log(`\n=== field names actually present per node type ===`)
for (const [k,s] of fieldUse) console.log(`  ${k}: ${[...s].sort().join(", ")}`)
