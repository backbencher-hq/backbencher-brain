// Unknown / unnameable symbol names, measured directly.
//
// Java's lane has an LCM pass for "unknown" placeholders; scala must not inherit
// that. So this measures from the PUBLISHED symbol names, not from a list of
// placeholders another lane happens to use. Four classes, each a property of the
// name that can be tested mechanically:
//
//   1. the literal placeholder `unknown` (and case variants)
//   2. a name that is SOURCE TEXT rather than a name — contains a space, a
//      parenthesis, a newline, or starts with a keyword the analyzer inserted
//   3. a name that is only punctuation/operators
//   4. a name carrying a STRAY bracket, which is what a bracket-strip bug leaves

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
const drawFile = process.argv[3]

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}

const CLASSES: { key: string; test: (n: string) => boolean }[] = [
  { key: "literal placeholder `unknown`", test: (n) => /^unknown$/i.test(n) },
  { key: "SOURCE TEXT (space, paren, newline)", test: (n) => /[ ()]/.test(n) },
  { key: "punctuation only", test: (n) => n.length > 0 && !/[A-Za-z0-9_$]/.test(n) },
  { key: "stray bracket", test: (n) => /[[\]()]/.test(n) },
  { key: "synthetic `anonymous_` carrying source text", test: (n) => n.startsWith("anonymous_") && /[ ()]/.test(n.slice("anonymous_".length)) },
  { key: "unbalanced angle bracket", test: (n) => (n.includes("<") !== n.includes(">")) },
]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

  let total = 0
  const hits: Record<string, { n: number; ex: string[] }> = {}
  for (const c of CLASSES) hits[c.key] = { n: 0, ex: [] }
  const byKind: Record<string, number> = {}

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    const res: any = analyzer.analyze(parser.parse(src).rootNode, src, fp)
    for (const s of res.symbols ?? []) {
      total++
      byKind[String(s.kind)] = (byKind[String(s.kind)] ?? 0) + 1
      for (const c of CLASSES) {
        if (c.test(String(s.name))) {
          hits[c.key].n++
          if (hits[c.key].ex.length < 6) hits[c.key].ex.push(`    ${f}:${s.range?.startLine}  kind=${s.kind} owner=${s.ownerName ?? "-"}  ${JSON.stringify(String(s.name).slice(0, 90))}`)
        }
      }
    }
  }
  console.log(`# ${repo}: ${files.length} files, ${total} symbols`)
  for (const c of CLASSES) {
    const h = hits[c.key]
    console.log(`  ${String(h.n).padStart(6)}  ${c.key}`)
    for (const e of h.ex) console.log(e)
  }
  console.log("# symbols by kind:")
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
