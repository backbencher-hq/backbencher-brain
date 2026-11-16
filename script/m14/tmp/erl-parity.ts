// ER2 store-parity probe: analyzer census (over the store's own indexed file
// set) vs store rows, keyed by (file|name|line_start). Reports:
//   - symbols the analyzer emits that the store lacks (the denylist /
//     artifact-filter classes are named findings, not noise)
//   - analyzer census rows that share a key (store-side dedup collateral)
import { readFileSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import Database from "better-sqlite3"
import { Parser, Language } from "web-tree-sitter"

const CORPUS = "<corpus-root>/bb_tests/repositories/rebar3"

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const { RealErlangAnalyzer } = await import("../../../src/ast/real-erlang-analyzer")
  const analyzer = new RealErlangAnalyzer()
  const sha = createHash("sha1").update(CORPUS).digest("hex")
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
  const db = new Database(dbPath, { readonly: true })
  const storeRows = db.prepare("SELECT s.name, s.symbol_type, s.line_start, f.path FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.erl'").all() as any[]
  const storeKeys = new Set(storeRows.map(r => `${r.path}|${r.name}|${r.line_start}`))
  const files = [...new Set(storeRows.map(r => r.path))]
  const missing: string[] = []
  const keySeen = new Map<string, number>()
  let total = 0
  for (const f of files) {
    const content = readFileSync(f, "utf8")
    let root; try { root = parser.parse(content).rootNode } catch { continue }
    if (!root) continue
    const r = analyzer.analyze(root, content, path.relative(CORPUS, f))
    for (const s of r.symbols as any[]) {
      total++
      const key = `${f}|${s.name}|${s.range.startLine}`
      keySeen.set(key, (keySeen.get(key) ?? 0) + 1)
      if (!storeKeys.has(key)) missing.push(`${path.relative(CORPUS, f)}: ${s.name} (${s.kind}) line ${s.range.startLine}`)
    }
  }
  const dups = [...keySeen.entries()].filter(([, c]) => c > 1)
  console.log(`census=${total} storeRows=${storeRows.length} missing=${missing.length} dupKeys=${dups.length}`)
  for (const m of missing) console.log("  MISSING-IN-STORE:", m)
  for (const [k, c] of dups) console.log(`  DUP-KEY x${c}:`, k)
}

main().catch(e => { console.error(e); process.exit(1) })
