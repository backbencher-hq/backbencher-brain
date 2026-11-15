import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
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
  let imports = 0
  let quoted = 0
  let quotedElsewhere = 0
  const ex: string[] = []
  for (const f of files) {
    const tree = parser.parse(fs.readFileSync(f, "utf8"))
    const rel = path.relative(path.join(CORPUS, repo), f)
    const w = (n: any): void => {
      if (n.type === "import_declaration") {
        imports++
        const parts: string[] = []
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "identifier") parts.push(c.text)
        }
        if (parts.some((p) => p.includes("`"))) {
          quoted++
          if (ex.length < 10) ex.push(`${rel}:${n.startPosition.row + 1}  import ${parts.join(".")}`)
        }
      }
      // Any other published name carrying backticks: the #924 rule is that
      // quoting is not part of a NAME, so a second site is a second defect.
      if ((n.type === "identifier" || n.type === "type_identifier") && String(n.text).includes("`")) {
        let inImport = false
        for (let a = n.parent; a; a = a.parent) if (a.type === "import_declaration") { inImport = true; break }
        if (!inImport) { quotedElsewhere++; if (ex.length < 20) ex.push(`  NON-IMPORT: ${rel}:${n.startPosition.row + 1}  ${n.type} ${JSON.stringify(n.text)}`) }
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(tree.rootNode)
  }
  console.log(`# ${repo}: ${files.length} files, ${imports} import declarations, ${quoted} of them carry a BACKTICKED path segment, ${quotedElsewhere} non-import identifier/type_identifier nodes carry backticks`)
  for (const e of ex) console.log("  " + e)
}
main().catch(e => { console.error(e); process.exit(1) })
