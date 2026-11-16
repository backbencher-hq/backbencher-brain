// script/m14/tmp/clean-127-hole.ts
//
// A byte offset that no leaf covers, inside a tree reported as error-free. What node chain
// contains the hole, and what are its children's spans? If an enclosing node's own source
// span includes the hole while its children skip over it, a token was elided from a valid
// parse — which is a grammar defect, not error-recovery noise.
//
// Run: bun script/m14/tmp/clean-127-hole.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")

// (repo/rel, byte offset of the missing byte, human label)
const PROBES: [string, number, string][] = [
  ["eastwood/src/languageServer/Compiler.icl", 5562, "the `-` of `indexOfNewlineBefore -1`"],
  ["eastwood/src/languageServer/Target.dcl", 1565, "the `-` of `Target -> Bool`"],
  ["Clyde/cleantools/Pm/PmParse.icl", 39117, "the `-` of `!String -> (!Bool,...)`"],
]

async function makeParser(): Promise<any> {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const mk = async (wasm: string) => {
    const language = await L.load(readFileSync(wasm))
    const p = new P()
    p.setLanguage(language)
    return p
  }
  return { pinned: await mk(PINNED), candidate: await mk(CANDIDATE) }
}

function chainTo(root: any, offset: number): any[] {
  const chain: any[] = []
  const visit = (n: any): boolean => {
    if (offset < n.startIndex || offset >= n.endIndex) {
      // zero-width and out-of-range nodes cannot contain the offset
      if (n.startIndex === n.endIndex) return false
      if (offset >= n.endIndex || offset < n.startIndex) return false
    }
    chain.push(n)
    for (const k of n.children ?? []) if (visit(k)) return true
    return true
  }
  visit(root)
  return chain
}

function describe(n: any, src: string): string {
  const t = src.slice(n.startIndex, n.endIndex)
  return `${n.type}[${n.startIndex},${n.endIndex})${n.isMissing ? " MISSING" : ""}${n.isError ? " ERROR" : ""} ${JSON.stringify(t.length > 60 ? t.slice(0, 60) + "…" : t)}`
}

async function main() {
  const p = await makeParser()
  for (const [entry, offset, label] of PROBES) {
    const m = entry.match(/^([^/]+)\/(.+)$/)!
    const src = readFileSync(path.join(CORPUS, m[1], m[2]), "utf8")
    console.log(`\n=== ${entry} @ byte ${offset} — ${label}`)
    console.log(`    byte: ${JSON.stringify(src[offset])}   context: ${JSON.stringify(src.slice(offset - 24, offset + 24))}`)
    for (const [name, parser] of [["pinned", p.pinned], ["candidate", p.candidate]] as const) {
      const tree = parser.parse(src)
      console.log(`  -- ${name}  errors=${tree.rootNode.hasError}`)
      const chain = chainTo(tree.rootNode, offset)
      for (let i = 0; i < chain.length; i++) {
        const n = chain[i]
        const pad = "     " + "  ".repeat(i)
        const kids = (n.children ?? []).map((k: any) => `${k.type}[${k.startIndex},${k.endIndex})`).join(" ")
        console.log(`${pad}${describe(n, src)}`)
        if (kids) console.log(`${pad}  children: ${kids}`)
      }
      const deepest = chain[chain.length - 1]
      const coveredByChildren = (deepest.children ?? []).some((k: any) => k.startIndex <= offset && k.endIndex > offset)
      console.log(`     hole inside deepest node (${deepest.type}) covered by a child? ${coveredByChildren}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
