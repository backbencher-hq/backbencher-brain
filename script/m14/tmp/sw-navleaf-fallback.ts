// script/m14/tmp/sw-navleaf-fallback.ts — the measurement behind the ONE unexplained
// edge the full-extent swift-nio draw reports (`calls _shutdownGracefully ->
// queueCallbackPair` at MultiThreadedEventLoopGroup.swift:509).
//
// Question: when a call's callee is a navigation_expression whose LAST
// navigation_suffix holds no identifier (a tuple position, `.0` / `.1`), the
// analyzer's `navigationLeaf` falls through to "last simple_identifier child" —
// which is the RECEIVER. This probe enumerates every such site on both pinned
// corpora, with the source line, so the ruling is measured rather than assumed.
//
// Run: bun script/m14/tmp/sw-navleaf-fallback.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = ["swift-nio", "alamofire"].map((r) => path.join("<corpus-root>/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|\.build|build|dist|\.git)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".swift")) out.push(p)
  }
  return out
}

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))

let sites = 0
const shapes: Record<string, number> = {}
for (const repo of REPOS) {
  for (const f of filesUnder(repo).sort()) {
    const src = fs.readFileSync(f, "utf8")
    const p = new P()
    p.setLanguage(LANG)
    const tree = p.parse(src)
    const lines = src.split("\n")
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "call_expression") {
        let func: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "navigation_expression") { func = c; break }
        }
        if (func) {
          // The last navigation_suffix sibling of the callee navigation.
          let lastSuffix: any = null
          for (let i = 0; i < func.namedChildCount; i++) {
            const c = func.namedChild(i)
            if (c && c.type === "navigation_suffix") lastSuffix = c
          }
          if (lastSuffix) {
            let id: any = null
            for (let i = 0; i < lastSuffix.namedChildCount; i++) {
              const c = lastSuffix.namedChild(i)
              if (c && (c.type === "simple_identifier" || c.type === "identifier")) id = c
            }
            if (!id) {
              sites++
              const ln = lastSuffix.startPosition.row + 1
              const key = `suffixChild=${lastSuffix.namedChild(0)?.type ?? "none"}`
              shapes[key] = (shapes[key] ?? 0) + 1
              console.log(`  ${path.relative(ROOT, f)}:${ln}  [${key}]  | ${(lines[ln - 1] ?? "").trim().slice(0, 110)}`)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
    p.delete?.()
  }
}
console.log(`\nsites=${sites} shapes=${JSON.stringify(shapes)}`)
