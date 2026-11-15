// Count `given_definition` nodes the analyzer mis-names (M60/S6).
//
// The defect: `given Show[String] = ShowAny` is an ANONYMOUS given of type
// `Show[String]`. It has no `name:` field, and the analyzer recovered a name by
// scanning the node's DIRECT named children for the first `identifier` — which
// is the given's BODY. So it published the given under its VALUE's name. Three
// such givens in one owner then publish the SAME name, and if a real member
// shares it (`object ShowAny` / `def ShowAny`) they collide outright.
//
// This census reads the GRAMMAR only (no analyzer state) so the count is a
// property of the corpus, and then reports the analyzer's published names for
// the same nodes.

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
  let anonGivens = 0
  let misnamed = 0
  const ex: string[] = []
  let collides = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(path.join(CORPUS, repo), f)
    const root = parser.parse(src).rootNode
    const bad: Node[] = []
    const w = (n: any): void => {
      if (n.type === "given_definition" && !n.childForFieldName("name")) {
        anonGivens++
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") { bad.push(n); break }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(root)
    if (bad.length === 0) continue
    misnamed += bad.length
    const res: any = analyzer.analyze(root, src, f)
    const names = new Map<string, number>()
    for (const s of res.symbols) {
      if (!s.ownerName) continue
      const k = `${s.ownerName}|${s.name}`
      names.set(k, (names.get(k) ?? 0) + 1)
    }
    let dupHere = 0
    for (const n of bad) {
      const nm = res.symbols.find((s: any) => s.range?.startLine === n.startPosition.row + 1 && s.metadata?.type === "given")
      const key = nm ? `${nm.ownerName}|${nm.name}` : ""
      const c = names.get(key) ?? 0
      if (c > 1) dupHere++
    }
    collides += dupHere
    if (ex.length < 14) for (const n of bad.slice(0, 3)) {
      ex.push(`${rel}:${n.startPosition.row + 1}  given ${n.text.replace(/\s+/g, " ").slice(0, 70)}`)
    }
  }
  console.log(`# ${repo}: ${files.length} files, ${anonGivens} anonymous givens, ${misnamed} of them carry a bare-identifier child (the analyzer reads it as the NAME)`)
  console.log(`# ${collides} of those publish a name already held by another symbol under the same owner`)
  for (const e of ex) console.log("  " + e)
}
main().catch((e) => { console.error(e); process.exit(1) })
