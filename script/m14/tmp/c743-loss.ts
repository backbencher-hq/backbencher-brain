// #743: is the recovery actually surfacing the content, or is the loss real?
// Runs the analyzer exactly as the F5 harness does — a Parser on a named wasm,
// then `analyzer.analyze(root, content, relPath)` — and prints the symbols and
// relationships, so "the grammar error costs nothing because recovery" can be
// tested rather than assumed.
//
// Usage: bun script/m14/tmp/c743-loss.ts <wasm> <analyzerModule> <ClassName> <file>...
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const [wasmPath, analyzerModule, className, ...files] = process.argv.slice(2)

async function main() {
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({
    locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const lang = await Language.load(readFileSync(wasmPath))
  const parser = new Parser()
  parser.setLanguage(lang)
  const mod: any = await import(`../../../src/ast/${analyzerModule}`)
  const analyzer = new mod[className]()

  for (const f of files) {
    const content = readFileSync(f, "utf8")
    const tree = parser.parse(content)
    let errN = 0
    let missN = 0
    const st = [tree.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "ERROR") errN++
      if (n.isMissing) missN++
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    const res: any = await analyzer.analyze(tree.rootNode, content, path.basename(f))
    const syms = res?.symbols ?? []
    const rels = res?.relationships ?? []
    console.log(`\n=== ${f}`)
    console.log(`   ERROR=${errN} MISSING=${missN} symbols=${syms.length} relationships=${rels.length}`)
    const byKind: Record<string, string[]> = {}
    for (const s of syms) {
      const k = s.kind ?? s.type ?? "?"
      ;(byKind[k] ??= []).push(s.name ?? s.symbolName ?? "?")
    }
    for (const [k, names] of Object.entries(byKind)) {
      console.log(`   ${k} (${names.length}): ${names.slice(0, 16).join(", ")}${names.length > 16 ? " …" : ""}`)
    }
    const tagCounts: Record<string, number> = {}
    for (const r of rels) {
      const t = (r as any).metadata?.relationshipType ?? "(none)"
      tagCounts[`${(r as any).type ?? "?"}:${t}`] = (tagCounts[`${(r as any).type ?? "?"}:${t}`] ?? 0) + 1
    }
    console.log(`   relationshipType tags: ${JSON.stringify(tagCounts)}`)
    const usesEdges = rels.filter((r: any) => (r.type ?? r.relationshipType) === "uses")
    console.log(`   uses edges: ${JSON.stringify(usesEdges.map((r: any) => `${r.source ?? r.from}=>${r.target}:${r.metadata?.relationshipType ?? "(none)"}`).slice(0, 12))}`)
    tree.delete()
  }
}

main().catch((e) => {
  console.error("c743-loss failed:", e)
  process.exit(1)
})
