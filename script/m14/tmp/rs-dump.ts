/** rust lane: per-file relationship/symbol surface dump (shape reconnaissance). */
import * as fs from "node:fs"
async function parseTree(file: string) {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  const ROOT = "/home/sano/ishaq/backbencher-brain"
  await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
  const g = await L.load(fs.readFileSync(`${ROOT}/wasm/tree-sitter-rust.wasm`))
  const p = new P()
  p.setLanguage(g)
  return p.parse(fs.readFileSync(file, "utf8")).rootNode
}
async function main() {
  const f = process.argv[2]
  // the lane's analyzer class, constructed the way run-fixtures constructs it
  const mod: any = await import("/home/sano/ishaq/backbencher-brain/src/ast/real-rust-analyzer.ts")
  const r: any = await new mod.RealRustAnalyzer().analyze(await parseTree(f), fs.readFileSync(f, "utf8"), f)
  const byType: Record<string, number> = {}
  for (const rel of r.relationships ?? []) byType[rel.type] = (byType[rel.type] ?? 0) + 1
  console.log("FILE", f)
  console.log("rel types:", JSON.stringify(byType))
  console.log("symbols:", (r.symbols ?? []).length, "kinds:", JSON.stringify((r.symbols ?? []).reduce((a: any, s: any) => { a[s.kind] = (a[s.kind] ?? 0) + 1; return a }, {})))
  console.log("--- symbols (name, kind, owner, startLine) ---")
  for (const s2 of r.symbols ?? []) console.log(`  ${String(s2.kind).padEnd(10)} ${String(s2.name).padEnd(12)} owner=${String(s2.ownerName ?? "-").padEnd(10)} lines=${s2.range?.startLine}..${s2.range?.endLine}`)
  console.log("--- imports/exports ---", JSON.stringify({ imports: (r.imports ?? []).map((i: any) => i.module), exports: (r.exports ?? []).map((e: any) => e.name) }))
  for (const rel of (r.relationships ?? []).slice(0, Number(process.argv[3] ?? 18))) {
    console.log(`  ${String(rel.type).padEnd(13)} ${String(rel.source).padEnd(32)} -> ${String(rel.target).padEnd(28)} line=${rel.line_number ?? rel.line}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
