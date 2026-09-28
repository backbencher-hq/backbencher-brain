// tmp-clj-adv-scan.ts — corpus-scale scan: comment-flag triggers + refer-clojure fabrications.
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-clojure-analyzer")
const analyzers = new anaMod.RealClojureAnalyzer()

const files: string[] = []
const walkDir = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name === ".git") continue; walkDir(fp) }
    else if (/\.(clj|cljs|cljc)$/.test(e.name)) files.push(fp)
  }
}
walkDir("$HOME/fixtures/repositories/clojure")
walkDir("$HOME/fixtures/repositories/clj-kondo")

const symName = (nd: any): string => {
  if (!nd) return ""
  if (nd.type === "sym_lit") {
    const nm = nd.childForFieldName ? nd.childForFieldName("name") : null
    const ns = nd.childForFieldName ? nd.childForFieldName("namespace") : null
    if (nm && ns) return `${ns.text}/${nm.text}`
    if (nm) return nm.text
    return nd.text ?? ""
  }
  return nd.text ?? ""
}
const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }

// --- 1. comment-flag scan replica with trigger classification ---
let flagFiles: string[] = []
let flagWithCommentForm: Array<{ f: string; trigger: string; line: number; parent: string; commentForms: number }> = []
// --- 2. refer-clojure fabrication counts ---
let refCljFiles = 0, refCljFabEdges = 0, refCljImportModules = 0
const refCljDetail: string[] = []

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  let root: any
  try { root = p.parse(src).rootNode } catch { continue }

  // comment flag replica
  let mayShadow = false; let trigger: any = null
  {
    const scan: any[] = [root]
    while (scan.length > 0) {
      const c = scan.pop()!
      if (c.type === "dis_expr" || c.type === "quoting_lit") continue
      if (c.type === "sym_lit" && symName(c) === "comment") {
        const parent = c.parent
        if (parent?.type !== "list_lit" || parent.namedChild(0)?.startIndex !== c.startIndex) { mayShadow = true; trigger = c; break }
      }
      for (const k of kids(c)) scan.push(k)
    }
  }
  if (mayShadow) {
    flagFiles.push(f)
    let commentForms = 0
    const st: any[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "list_lit") {
        const h = (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c } return null })()
        if (h && h.type === "sym_lit" && symName(h) === "comment") commentForms++
      }
      for (const k of kids(n)) st.push(k)
    }
    if (commentForms > 0 && trigger) {
      const parentType = trigger.parent?.type ?? "NULL"
      flagWithCommentForm.push({ f, trigger: trigger.text.slice(0, 30), line: trigger.startPosition.row + 1, parent: parentType, commentForms })
    }
  }

  // refer-clojure fabrication
  if (/refer-clojure\s+:exclude/.test(src)) {
    refCljFiles++
    try {
      const res = analyzers.analyze(root, src, f)
      // collect excluded names roughly: line-based regex
      const srcLines = src.split("\n")
      const names = new Set<string>()
      const lineOf = new Set<number>()
      for (let li = 0; li < srcLines.length; li++) {
        const m = srcLines[li].match(/refer-clojure\s+:exclude\s+[\[\(]([^\]\)]*)[\]\)]/)
        if (m) {
          lineOf.add(li + 1)
          for (const nm of m[1].split(/\s+/)) if (nm) names.add(nm.replace(/[\[\]\(\)]/g, ""))
        }
      }
      const fab = res.relationships.filter((r: any) => r.type === "references" && names.has(r.target) && lineOf.has(r.line_number))
      if (fab.length > 0) {
        refCljFabEdges += fab.length
        refCljImportModules += res.imports.filter((i: any) => names.has(i.module)).length
        refCljDetail.push(`${f}: ${fab.map((r: any) => `${r.type}->${r.target}@${r.line_number}`).join(",")}`)
      }
    } catch { /* ignore */ }
  }
}

console.log(`files scanned: ${files.length}`)
console.log(`comment-flag files: ${flagFiles.length}`)
console.log(`flag=true AND has (comment) forms: ${flagWithCommentForm.length}`)
for (const r of flagWithCommentForm.slice(0, 40)) console.log(`  TRIGGER ${r.f}:${r.line} parent=${r.parent} text=${JSON.stringify(r.trigger)} commentForms=${r.commentForms}`)
console.log(`refer-clojure :exclude files: ${refCljFiles}; fabricated references edges: ${refCljFabEdges}; fabricated imports: ${refCljImportModules}`)
for (const d of refCljDetail.slice(0, 30)) console.log(`  FAB ${d}`)
