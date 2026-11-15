// Synthetic snippet probe (m60 scala deep review).
//
// Adjudicating "when is a local val extracted" needs CONTROLLED inputs: corpus
// files confound several scopes at once. Each case here is minimal and each is
// run through the SAME analyzer the lane runs, so a rule can be stated as a
// predicate over node shapes rather than guessed from a corpus row.
//
// Usage: npx tsx script/m14/tmp/scala-snip.ts <case-file> [--dump]

import fs from "node:fs"
import path from "node:path"
import { deriveScalaContainsTruth } from "../differential"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(lang)

  const caseFile = process.argv[2]
  if (!caseFile) throw new Error("need a case file: `---`-separated cases")
  const raw = fs.readFileSync(caseFile, "utf8")
  const dump = process.argv.includes("--dump")
  const analyzer = new RealScalaAnalyzer()

  for (const chunk of raw.split(/^---$/m)) {
    const body = chunk.replace(/^\s*\n/, "")
    if (!body.trim()) continue
    const title = (body.match(/^\/\/ *(.*)$/m)?.[1] ?? "(untitled)").trim()
    const tree = parser.parse(body)
    const root = tree.rootNode
    console.log(`\n########## ${title}`)
    if (dump) {
      console.log(root.toString())
      continue
    }
    const res: any = analyzer.analyze(root, body, "/tmp/snippet.scala")
    console.log(`  hasError=${!!root.hasError} symbols=${res.symbols.length}`)
    for (const s of res.symbols) {
      console.log(`    SYM ${s.name}  kind=${s.kind} owner=${s.ownerName ?? "-"} line=${s.range?.startLine}`)
    }
    const truth = deriveScalaContainsTruth(root)
    console.log(`    ORACLE contains: ${truth.map((e) => `${e.from}->${e.target}`).join(" | ") || "(none)"}`)
    const c = (res.relationships ?? []).filter((r: any) => r.type === "contains")
    console.log(`    ANALYZER contains: ${c.map((r: any) => `${r.source}->${r.target}@${r.line_number}`).join(" | ") || "(none)"}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
