// What node types can a val/var DEFINITION's `pattern` be? The analyzer refuses
// `tuple_pattern` (S1.19, a run-time VALUE shape) and accepts everything else,
// so a symbolic-value STRING pattern publishes its own source text as the symbol
// name — measured at 2 rows on a 400-file scala3 draw
// (`val s"${RootPackageName @ _}/" = RootPackage` in semanticdb/Scala3.scala).
// The census says which shapes exist, so the refusal is derived rather than guessed.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  const counts: Record<string, number> = {}
  const ex: Record<string, string> = {}
  for (const f of files) {
    const src = fs.readFileSync(path.join(CORPUS_ROOT, repo, f), "utf8")
    const rel = f
    const w = (n: any): void => {
      if (n.type === "val_definition" || n.type === "var_definition") {
        const p = n.childForFieldName ? n.childForFieldName("pattern") : null
        let t = p ? String(p.type) : "(no pattern field)"
        if (!p) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "identifier") { t = `identifier (fallback: ${c.text})`; break }
          }
        }
        counts[t] = (counts[t] ?? 0) + 1
        if (!ex[t]) ex[t] = `${rel}:${n.startPosition.row + 1}  ${JSON.stringify(p ? p.text.slice(0, 60) : "")}`
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(parser.parse(src).rootNode)
  }
  console.log(`# ${repo}: ${files.length} files — val/var_definition PATTERN node types`)
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}   e.g. ${ex[k]}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
