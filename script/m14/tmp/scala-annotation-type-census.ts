// Is the `annotation_type` position REACHABLE? The analyzer labels a type child
// that appears BEFORE a function's parameter list as `annotation_type` rather
// than `return_type` (and skips it when the child is the `throws` head). Oracle
// mutant R5 turns exactly that label into return_type and read CLEAN on a
// 60-file scala3 draw, which is either "the draw does not exercise it" or "the
// position is dead". This census answers which, on real code.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const limit = Number(process.argv[3] ?? 400)
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out); else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
const TYPEISH = (t: string) => t === "generic_type" || t === "type_identifier" || t === "function_type" || t === "tuple_type" || t === "stable_type_identifier"
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const files = walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)
  let fns = 0
  let preParamType = 0
  const kinds: Record<string, number> = {}
  const ex: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(path.join(CORPUS, repo), f)
    const root = parser.parse(src).rootNode
    const w = (n: any): void => {
      if (n.type === "function_definition" || n.type === "function_declaration") {
        fns++
        const hasParamsClause = !!n.namedChildren.find((c: any) => c.type === "parameters")
        let sawParams = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c.type === "parameters") { sawParams = true; continue }
          if (!TYPEISH(c.type)) continue
          if (!sawParams) {
            const head = c.namedChild(0)?.text ?? ""
            if (head === "throws") continue
            // The analyzer labels this position `annotation_type` ONLY when the
            // function HAS a parameter list; a parameterless `def f: Unit` has
            // none, and its type child is the RETURN type.
            if (!hasParamsClause) continue
            preParamType++
            kinds[c.type] = (kinds[c.type] ?? 0) + 1
            if (ex.length < 8) ex.push(`${rel}:${c.startPosition.row + 1}  ${c.type} ${JSON.stringify(c.text.slice(0, 60))}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(root)
  }
  console.log(`# ${repo}: ${files.length} files, ${fns} function definitions, ${preParamType} of them carry a type-position child BEFORE the parameter list that is not a @throws head`)
  for (const [k, v] of Object.entries(kinds)) console.log(`   ${v}  ${k}`)
  for (const e of ex) console.log("  " + e)
}
main().catch((e) => { console.error(e); process.exit(1) })
