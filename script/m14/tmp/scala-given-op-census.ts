import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
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
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const files = walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)
  let op = 0, anon = 0, named = 0
  const ex: string[] = []
  for (const f of files) {
    const tree = parser.parse(fs.readFileSync(f, "utf8"))
    const rel = path.relative(path.join(CORPUS, repo), f)
    const w = (n: any): void => {
      if (n.type === "given_definition") {
        const nm = n.childForFieldName("name")
        if (!nm) { anon++ } else if (nm.type === "operator_identifier") { op++; if (ex.length < 12) ex.push(`${rel}:${n.startPosition.row + 1}  given ${nm.text}`) } else named++
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(tree.rootNode)
  }
  console.log(`# ${repo}: ${named} named givens, ${anon} anonymous givens, ${op} OPERATOR-named givens`)
  for (const e of ex) console.log("  " + e)
}
main().catch(e => { console.error(e); process.exit(1) })
