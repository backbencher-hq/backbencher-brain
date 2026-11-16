// script/m14/tmp/py-748-delta-attribution.ts — WHICH two cython edges did #748
// remove, and from which shadowed body? The differential reports the delta as
// symmetric (both sides -2, MISSING=0, unexplained=0), which proves the two
// sides agree but not which sites moved. This probe finds the phantom defs with
// the analyzer's own scope model and lists the call sites and member reads
// inside each shadowed body — the candidate set the removed edges come from.
//
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CYTHON = "<corpus-root>/bb_tests/repositories/cython"
const FILES = [
  "Cython/Build/Dependencies.py",
  "Cython/Compiler/Pythran.py",
  "runtests.py",
  "tests/run/class_scope.py",
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm")))

  for (const rel of FILES) {
    const content = fs.readFileSync(path.join(CYTHON, rel), "utf8")
    const p = new P()
    p.setLanguage(LANG)
    const root = p.parse(content).rootNode
    const ckey = (n: any) => `${n.type}:${n.startIndex}:${n.endIndex}`
    const byContainer = new Map<string, Map<string, any[]>>()
    const frames: { n: any; container: string; inFn: boolean }[] = [{ n: root, container: ckey(root), inFn: false }]
    while (frames.length > 0) {
      const { n, container, inFn } = frames.pop()!
      let nc = container, nf = inFn
      if (n.type === "class_definition" || n.type === "module") { nc = ckey(n); nf = false }
      else if (n.type === "function_definition") {
        if (!inFn) {
          const nm = n.namedChildren.find((c: any) => c.type === "identifier")?.text
          if (nm) { const m = byContainer.get(container) ?? new Map<string, any[]>(); m.set(nm, [...(m.get(nm) ?? []), n]); byContainer.set(container, m) }
        }
        nf = true
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) frames.push({ n: n.namedChild(i), container: nc, inFn: nf })
    }
    for (const [, m] of byContainer)
      for (const [nm, defs] of m) {
        if (defs.length < 2) continue
        // chain check: any decorator on any member that marks a declaration chain
        let chain = false
        for (const d of defs) {
          const par = d.parent
          if (!par || par.type !== "decorated_definition") continue
          for (let i = 0; i < par.namedChildCount; i++) {
            const c = par.namedChild(i)
            if (c?.type === "decorator" && /^@\s*(overload|property)\b|\.(setter|getter|deleter)\s*$/.test(c.text)) chain = true
          }
        }
        console.log(`\n=== ${rel} :: ${nm} x${defs.length} lines=${defs.map((d: any) => d.startPosition.row + 1).join(",")} chain=${chain}`)
        for (let i = 0; i < defs.length - (chain ? 0 : 1); i++) {
          const d = defs[i]
          const calls: string[] = []
          const reads: string[] = []
          const stack = [d]
          while (stack.length > 0) {
            const n = stack.pop()!
            if (n.type === "call") {
              const fn = n.namedChild(0)
              const leaf = fn?.type === "identifier" ? fn.text : fn?.type === "attribute" ? fn.namedChild(fn.namedChildCount - 1)?.text : undefined
              if (leaf) calls.push(`${leaf}@${n.startPosition.row + 1}`)
            }
            if (n.type === "attribute") {
              const leaf = n.namedChild(n.namedChildCount - 1)
              if (leaf && leaf.type === "identifier") reads.push(`${leaf.text}@${n.startPosition.row + 1}`)
            }
            for (let k = n.namedChildCount - 1; k >= 0; k--) stack.push(n.namedChild(k))
          }
          const isPhantom = !chain && i < defs.length - 1
          console.log(`  ${isPhantom ? "PHANTOM(dropped)" : "chain member(kept)"} def@${d.startPosition.row + 1} calls=[${calls.join(" ")}] attrReads=[${reads.join(" ")}]`)
        }
      }
  }
}
main()
