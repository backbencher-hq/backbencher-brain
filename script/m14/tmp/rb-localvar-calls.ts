/**
 * Do the `t` and `sort` `calls` edges name BLOCK-LOCAL VARIABLES? (M60)
 *
 * The corpus-wide `calls` classification left two suspicious names: `t` (112
 * edges) and `sort` (121). A call to a block parameter is the SIG-A shape —
 * a name bound in the method's own scope that the analyzer treats as a
 * dispatchable method. If that is what these are, they are FABRICATED edges,
 * which is the one class in this round worth a parser fix.
 *
 * Reads the analyzer's own output next to the block's parameter list, so the
 * claim is checked against the tree rather than argued from a name.
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
// Suspect names come from `--names=`, never from the positional list: a corpus
// root is not a method name, and a probe that cannot tell them apart reports
// "0 calls to a suspect" over two nonsense names and reads as a clean result.
const namesArg = process.argv.find((a) => a.startsWith("--names="))
const SUSPECTS = new Set(namesArg ? namesArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : ["t", "sort"])

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let e: fs.Dirent[]; try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) { if (x.name.startsWith(".")) continue; const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) } else if (x.isFile() && x.name.endsWith(".rb")) out.push(p) }
  }
  walk(root); return out.sort()
}

/** Every name a block/method parameter or local assignment binds, per method body. */
function bindingsIn(node: any): Set<string> {
  const names = new Set<string>()
  const stack: any[] = [node]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "block_parameters" || n.type === "method_parameters" || n.type === "parameters") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "identifier" || c.type === "optional_parameter" || c.type === "keyword_parameter" || c.type === "splat_parameter" || c.type === "block_parameter")) {
          const t = c.text
          if (/^[a-z_][A-Za-z0-9_]*[?!]?$/.test(t)) names.add(t)
          const inner = /[a-z_][A-Za-z0-9_]*/.exec(t); if (inner) names.add(inner[0])
        }
      }
    }
    if (n.type === "assignment" || n.type === "operator_assignment") {
      const lhs = n.childForFieldName?.("left")
      const t = lhs?.text ?? ""
      if (/^[a-z_][A-Za-z0-9_]*$/.test(t)) names.add(t)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return names
}

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser(); parser.setLanguage(lang as any)
  const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }
  const byName = new Map<string, number>()
  const local: Array<any> = []
  const nonlocal: Array<any> = []
  for (const f of files) {
    let content: string; try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any; try { tree = parser.parse(content) } catch { continue }
    let res: any; try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    const rel = path.relative(roots[0] ?? path.dirname(f), f)
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? "") !== "calls") continue
      const t = String(r.target ?? "")
      if (!SUSPECTS.has(t)) continue
      byName.set(t, (byName.get(t) ?? 0) + 1)
      const line = r.line_number ?? 0
      // find the innermost node on that line and look for bindings around it
      let ctxNode: any = null
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        if (n.startPosition && n.endPosition && n.startPosition.row + 1 <= line && line <= n.endPosition.row + 1) {
          if (!ctxNode || (n.endPosition.row - n.startPosition.row) < (ctxNode.endPosition.row - ctxNode.startPosition.row)) ctxNode = n
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.child(i); if (c) stack.push(c) }
      }
      const bound = ctxNode ? bindingsIn(ctxNode).has(t) : false
      const rec = { file: rel, line, target: t, source: String(r.source ?? ""),
        body: content.split("\n")[Math.max(0, line - 1)]?.trim().slice(0, 100) ?? "" }
      ;(bound ? local : nonlocal).push(rec)
    }
  }
  console.log("=".repeat(92))
  console.log("M60 — ARE THESE `calls` EDGES POINTING AT BLOCK-LOCAL VARIABLES?")
  console.log("=".repeat(92))
  console.log(`corpus files parsed: ${files.length}   suspect names: ${[...SUSPECTS].join(", ")}`)
  console.log(`calls to a suspect name: ${[...byName.values()].reduce((a, b) => a + b, 0)}`)
  console.log(`  name is bound as a LOCAL in the enclosing scope: ${local.length}`)
  console.log(`  name is NOT locally bound (a real method call)  : ${nonlocal.length}\n`)
  for (const r of local.slice(0, 12)) console.log(`  LOCAL   ${r.file}:${r.line}  ${r.target}   | ${r.body}`)
  for (const r of nonlocal.slice(0, 8)) console.log(`  method  ${r.file}:${r.line}  ${r.target}   | ${r.body}`)
  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-localvar-calls.json"),
    JSON.stringify({ at: new Date().toISOString(), filesParsed: files.length, suspects: [...SUSPECTS],
      counts: Object.fromEntries(byName), localBound: local.length, notLocalBound: nonlocal.length,
      local: local.slice(0, 300), notLocal: nonlocal.slice(0, 120) }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-localvar-calls.json")
}
main()
