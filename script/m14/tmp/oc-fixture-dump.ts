// script/m14/tmp/oc-fixture-dump.ts — print every edge (type, source, target,
// line_number) the objc analyzer publishes for a fixture file, with the SOURCE
// LINE the edge claims. This is the instrument that found swift's line defect (a
// surviving row claiming the converted site's line instead of the genuine call's),
// and it is how a line pin is authored against the truth rather than against a
// guess.
//
// Run: bun script/m14/tmp/oc-fixture-dump.ts <fixture-name> [--contains|--calls|...]
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main() {
  const name = process.argv[2]
  if (!name) { console.log("usage: bun script/m14/tmp/oc-fixture-dump.ts <fixture-name> [type-filter]"); process.exit(2) }
  const filter = process.argv[3]?.replace(/^--/, "")
  const file = path.join(ROOT, "validation/m14/fixtures/objc", `${name}.m`)
  const content = fs.readFileSync(file, "utf8")
  const lines = content.split("\n")
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const p = new P()
  p.setLanguage(LANG)
  const r: any = await new mod.RealObjectiveCAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(file))

  const rows = (r.relationships ?? []).filter((e: any) => !filter || String(e.type) === filter)
  rows.sort((a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0))
  for (const e of rows) {
    const ln = e.line_number
    const text = typeof ln === "number" && ln >= 1 && ln <= lines.length ? (lines[ln - 1] ?? "").trim().slice(0, 78) : "<no line>"
    console.log(`${String(ln ?? "-").padStart(4)}  ${String(e.type).padEnd(12)} ${String(e.source)} -> ${String(e.target)}   | ${JSON.stringify(text)}`)
  }
  console.log(`edges=${rows.length}${filter ? ` (filter ${filter})` : ""}`)
  if (filter === "contains") {
    console.log("\nsymbols (owner, name, range.startLine):")
    for (const s of (r.symbols ?? []).slice(0, 200)) console.log(`  ${String(s.ownerName ?? "-").padEnd(18)} ${String(s.name).padEnd(40)} ${s.range?.startLine}`)
  }
}
main()
