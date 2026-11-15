/**
 * RUBY LANE — how many real `unknown` symbols does a REAL parse produce? (M60)
 *
 * `parallel-indexer.ts` denied the symbol name `unknown` in every language, and
 * the claim that this costs a real symbol needs to be REPRODUCIBLE rather than
 * asserted in a commit message. This prints every `unknown`-named symbol the
 * ruby analyzer produces from a real tree-sitter parse, with the file and line.
 *
 * FALLBACK RESULTS ARE SKIPPED, deliberately: the fix gates `unknown` on
 * `isFallbackResult`, so a regex-fallback `unknown` is noise by design and
 * counting it would measure the path that is supposed to drop it. This measures
 * the path that is supposed to KEEP it.
 *
 * Answer on a stride of rails and rubocop (800 files each): 1 real symbol, 0 —
 *   activesupport/lib/active_support/colorize_logging.rb:46
 *     def unknown(progname = nil, &block)
 * Ruby's Logger has five standard severities and `unknown` is one of them. One
 * symbol is why this was never noticed: the defect is real, and it is small.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-unknown-probe.ts <corpus-root>...
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
function list(root: string): string[] {
  const out: string[] = []
  const walk = (d: string) => { let e: fs.Dirent[]; try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) { if (x.name.startsWith(".")) continue; const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!new Set([".git","node_modules","vendor","tmp","log"]).has(x.name)) walk(p) }
      else if (x.name.endsWith(".rb")) out.push(p) } }
  walk(root); return out.sort()
}
await Parser.init()
const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
const parser = new Parser(); parser.setLanguage(lang as any)
for (const c of process.argv.slice(2)) {
  const files = list(path.resolve(c)).filter((_, i, a) => i % Math.ceil(a.length / 800) === 0)
  const hits: string[] = []
  for (const f of files) {
    let content: string; try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any; try { tree = parser.parse(content) } catch { continue }
    let res: any; try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    if (res.fallback) continue
    for (const s of res.symbols ?? []) if (s.name === "unknown") hits.push(`${path.relative(path.dirname(f), f)}:${s.startLine ?? s.range?.startLine} kind=${s.type ?? s.kind}`)
  }
  console.log(`${path.basename(c)}: ${hits.length} real 'unknown' symbols from a real parse`)
  for (const h of hits.slice(0, 8)) console.log("   " + h)
}
