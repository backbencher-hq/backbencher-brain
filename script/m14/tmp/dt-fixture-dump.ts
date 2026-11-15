// script/m14/tmp/dt-fixture-dump.ts — print one dart file's symbols + edges with lines.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const file = process.argv[2]!

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const mod: any = process.env.DT_HEAD
    ? await import(path.join(ROOT, "script/m14/tmp/dt-head-analyzer.ts"))
    : await import(path.join(ROOT, "src/ast/real-dart-analyzer"))
  const content = fs.readFileSync(file, "utf8")
  const p = new P()
  p.setLanguage(LANG)
  const r = await new mod.RealDartAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(file))
  const lines = content.split("\n")
  console.log(`-- symbols (${(r.symbols ?? []).length})`)
  for (const s of r.symbols ?? []) console.log(`  ${String(s.kind).padEnd(10)} ${((s.ownerName ? s.ownerName + "." : "") + s.name).padEnd(38)} @${String(s.range?.startLine).padEnd(4)} complexity=${s.complexity}`)
  console.log(`-- relationships (${(r.relationships ?? []).length})`)
  for (const e of r.relationships ?? []) {
    const md: any = e.metadata ?? {}
    const flags = Object.keys(md).filter((k) => k !== "evidenceClass").map((k) => `${k}=${md[k]}`).join(",")
    const claimed = typeof e.line_number === "number" ? (lines[e.line_number - 1] ?? "").trim().slice(0, 62) : "(none)"
    console.log(`  ${String(e.type).padEnd(13)} ${String(e.source).padEnd(24)} -> ${String(e.target).padEnd(26)} @${String(e.line_number).padEnd(4)} ${flags}`)
    console.log(`      | ${claimed}`)
  }
}
main()
