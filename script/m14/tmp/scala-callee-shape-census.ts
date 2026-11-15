// What node types can a call_expression's `function` be? The rule for what a
// `calls` target may be has to come from this census, not from a guess.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
const drawFile = process.argv[3]
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
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).map((f) => path.join(CORPUS_ROOT, repo, f))
  const counts: Record<string, number> = {}
  const bad: Record<string, string> = {}
  let total = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(path.join(CORPUS_ROOT, repo), f)
    const w = (n: any): void => {
      if (n.type === "call_expression") {
        const fn = n.childForFieldName?.("function")
        total++
        if (fn) {
          const t = String(fn.type)
          counts[t] = (counts[t] ?? 0) + 1
          // The text a callee contributes when it is NOT a field_expression and
          // NOT a generic_function — i.e. what handleCall falls back to.
          if (t !== "field_expression" && t !== "generic_function") {
            const txt = String(fn.text)
            if (/[ ()]/.test(txt) && !bad[t]) bad[t] = `${rel}:${fn.startPosition.row + 1}  ${t} ${JSON.stringify(txt.slice(0, 80))}`
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(parser.parse(src).rootNode)
  }
  console.log(`# ${repo}: ${files.length} files, ${total} call_expressions`)
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  function is ${k}`)
  console.log("# non-name callees whose TEXT is an expression:")
  for (const [k, v] of Object.entries(bad)) console.log(`  ${k}: ${v}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
