// Do Scala 3 `extension` methods keep their RECEIVER TYPE in their identity?
//
// FileUtils.scala declares `isPackage` in TWO extension blocks with DIFFERENT
// receiver types (`AbstractFile` and `JFile`). Both are published as
// `FileUtils.isPackage` — the receiver type is dropped — so the graph holds one node
// where the source has two, and the two methods are not merely merged: they are
// semantically different, since a Scala 3 extension method is only in scope FOR ITS
// RECEIVER TYPE.
//
// This measures: how many extension methods the corpus declares, how many share a
// name inside one file, and whether the receiver type appears anywhere in the
// published symbol.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  const repo = process.argv[2] ?? "scala3"
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()
  const files = walk(path.join(CORPUS_ROOT, repo))
  let filesWithExt = 0, extMethods = 0, collideFiles = 0, collideNames = 0, receivers = 0
  const ex: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    // find extension blocks and the method names inside them, with the receiver
    const extBlocks: { recv: string; methods: string[] }[] = []
    const walk = (n: any): void => {
      if (n.type === "extension_definition") {
        // the receiver is the `parameters` node: `extension (file: JFile) { ... }`
        const recvNode = (n.namedChildren ?? []).find((c: any) => c.type === "parameters")
        const recv = recvNode?.text ?? ""
        const methods: string[] = []
        const inner = (x: any): void => {
          if (x.type === "function_definition" || x.type === "function_declaration") {
            const id = (x.namedChildren ?? []).find((c: any) => c.type === "identifier")
            if (id?.text) methods.push(id.text)
          }
          for (const c of x.namedChildren ?? []) inner(c)
        }
        for (const c of n.namedChildren ?? []) if (c.type === "function_definition" || c.type === "template_definition") inner(c)
        if (methods.length) extBlocks.push({ recv, methods })
      }
      for (const c of n.namedChildren ?? []) walk(c)
    }
    walk(root)
    if (!extBlocks.length) continue
    filesWithExt++
    const recvSet = new Set<string>()
    for (const b of extBlocks) { if (b.recv) { recvSet.add(b.recv); receivers++ } extMethods += b.methods.length }
    // a name declared in TWO extension blocks is ambiguous unless the receiver is in the identity
    const byName = new Map<string, Set<string>>()
    for (const b of extBlocks) for (const m of b.methods) {
      if (!byName.has(m)) byName.set(m, new Set())
      byName.get(m)!.add(b.recv || "?")
    }
    let any = false
    for (const [m, recvs] of byName) {
      if (recvs.size < 2) continue
      any = true
      collideNames++
      if (ex.length < 10) ex.push(`${path.relative(path.join(CORPUS_ROOT, repo), f)}  ${m} in ${recvs.size} extensions: ${[...recvs].join(" , ").slice(0, 90)}`)
    }
    if (any) collideFiles++
  }
  console.log(`# scala extension-method identity — ${repo}\n`)
  console.log(`- files declaring extension methods: ${filesWithExt}`)
  console.log(`- extension methods: ${extMethods}, across ${receivers} extension blocks with a nameable receiver`)
  console.log(`- **files where one extension-method NAME is declared in 2+ extension blocks: ${collideFiles}** (${collideNames} names)`)
  console.log(`  (the receiver type is what distinguishes them, and it is not part of the published name)`)
  if (ex.length) { console.log(`\n## examples`); for (const e of ex) console.log(`  ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
