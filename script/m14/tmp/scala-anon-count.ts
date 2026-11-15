import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
if (!gl) { console.error("PROBE INVALID: grammar did not load"); process.exit(2) }
const parser = new P(); parser.setLanguage(gl)
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8")
  const root = parser.parse(src).rootNode
  if (root.namedChildCount === 0) { console.error("PROBE INVALID: empty tree"); process.exit(2) }
  const res: any = new RealScalaAnalyzer().analyze(root, src, f)
  // (a) every instance_expression with a template_body, and its head type
  const bodies = new Map<string, number>()
  const nodeTypes = new Map<string, number>()
  const walk = (n: any): void => {
    if (n.type === "instance_expression" || n.type === "object_creation_expression") {
      const hasBody = (n.namedChildren ?? []).some((c: any) => c.type === "template_body" || c.type === "class_body")
      if (hasBody) {
        const tn = n.namedChild(0)
        const key = String(tn?.text ?? "?")
        bodies.set(key, (bodies.get(key) ?? 0) + 1)
        nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      }
    }
    for (const c of n.namedChildren ?? []) walk(c)
  }
  walk(root)
  // (b) the anonymous class symbols the analyzer actually published
  const published = new Map<string, number>()
  for (const s of res.symbols ?? []) {
    const n = String(s.name)
    if (!n.startsWith("anonymous_")) continue
    const base = n.split("#")[0]
    published.set(base, (published.get(base) ?? 0) + 1)
  }
  // Which body does the ANALYZER treat as occurrence #1, and in what line order?
  const pubOrdered: string[] = []
  for (const s of res.symbols ?? []) {
    const n = String(s.name)
    if (!n.startsWith("anonymous_")) continue
    pubOrdered.push(`${n}@L${s.range?.startLine}`)
  }
  const bodyLines: string[] = []
  const walk2 = (n: any): void => {
    if (n.type === "instance_expression" || n.type === "object_creation_expression") {
      const hasBody = (n.namedChildren ?? []).some((c: any) => c.type === "template_body" || c.type === "class_body")
      if (hasBody) bodyLines.push(`${String(n.namedChild(0)?.text ?? "?").slice(0, 22)}@L${n.startPosition.row + 1}`)
    }
    for (const c of n.namedChildren ?? []) walk2(c)
  }
  walk2(root)
  console.log(`\n=== ${path.basename(f)}`)
  console.log(`  document-order bodies (${bodyLines.length}): ${bodyLines.join("  ")}`)
  console.log(`  analyzer published    (${pubOrdered.length}): ${pubOrdered.join("  ")}`)
  console.log(`  grammar: ${JSON.stringify(Object.fromEntries(nodeTypes))}`)
  const keys = [...new Set([...bodies.keys(), ...published.keys()])].sort()
  console.log(`  ${"head type / base name".padEnd(34)} bodies  published`)
  for (const k of keys) {
    const b = bodies.get(k) ?? 0
    const p = published.get(k) ?? 0
    const flag = b !== p ? "   <-- DISAGREE" : ""
    console.log(`  ${k.slice(0, 34).padEnd(34)} ${String(b).padStart(6)}  ${String(p).padStart(9)}${flag}`)
  }
}
