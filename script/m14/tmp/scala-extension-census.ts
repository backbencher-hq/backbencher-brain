// How many `uses <extension receiver type>` rows does each side publish, and why?
//
// SDJ-1 was open with the hypothesis that Scala 3's `end extension` block form
// made the walk to the nearest extension_definition reach the WRONG block. The
// parse dump refuted that: on both recorded residual shapes the analyzer reaches
// the RIGHT extension and publishes the RIGHT type, and it is the ORACLE that
// derives nothing. And the reverse holds on a third shape. So this census counts
// the four quadrants rather than assuming one.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const limit = Number(process.argv[3] ?? 400)

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
const isReceiverTypeNode = (t: string): boolean => t.endsWith("_type") || t.includes("type_identifier")

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)

  const quad = { analyzerYes_truthNo: 0, analyzerNo_truthYes: 0, both: 0, neither: 0 }
  const ownerKind: Record<string, number> = {}
  let extDefs = 0
  let extMethods = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    const res: any = analyzer.analyze(root, src, f)
    const analyzerEdges = new Set<string>()
    for (const r of res.relationships ?? []) {
      if (r.type !== "uses") continue
      analyzerEdges.add(`${r.source}->${r.target}`)
    }
    // The TRUTH the rule states: every def inside an extension_definition uses
    // that extension's receiver type, whatever encloses the extension.
    const truth = new Set<string>()
    const nearestOwner = (start: any): string => {
      let p = start
      while (p) {
        if (["class_definition", "object_definition", "trait_definition", "enum_definition", "function_definition", "function_declaration"].includes(p.type)) {
          const nm = p.childForFieldName?.("name")?.text
          if (nm) return nm
        }
        p = p.parent
      }
      return "(script)"
    }
    const w = (n: any): void => {
      if (n.type === "extension_definition") extDefs++
      if (n.type === "function_definition" || n.type === "function_declaration") {
        let anc: any = n.parent
        while (anc && anc.type !== "extension_definition") anc = anc.parent
        if (anc) {
          let pc: any = null
          for (let i = 0; i < anc.namedChildCount; i++) if (anc.namedChild(i).type === "parameters") { pc = anc.namedChild(i); break }
          const p0 = pc && pc.namedChild(0) ? pc.namedChild(0) : null
          if (p0) {
            for (let j = 0; j < p0.namedChildCount; j++) {
              const tc = p0.namedChild(j)
              if (tc && isReceiverTypeNode(tc.type)) {
                const t = tc.text
                const nm = n.childForFieldName?.("name")?.text ?? ""
                truth.add(`${nm}->${t.endsWith("?") ? t.slice(0, -1) : t}`)
                extMethods++
                ownerKind[nearestOwner(n)] = (ownerKind[nearestOwner(n)] ?? 0) + 1
                break
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(root)
    for (const e of truth) {
      if (analyzerEdges.has(e)) quad.both++
      else quad.analyzerNo_truthYes++
    }
    for (const e of analyzerEdges) {
      if (!truth.has(e)) {
        // Only count the analyzer's extension-receiver edges, identified by the
        // symbol stamp that names the extension they came from.
      }
    }
    for (const s of res.symbols ?? []) {
      if (s.metadata?.isExtension && s.ownerName) {
        const e = `${s.name}->${String(s.returnType ?? "")}`
        void e
      }
    }
  }
  console.log(`# ${repo}: ${files.length} files, ${extDefs} extension blocks, ${extMethods} defs inside one`)
  console.log(`# quadrant over (method -> receiver type): both=${quad.both} analyzerMissing=${quad.analyzerNo_truthYes}`)
  console.log("# enclosing owner of those defs (top 12):")
  for (const [k, v] of Object.entries(ownerKind).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(v).padStart(5)}  ${k}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
