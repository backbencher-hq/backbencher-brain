// script/m14/tmp/oc-m12-msg-probe.ts — why does the M12 differential observe NO
// `calls` edge for `[NSError errorWithDomain:...]` and `[prefix stringByAppendingString:...]`
// while the same file's `uses` rows DO arrive? Runs the analyzer twice: standalone
// (direct class call) and through the production entry (pool-worker parseFile, which
// is what the differential uses), and prints both edge sets side by side.
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const file = path.join(ROOT, "validation/m12/fixtures/objective-c/Negative.m")
  const content = readFileSync(file, "utf8")
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const p = new P(); p.setLanguage(LANG)
  const direct: any = await new mod.RealObjectiveCAnalyzer().analyze(p.parse(content).rootNode, content, "Negative.m")
  console.log("== STANDALONE analyzer")
  for (const e of direct.relationships ?? []) console.log(`   ${e.type} ${e.source} -> ${e.target} (line ${e.line_number}, conf ${e.confidence})`)
  console.log("== via pool-worker parseFile (the differential's path)")
  const viaPool: any = await parseFile(file, ROOT)
  for (const e of viaPool.relationships ?? []) console.log(`   ${e.type} ${e.source} -> ${e.target} (line ${(e as any).line_number}, conf ${e.confidence})`)
}
main()
