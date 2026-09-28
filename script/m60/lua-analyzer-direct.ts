// parseWithAnalyzer — run RealLuaAnalyzer and hand back its ParseResult BEFORE
// the pool-worker's mapper runs.
//
// WHY THIS EXISTS
// ---------------
// The analyzer's metadata block (coroutineUsage, performanceScore,
// detectedFrameworks, architecturalScore, codeQuality, …) is DROPPED at the
// worker boundary: pool-worker's symbol/relationship mapper carries a narrow
// allowlist and, by its own comment, stopped passing `metadata` through
// (src/ast/pool-worker.ts:549-590). That is LUA-03, and it is a pipeline
// property, not a lua one — java's metadata is absent through the same path.
//
// So a gate that reads these fields through `parseFile` sees every one of them
// MISSING and passes vacuously. A gate that cannot fail is not a gate, so this
// helper exists: it loads the grammar, parses, runs the real analyzer class, and
// returns the analyzer's own ParseResult with its metadata intact.
//
// That makes it a direct probe of the ANALYZER, which is exactly what a gate on
// LUA-02/04/10/11 has to be: those four findings are all about values the
// analyzer computes and publishes, so testing them through a pipeline that
// discards them would test the discard, not the computation.
//
// Recorded so the next reader does not "simplify" the gate into using parseFile
// and silently make it vacuous.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"
import { RealLuaAnalyzer } from "../../src/ast/real-lua-analyzer"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { parseFile } from "../../src/ast/pool-worker"

let warmed = false

export async function parseWithAnalyzer(file: string): Promise<any> {
  const mod: any = await loadWebTreeSitter()
  if (!warmed) {
    // The tree-sitter core is initialised lazily by the engine's first parse; a
    // raw Language.load before that throws
    // "Cannot read properties of undefined (reading 'loadWebAssemblyModule')".
    // Measured, not assumed: the same call succeeds after one production parse.
    await parseFile("$HOME/fixtures/repositories/luvit/init.lua", "$HOME/fixtures")
    warmed = true
  }
  const lang: any = await mod.Language.load(resolveWasmAsset("tree-sitter-lua.wasm"))
  const parser = new mod.Parser()
  parser.setLanguage(lang)
  const tree = parser.parse(readFileSync(file, "utf8"))
  const analyzer = new RealLuaAnalyzer()
  const result = analyzer.analyze(tree.rootNode, readFileSync(file, "utf8"), file) as ASTEngine.ParseResult
  try { tree.delete() } catch {}
  return result
}
