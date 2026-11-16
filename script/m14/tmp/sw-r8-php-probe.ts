// script/m14/tmp/sw-r8-php-probe.ts — why does R8 read 0 php sites now while the
// committed artifact (and the register) record 8? The census scans
// `src/ast/real-*-analyzer.ts` source text only, so this runs the classifier on the
// EXACT committed blob and on the working tree, and prints both.
//
// Run: bun script/m14/tmp/sw-r8-php-probe.ts
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"

import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const mod: any = await import("../../../script/m60/framework-surface-census")
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
// The census scans TS sources, so its parser is the pinned typescript grammar.
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm"))))

const FILE = "real-php-analyzer.ts"
const work = fs.readFileSync(`<corpus-root>/mcp/backbencher-brain/src/ast/${FILE}`, "utf8")
const head = execFileSync("git", ["show", `HEAD:src/ast/${FILE}`], { cwd: "<corpus-root>/mcp/backbencher-brain", encoding: "utf8" })

for (const [label, src] of [["WORKTREE", work], ["HEAD", head]] as Array<[string, string]>) {
  const r = (mod as any).scanFile(parser, FILE, src)
  console.log(`\n=== ${label} (${src.length} bytes) parseError=${r.parseError}`)
  console.log(`  publishedContractKeys: ${JSON.stringify(r.scan.publishedContractKeys)}`)
  console.log(`  bindingsExamined: ${r.scan.bindingsExamined}`)
  console.log(`  sites: ${r.scan.sites.length}`)
  for (const s of r.scan.sites.slice(0, 12)) console.log(`    L${s.line} ${s.shape} [${s.key}] ${s.verdict} :: ${String(s.statement).slice(0, 80)}`)
}
