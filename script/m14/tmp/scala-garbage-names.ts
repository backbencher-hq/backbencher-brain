// Count analyzer symbols whose NAME is source text rather than a declared name.
//
// This is the SDJ-3 candidate defect: `anonymous_<T>` where T is
// `stripTypeArgs(typeNode.text)` for a type node shape scalaTypeHeadName does
// not recognise (tuple_type, stable_type_identifier, template_body, ...). The
// analyzer's OWN rule, stated in the same code, is "a SYNTHETIC name must be
// canonical - never source text".
//
// This reads the analyzer's symbols (that is the point: the defect is IN the
// published symbol) and checks each name against the grammar's declared-name
// vocabulary for its file.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
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
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  const files = walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)
  const declared = new Set<string>()
  const garbage: string[] = []
  let anonTotal = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    // Collect every DECLARED name in the file (identifier / type_identifier /
    // operator_identifier / backticked text). A published name that is not one
    // of these and not `constructor` / `given_N` is source text.
    const walk = (n: any): void => {
      if (["identifier", "type_identifier", "operator_identifier"].indexOf(n.type) >= 0) {
        declared.add(n.text)
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "operator_identifier")) declared.add(c.text)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)

    const res: any = analyzer.analyze(tree.rootNode, src, f)
    for (const s of res.symbols) {
      if (!s.name.startsWith("anonymous_")) continue
      anonTotal++
      const tail = s.name.slice("anonymous_".length)
      if (tail === "object") continue
      if (tail.startsWith("given_")) continue
      // A QUALIFIED type name is a dot-join of declared segments
      // (`java.util.Comparator`), so testing only the whole string would report
      // every qualified supertype as garbage. Test the segments.
      if (tail.split(".").every((s) => declared.has(s))) continue
      garbage.push(`${path.relative(path.join(CORPUS, repo), f)}:${s.range?.startLine}  name=${JSON.stringify(s.name.slice(0, 120))}`)
    }
  }
  console.log(`# ${repo}: ${files.length} files, ${anonTotal} anonymous_* symbols, ${garbage.length} whose name is NOT a declared name in its file`)
  for (const g of garbage.slice(0, 40)) console.log("  " + g)
  if (garbage.length > 40) console.log(`  ... and ${garbage.length - 40} more`)
}
main().catch((e) => { console.error(e); process.exit(1) })
