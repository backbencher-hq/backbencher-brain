/**
 * ZIG DEEP-REVIEW HARNESS (shared by the zigw-* probes).
 *
 * Loads the pinned tree-sitter-zig wasm through the project's own loader
 * (`src/util/wasm.ts`), then exposes:
 *   - `parser()`      — a web-tree-sitter Parser bound to the zig grammar
 *   - `analyze(src)`  — the REAL analyzer's output for a source string
 *   - `walk(n)`       — pre-order named-child walk (the analyzer's own order)
 *   - `zigFiles()`    — the corpus file list for the three pinned zig repos
 *   - `relType`       — the RelationshipType enum
 *
 * Every probe in this lane goes through here so the grammar is loaded ONE way;
 * a probe that hand-rolled `Parser.init({locateFile})` is how the previous wave's
 * probes ended up pinned to another machine's absolute paths.
 */
import * as fs from "fs"
import * as path from "path"
import { loadWebTreeSitter, hasWasmInRegistry } from "../../../src/util/wasm"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
import { ASTEngine } from "../../../src/ast/engine"

export const REPO_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname)
export const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
export const ZIG_REPOS = ["zig", "zls", "ghostty"] as const

let _parser: any = null
let _analyzer: any = null

export async function init(): Promise<any> {
  const wts: any = await loadWebTreeSitter()
  const P: any = wts.Parser ?? wts.default?.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init()
  const bytes = hasWasmInRegistry("tree-sitter-zig.wasm")
  if (!bytes) throw new Error("tree-sitter-zig.wasm not found in the wasm registry")
  const LANG: any = await L.load(bytes)
  const p = new P()
  p.setLanguage(LANG)
  _parser = p
  _analyzer = new RealZigAnalyzer()
  return p
}

export function parser(): any {
  if (!_parser) throw new Error("call init() first")
  return _parser
}

export function analyzer(): any {
  if (!_analyzer) throw new Error("call init() first")
  return _analyzer
}

export const relType = ASTEngine.RelationshipType

/** Parse + run the real analyzer. Returns the ParseResult. */
export function analyze(src: string, filePath = "probe.zig"): ASTEngine.ParseResult {
  const tree = parser().parse(src)
  return analyzer().analyze(tree.rootNode, src, filePath) as ASTEngine.ParseResult
}

/** Parse only. */
export function parse(src: string): any {
  return parser().parse(src).rootNode
}

export function walk(n: any, visit: (n: any) => void): void {
  const w: any[] = [n]
  while (w.length > 0) {
    const c = w.pop()!
    visit(c)
    for (let i = c.namedChildCount - 1; i >= 0; i--) {
      const k = c.namedChild(i)
      if (k) w.push(k)
    }
  }
}

export function zigFiles(repos: readonly string[] = ZIG_REPOS, limit = Infinity): string[] {
  const out: string[] = []
  for (const repo of repos) {
    const root = path.join(CORPUS, repo)
    if (!fs.existsSync(root)) continue
    const stack: string[] = [root]
    while (stack.length > 0) {
      const d = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const q = path.join(d, e.name)
        if (e.isDirectory()) {
          if (!/^(\.git|node_modules|zig-cache|zig-out|\.zig-cache)$/.test(e.name)) stack.push(q)
        } else if (e.name.endsWith(".zig")) out.push(q)
      }
    }
  }
  out.sort()
  return limit === Infinity ? out : out.slice(0, limit)
}

/** Compact relationship row for probe output. */
export function rel(r: any): string {
  return `${r.type} ${r.source} -> ${r.target}@${r.line_number ?? "-"} c=${r.confidence} [${(r.metadata as any)?.relationshipType ?? "-"}]`
}

/** Compact symbol row for probe output. */
export function sym(s: any): string {
  return `${s.kind} ${s.name} scope=${s.scope ?? "-"} owner=${s.ownerName ?? "-"} @${s.range?.startLine ?? "-"}:${s.range?.startColumn ?? "-"} cx=${s.complexity ?? "-"} params=${(s.parameters ?? []).length} rt=${s.returnType ?? "-"}`
}
