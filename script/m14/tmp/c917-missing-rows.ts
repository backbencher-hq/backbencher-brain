// #917: reproduce the c-lane comparison on the two files the recovery changed,
// and print the MISSING rows (truth edges the analyzer no longer covers).
// Same allowlist + dedupe + normTarget as script/m14/differential.ts's c branch.
import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))
const mod: any = await import(path.resolve("script/m14/differential.ts"))

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const parser = new P()
parser.setLanguage(cLang)

const REPO = "<corpus-root>/bb_tests/repositories/sqlite"
const FILES = ["ext/wasm/libcmpp.c", "ext/jni/src/c/sqlite3-jni.c"]
const ALLOW = new Set(["extends", "implements", "instantiates", "overrides", "calls", "uses", "references", "imports"])
const normTarget = (t: string) => t

let missing = 0, unexplained = 0
for (const relPath of FILES) {
  const content = fs.readFileSync(path.join(REPO, relPath), "utf8")
  const root = parser.parse(content).rootNode
  const truth: any[] = mod.deriveCCalls(root, content)
  const result: any = await parseFile(relPath, content, { language: "c" } as any)
  const rels = (result.relationships ?? [])
    .map((r: any) => ({ label: String(r.type ?? ""), target: String(r.target ?? ""), from: String(r.source ?? ""), line: r.line_number ?? 0 }))
    .filter((r: any) => ALLOW.has(r.label))
    .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => x.label + "|" + x.target === k) })

  const rows: any[] = []
  for (const te of truth) {
    if (!rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) {
      missing++
      rows.push(te)
    }
  }
  console.log(`== ${relPath}: truth=${truth.length} analyzer=${rels.length} MISSING=${rows.length}`)
  for (const te of rows) console.log(`   MISSING ${te.label} ${te.from} -> ${te.target}`)
  for (const r of rels) {
    if (!truth.some((te: any) => te.label === r.label && normTarget(te.target) === normTarget(r.target))) {
      unexplained++
      console.log(`   UNEXPLAINED ${r.label} ${r.from} -> ${r.target} (line ${r.line})`)
    }
  }
}
console.log(`\nTOTAL MISSING=${missing} UNEXPLAINED=${unexplained}`)
