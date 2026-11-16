import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const src = fs.readFileSync(path.join(ROOT, "src/ast/real-dart-analyzer.ts"), "utf8")
  const masked = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  const lits = new Set<string>()
  for (const m of masked.matchAll(/\.type\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) lits.add(m[1])
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const types = new Set<string>()
  for (let i = 0; i < LANG.nodeTypeCount; i++) { const n = LANG.nodeTypeForId(i); if (n && !n.startsWith("_")) types.add(n) }
  // spec-classified (handled/silent) are not unknown
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/dart-completeness.json"), "utf8"))
  const classified = new Set([...(spec.handled_verified?.types ?? []), ...(spec.internal_silent?.types ?? [])])
  for (const d of spec.design_decision?.decisions ?? []) for (const t of String(d.node_type ?? "").split(",")) { const tt = t.trim(); if (tt) classified.add(tt) }
  for (const lit of [...lits].sort()) {
    if (!types.has(lit) && !classified.has(lit)) console.log("UNKNOWN:", lit)
  }
  console.log("done, checked", lits.size)
}
main()
