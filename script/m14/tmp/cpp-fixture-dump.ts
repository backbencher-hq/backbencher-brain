// cpp-fixture-dump.ts — measure a cpp fixture through the PRODUCTION entry with only
// real-cpp-analyzer.ts differing (HEAD vs the working tree), so the expectation file
// records measured behavior instead of intended behavior.
//
//   bun script/m14/tmp/cpp-fixture-dump.ts validation/m14/fixtures/cpp/wrapped-declarator-names-612.cpp
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const TMP = "/tmp/cpp-fixture-dump"

function materializeHead(): string {
  fs.mkdirSync(TMP, { recursive: true })
  const src = execFileSync("git", ["show", "HEAD:src/ast/real-cpp-analyzer.ts"], { cwd: ROOT, maxBuffer: 64 << 20 }).toString()
  const rewritten = src.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_m, rel: string) => `from "${path.resolve(ROOT, "src/ast", rel).replace(/\.(ts|js)$/, "")}"`)
  const out = path.join(TMP, "head-cpp-analyzer.ts")
  fs.writeFileSync(out, rewritten)
  return out
}

async function dump(label: string, modPath: string, abs: string, rel: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(modPath)
  const src = fs.readFileSync(abs, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const res: any = await new mod.RealCppAnalyzer().analyze(root, src, rel)
  const syms = (res.symbols as any[]).map((s: any) => `${s.kind}:${s.name}${s.ownerName ? `@${s.ownerName}` : ""} line=${s.metadata?.nameLine ?? s.range?.startLine}`)
  const rels = (res.relationships as any[]).map((r: any) => `${r.type} ${r.source} -> ${r.target} @${r.line_number}`)
  console.log(`\n=== ${label} ===`)
  console.log(`  errors=${root.hasError} symbols=${syms.length} edges=${rels.length}`)
  console.log(`  symbols:`)
  for (const s of syms) console.log(`    ${s}`)
  console.log(`  edges:`)
  for (const r of rels) console.log(`    ${r}`)
  return { syms, rels }
}

async function main() {
  const arg = process.argv[2]
  const rel = path.relative(ROOT, path.resolve(ROOT, arg))
  const head = await dump("HEAD (pre-fix)", materializeHead(), path.resolve(ROOT, arg), rel)
  const mine = await dump("WORKING TREE (fix)", path.join(ROOT, "src/ast/real-cpp-analyzer.ts"), path.resolve(ROOT, arg), rel)
  console.log(`\n=== DELTA ===`)
  console.log(`  symbols added:   ${mine.syms.filter((s) => !head.syms.includes(s)).join(" | ") || "(none)"}`)
  console.log(`  symbols removed: ${head.syms.filter((s) => !mine.syms.includes(s)).join(" | ") || "(none)"}`)
  console.log(`  edges added:     ${mine.rels.filter((r) => !head.rels.includes(r)).join(" | ") || "(none)"}`)
  console.log(`  edges removed:   ${head.rels.filter((r) => !mine.rels.includes(r)).join(" | ") || "(none)"}`)
}
main()
