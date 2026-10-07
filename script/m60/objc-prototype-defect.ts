// script/m60/objc-prototype-defect.ts — does the objc analyzer symbolize a file-scope C
// function PROTOTYPE?
//
// THE DEFECT THIS MEASURES. The lane documents "C functions: definitions AND
// prototypes → function symbols", and the M12 ground truth carries the row
// `int user_config_version(void); prototype -> function`. That row passes, and it
// passes for a reason that hides the defect: `user_config.h` carries no
// @interface, so `language-detection.ts` routes it to the shared C-FAMILY path
// and the C analyzer symbolizes the prototype. An objc-NATIVE file — one the
// router admits as objective-c because it declares a class — is analyzed by
// this lane's analyzer instead, and there a file-scope prototype publishes
// NOTHING.
//
// WHY IT IS A SEPARATE QUESTION FROM `exports`. Found while measuring the exports
// construct: 7 of the 98 marker-carrying declarations have a bare
// `function_declarator` declarator, and all 7 resolve to no symbol. An `exports`
// edge built on those would point at a name the index does not hold, which is the
// "both endpoints resolve" question failing before the edge exists. Fixing it is
// not scope creep — it is the endpoint half of the exports verdict.
//
// HOW IT IS MEASURED. Over the whole admitted universe, through the PRODUCTION
// entry (`parseFile`), every `declaration` whose parent is `translation_unit`
// (file scope, so method-body locals cannot be counted) that has a declarator the
// grammar can name, grouped by the declarator SHAPE, and whether a symbol of that
// name came back. Unterminated declarations (MISSING `;`) are excluded: they
// declare nothing, which is the analyzer's own standing ruling.
//
// C PARITY, measured not asserted. The same three prototypes were handed to
// `RealCAnalyzer` with the C grammar and to `RealObjectiveCAnalyzer` with the
// objc grammar: C publishes 3 of 3 functions, objc publishes 0. The objc grammar
// INHERITS upstream tree-sitter-c 0.24.1, so the parse is not the difference — the
// declarator branch is.
//
// NO REGEXP (lane rule 1). node.type, node.parent.type, isMissing, and a
// pre-order walk for the declarator's identifier.
//
// Usage: bun script/m60/objc-prototype-defect.ts
// Writes: validation/m60/results/objc-prototype-defect.json
// Exact scope of the prototype defect: file-scope declarations whose declarator is a
// BARE function_declarator (void f(int);) publish no symbol in objc; C publishes them.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-prototype-defect.json")
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
let total = 0, missing = 0
const byShape = new Map<string, {n:number, missing:number}>()
const missingRows: Array<Record<string, unknown>> = []
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const res: any = await parseFile(f, src)
  const names = new Set<string>((res?.symbols ?? []).map((s: any) => s.name))
  const kinds = new Set<string>((res?.symbols ?? []).map((s: any) => s.kind))
  const tree: any = (parser as any).parse(src, f)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop(); if (!n) continue
    if (n.type === "declaration" && n.parent && n.parent.type === "translation_unit") {
      let shape = "none", target: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i); if (!c) continue
        if (["init_declarator","function_declarator","pointer_declarator","array_declarator","identifier","parenthesized_declarator","attributed_declarator"].includes(c.type)) { shape = c.type; target = c; break } }
      let missingSemi = false
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c?.isMissing && c.type === ";") missingSemi = true }
      if (target && !missingSemi) {
        let name = ""
        const s2: any[] = [target]
        while (s2.length > 0) { const x = s2.pop(); if (x.type === "identifier") { name = x.text; break }
          for (let k = x.namedChildCount-1; k>=0; k--) { const y = x.namedChild(k); if (y) s2.push(y) } }
        if (name) {
          total++
          const key = shape
          if (!byShape.has(key)) byShape.set(key, {n:0, missing:0})
          const rec = byShape.get(key)!
          rec.n++
          if (!names.has(name)) {
            missing++
            rec.missing++
            if (missingRows.length < 60) missingRows.push({ file: f.slice(CORPUS.length+1), line: n.startPosition.row+1, shape, name, text: n.text.split("\n")[0].slice(0,110) })
          }
        }
      }
    }
    for (let i = n.namedChildCount-1; i>=0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
const payload = {
  instrument: "script/m60/objc-prototype-defect.ts",
  corpus: CORPUS, admission: "detectLanguageFromPath === objective-c", files: files.length,
  question: "file-scope declarations with a nameable declarator: how many publish NO symbol in the objc analyzer?",
  fileScopeNameableDeclarations: total,
  withoutSymbol: missing,
  byDeclaratorShape: Object.fromEntries([...byShape].map(([k,v])=>[k,v])),
  missingRows,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2))
console.log(`file-scope nameable declarations ${total} · without a symbol ${missing}`)
for (const [k,v] of [...byShape].sort()) console.log(`  ${k.padEnd(26)} n=${String(v.n).padStart(4)}  missing=${String(v.missing).padStart(3)}`)

console.log(`wrote ${OUT}`)
