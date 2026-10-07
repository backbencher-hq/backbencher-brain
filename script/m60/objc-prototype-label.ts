// script/m60/objc-prototype-label.ts — the LABEL question for a file-scope prototype.
//
// script/m60/objc-prototype-defect.ts asks whether a symbol comes back at all.
// This asks the NEXT question, which is the one the workstream calls "labelled
// — the right type, not a neighbour": when a symbol DOES come back for a
// declaration whose declarator chain contains a `function_declarator`, is its
// `kind` `function`?
//
// A function PROTOTYPE is `void f(int);` (the declarator nests bare) or
// `NSString * f(NSDictionary *d);` (the declarator nests under a
// `pointer_declarator`, where the pointer is the RETURN TYPE, not a different
// kind of thing). Before OBJCD9 the analyzer read the wrapper as the fact and
// published the pointer-returning form as `variable`, which is how 13 of the
// corpus's 23 prototypes were mislabelled while 8 were absent entirely.
//
// `declaration` nodes whose parent is `translation_unit` only, so a method-body
// local cannot be counted as a prototype. Unterminated declarations (MISSING `;`)
// are excluded: they declare nothing.
//
// NO REGEXP (lane rule 1).
//
// Usage: bun script/m60/objc-prototype-label.ts
// LABEL question: a file-scope declaration whose declarator chain CONTAINS a
// function_declarator is a function PROTOTYPE. Is it published as kind=function?
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-prototype-label.json")
const files: string[] = []
const walk = (d: string) => {
  let es: any[]; try { es = readdirSync(d, { withFileTypes: true }) as any[] } catch { return }
  for (const e of es) { if (e.name.startsWith(".")) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) { walk(p); continue }
    const ext = path.extname(e.name).toLowerCase()
    if (ext !== ".m" && ext !== ".mm" && ext !== ".h") continue
    if (statSync(p).size > 1024*1024) continue
    let s = ""; try { s = readFileSync(p, "utf8") } catch { continue }
    if (detectLanguageFromPath(p, s) === "objective-c") files.push(p) }
}
walk(CORPUS); files.sort()
const parser = await getParser("objective-c")
let protos = 0, asFunction = 0, asVariable = 0, absent = 0
const shapeKind = new Map<string, number>()
const rows: any[] = []
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const res: any = await parseFile(f, src)
  const syms = new Map<string, string[]>((res?.symbols ?? []).map((s: any) => [s.name, [s.kind]]))
  const byName = new Map<string, string[]>()
  for (const s of res?.symbols ?? []) { if (!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name)!.push(s.kind) }
  const tree: any = (parser as any).parse(src, f)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop(); if (!n) continue
    if (n.type === "declaration" && n.parent?.type === "translation_unit") {
      let missingSemi = false
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c?.isMissing && c.type === ";") missingSemi = true }
      if (!missingSemi) {
        // does the declarator chain contain a function_declarator?
        let hasFn = false, shape = "none", name = ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i); if (!c) continue
          if (["init_declarator","function_declarator","pointer_declarator","array_declarator","identifier"].includes(c.type)) { shape = c.type; break } }
        if (shape !== "none") {
          const target = n.namedChildren.find((c: any) => c && ["init_declarator","function_declarator","pointer_declarator","array_declarator","identifier"].includes(c.type))
          const s2: any[] = [target]
          while (s2.length > 0) { const x = s2.pop()
            if (x.type === "function_declarator") hasFn = true
            if (x.type === "identifier" && !name) name = x.text
            for (let k = x.namedChildCount-1; k>=0; k--) { const y = x.namedChild(k); if (y) s2.push(y) } }
          if (hasFn && name) {
            protos++
            const ks = byName.get(name)
            const key = `${shape} -> ${ks ? ks.join("/") : "ABSENT"}`
            shapeKind.set(key, (shapeKind.get(key) ?? 0) + 1)
            if (!ks) absent++
            else if (ks.includes("function")) asFunction++
            else asVariable++
            if (rows.length < 30) rows.push(`${f.slice(CORPUS.length+1)}:${n.startPosition.row+1} ${key} :: ${n.text.split("\n")[0].slice(0,80)}`)
          }
        }
      }
    }
    for (let i = n.namedChildCount-1; i>=0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
console.log(`file-scope function PROTOTYPES (declarator chain contains function_declarator): ${protos}`)
console.log(`  published as kind=function: ${asFunction}`)
console.log(`  published as kind=variable: ${asVariable}`)
console.log(`  no symbol at all: ${absent}`)
console.log(`  by shape -> kind: ${JSON.stringify(Object.fromEntries([...shapeKind].sort((a,b)=>b[1]-a[1])))}`)
for (const r of rows.slice(0,14)) console.log("  ", r)
const payload = {
  instrument: "script/m60/objc-prototype-label.ts",
  corpus: CORPUS,
  admission: "detectLanguageFromPath(filePath, content) === objective-c",
  files: files.length,
  question: "a file-scope declaration whose declarator chain contains function_declarator: what kind is its symbol?",
  fileScopePrototypes: protos,
  publishedAsFunction: asFunction,
  publishedAsVariable: asVariable,
  noSymbol: absent,
  byShapeToKind: Object.fromEntries([...shapeKind].sort((a,b)=>b[1]-a[1])),
  rows,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2))
console.log(`wrote ${OUT}`)
