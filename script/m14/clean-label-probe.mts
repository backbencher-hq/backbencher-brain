import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = "$HOME/mcp/bb-lanes/clean"
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const files: string[] = []
for (const e of fs.readdirSync(CR)) {
  const d = path.join(CR, e)
  try { if (!fs.statSync(d).isDirectory()) continue } catch { continue }
  if (!fs.existsSync(path.join(d, ".git"))) continue
  const walk = (dd: string) => {
    let es: fs.Dirent[]
    try { es = fs.readdirSync(dd, { withFileTypes: true }) } catch { return }
    for (const en of es) {
      if (en.name === ".git") continue
      const p = path.join(dd, en.name)
      if (en.isDirectory()) walk(p)
      else if (en.name.endsWith(".icl") || en.name.endsWith(".dcl")) files.push(p)
    }
  }
  walk(d)
}
files.sort()

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)

// Everything the TREE declares in one file, read independently of the analyzer:
//   dataConstructorNames — every `data_constructor` node's `name` FIELD
//   classNames           — every `class_declaration`'s `name` FIELD
//   typeNames            — every `type_definition`'s `name` FIELD
//   fieldNames           — every `record_field`'s `name` FIELD
//   funcNames            — every function/operator/macro definition name FIELD
//   bareAppHeads         — every application whose `function` field is an identifier
function collect(root: any) {
  const dataC = new Set<string>(), cls = new Set<string>(), typ = new Set<string>(), fld = new Set<string>(), fn = new Set<string>()
  const appHeads: { name: string; line: number; inPattern: boolean }[] = []
  const v = (n: any) => {
    switch (n.type) {
      case "data_constructor": { const x = n.childForFieldName("name"); if (x?.text) dataC.add(x.text); break }
      case "class_declaration": { const x = n.childForFieldName("name"); if (x?.text) cls.add(x.text); break }
      case "type_definition": { const x = n.childForFieldName("name"); if (x?.text) typ.add(x.text); break }
      case "record_field": { const x = n.childForFieldName("name"); if (x?.text) fld.add(x.text); break }
      case "function_declaration":
      case "operator_definition":
      case "macro_definition":
      case "generic_case_definition": { const x = n.childForFieldName("name"); if (x?.text) fn.add(x.text); break }
      case "application": {
        const h = n.childForFieldName("function")
        if (h && (h.type === "identifier" || h.type === "constructor")) {
          let p = n.parent, inPat = false
          while (p) { if (p.type === "constructor_pattern" || p.type === "function_pattern" || p.type === "paren_pattern") { inPat = true; break } p = p.parent }
          appHeads.push({ name: h.text, line: h.startPosition.row + 1, inPattern: inPat })
        }
        break
      }
    }
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(root)
  return { dataC, cls, typ, fld, fn, appHeads }
}

const bad = { instantiates: [] as any[], callsToClass: [] as any[], usesNotField: [] as any[], implementsNotClass: [] as any[] }
const selfCalls = new Map<string, { n: number; file: string; line: number }>()
let n = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, path.dirname(f)) } catch { continue }
  let t: any
  try { t = parser.parse(fs.readFileSync(f, "utf8")) } catch { continue }
  if (!t) continue
  const c = collect(t.rootNode)
  const rel = path.relative(CR, f)
  for (const x of r.relationships ?? []) {
    const ty = String(x.type).toLowerCase()
    const s0 = String(x.source ?? ""), t0 = String(x.target ?? "")
    const ln = (x as any).line_number ?? 0
    // Q4 for instantiates: the edge claims a DATA CONSTRUCTION. The tree is the
    // oracle: the target must be a `data_constructor` name in THIS file, or the
    // edge is a fabrication (or at minimum unproven).
    if (ty === "instantiates" && !c.dataC.has(t0) && bad.instantiates.length < 30) {
      bad.instantiates.push({ rel, ln, s0, t0, isField: c.fld.has(t0), isFunc: c.fn.has(t0), isClass: c.cls.has(t0), isType: c.typ.has(t0), isDataCtor: c.dataC.has(t0) })
    }
    // Q4 for uses: the edge claims a RECORD FIELD dependency.
    if (ty === "uses" && (x.metadata as any)?.isRecordField && !c.fld.has(t0) && bad.usesNotField.length < 30) {
      bad.usesNotField.push({ rel, ln, s0, t0, isField: c.fld.has(t0), isDataCtor: c.dataC.has(t0), isFunc: c.fn.has(t0), rt: (x.metadata as any).relationshipType })
    }
    // Q4 for calls with isClassMethodCall: the head must be a class THIS file declares.
    if (ty === "calls" && (x.metadata as any)?.isClassMethodCall && !c.cls.has(t0) && bad.callsToClass.length < 30) {
      bad.callsToClass.push({ rel, ln, s0, t0, isClass: c.cls.has(t0) })
    }
    // Q4 for implements: the target must be a class (the tree's class_declaration names).
    if (ty === "implements" && !c.cls.has(t0) && bad.implementsNotClass.length < 5) {
      bad.implementsNotClass.push({ rel, ln, s0, t0, isClass: c.cls.has(t0) })
    }
    if (ty === "calls" && s0 && s0 === t0) {
      const cur = selfCalls.get(s0)
      if (cur) cur.n++
      else selfCalls.set(s0, { n: 1, file: rel, line: ln })
    }
  }
  if (++n % 60 === 0) process.stderr.write(".")
}
console.log("\n")
console.log("=== Q4 instantiates: targets that are NOT a data_constructor in the same file ===")
console.log(` count ${bad.instantiates.length} (first 30)`)
for (const b of bad.instantiates) console.log(`  ${b.rel}:${b.ln} ${b.s0} -> ${b.t0}  field=${b.isField} func=${b.isFunc} class=${b.isClass} type=${b.isType} dataCtor=${b.isDataCtor}`)
console.log("\n=== Q4 uses(isRecordField): targets that are NOT a record_field in the same file ===")
console.log(` count ${bad.usesNotField.length} (first 30)`)
for (const b of bad.usesNotField) console.log(`  ${b.rel}:${b.ln} ${b.s0} -> ${b.t0} rt=${b.rt} field=${b.isField} dataCtor=${b.isDataCtor} func=${b.isFunc}`)
console.log("\n=== Q4 calls(isClassMethodCall): target not a class in the same file ===")
console.log(` count ${bad.callsToClass.length}`)
for (const b of bad.callsToClass) console.log(`  ${b.rel}:${b.ln} ${b.s0} -> ${b.t0} class=${b.isClass}`)
console.log("\n=== Q4 implements: target not a class in the same file (first 5 of the sample) ===")
console.log(` count ${bad.implementsNotClass.length}`)
for (const b of bad.implementsNotClass) console.log(`  ${b.rel}:${b.ln} ${b.s0} -> ${b.t0} class=${b.isClass}`)
console.log("\n=== calls SELF-EDGES: top 30 distinct sources ===")
const arr = [...selfCalls.entries()].sort((a, b) => b[1].n - a[1].n)
console.log(` distinct ${arr.length}  total ${arr.reduce((a, b) => a + b[1].n, 0)}`)
for (const [k, v] of arr.slice(0, 30)) console.log(`  ${String(v.n).padStart(4)}  ${k}   (${v.file}:${v.line})`)