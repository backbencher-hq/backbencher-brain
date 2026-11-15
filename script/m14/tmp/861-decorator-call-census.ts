// #861 decision input: how many CALL expressions in the four web corpora sit in
// DECORATOR position? That is the blast radius of the "a decorator invocation is
// metadata on the decorated symbol, never a call edge from the enclosing scope"
// rule (the python family already rules this way — PYD1 — and its oracle skips
// the positions to match). Also counts decorated declarations, so the range fix's
// surface is known separately from the call-attribution decision.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
// .vue/.svelte are SFC CONTAINERS: the real analyzers pre-parse their script
// block, so parsing them with the plain JS grammar produces garbage nodes
// (measured: `.svelte` "decorator" hits were misparsed CSS at-rules). Only the
// plain-source repos/extensions are counted here, with their own grammar.
const CORPORA: Array<{ repo: string; exts: string[] }> = [
  { repo: "vue-core", exts: [".ts", ".tsx"] },
  { repo: "element-plus", exts: [".ts", ".tsx"] },
  { repo: "lodash", exts: [".js"] },
  { repo: "grails-core", exts: [".js"] },
  { repo: "vue-element-admin", exts: [".js"] },
]
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out)
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammars = new Map<string, any>()
  for (const [name, file] of [["ts", "tree-sitter-typescript.wasm"], ["js", "tree-sitter-javascript.wasm"]] as const) {
    grammars.set(name, await L.load(readFileSync(path.join(ROOT, "wasm", file))))
  }

  let totalFiles = 0
  let decoratedDecls = 0
  let decoratorCalls = 0
  const callSites: string[] = []
  const declSites: string[] = []
  for (const c of CORPORA) {
    const dir = path.join(CORPUS_ROOT, c.repo)
    const files = walk(dir, c.exts).sort()
    for (const f of files) {
      const isTs = f.endsWith(".ts") || f.endsWith(".tsx")
      const parser = new P()
      parser.setLanguage(grammars.get(isTs ? "ts" : "js"))
      let tree: any
      try {
        tree = parser.parse(readFileSync(f, "utf8"))
      } catch {
        continue
      }
      totalFiles++
      const rel = path.relative(CORPUS_ROOT, f)
      // decorator-position calls: walk with an ancestor flag
      const stack: Array<{ n: any; inDec: boolean }> = [{ n: tree.rootNode, inDec: false }]
      while (stack.length) {
        const { n, inDec } = stack.pop()!
        const nowInDec = inDec || n.type === "decorator"
        if (n.type === "decorator" && !inDec) {
          decoratedDecls++
          declSites.push(`${rel}:${n.startPosition.row + 1}`)
        }
        if (n.type === "call_expression" && nowInDec) {
          decoratorCalls++
          const callee = n.namedChild(0)
          callSites.push(`${rel}:${n.startPosition.row + 1} -> ${callee?.text}`)
        }
        for (let i = 0; i < n.namedChildCount; i++) stack.push({ n: n.namedChild(i), inDec: nowInDec })
      }
      parser.delete?.()
    }
  }
  console.log(`files scanned:                  ${totalFiles}`)
  console.log(`decorators (decl sites):        ${decoratedDecls}`)
  console.log(`call_expression IN decorator:   ${decoratorCalls}`)
  console.log("\nfirst 20 decorator call sites:")
  for (const s of [...new Set(callSites)].slice(0, 20)) console.log(`   ${s}`)
  console.log("\nfirst 12 decorated declarations:")
  for (const s of [...new Set(declSites)].slice(0, 12)) console.log(`   ${s}`)
}

main()
