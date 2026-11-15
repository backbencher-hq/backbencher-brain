// script/m14/tmp/clean-127-arrow-minimal.ts
//
// Minimal reproduction of the v1.2.7 defect found by the G2 leaf census: in some contexts
// the candidate consumes the `-` of `->` and emits NO token for it, so source text becomes
// unreachable from the tree. Under the pinned v1.2.4 the same bytes are fully covered.
//
// A grammar defect has to be shown, not inferred, so this prints both trees for the smallest
// inputs that reproduce it, plus which bytes each tree fails to cover.
//
// Run: bun script/m14/tmp/clean-127-arrow-minimal.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")

const CASES: [string, string][] = [
  ["dcl type signature", `targetMatches :: !Target !Target -> Bool\n`],
  ["dcl type signature, no strict", `f :: Target -> Bool\n`],
  ["icl type signature", `f :: Int -> Int\nf x = x\n`],
  ["negative literal after name", `f = indexOfNewlineBefore -1\n`],
  ["negative literal, plain", `f = g -1\n`],
  ["negative literal, parenthesised", `f = g (-1)\n`],
  ["arrow after newline-indent", `SkipToNewLine ::\t!Bool !Int\n\t\t\t-> !Bool\n`],
  ["arrow, adjacent", `f::Int->Int\n`],
  ["arrow in a function body", `f x = x -> 2\n`],
  ["tuple after arrow", `f :: !Int -> (!Bool, !Int)\n`],
]

function uncovered(root: any, src: string): string[] {
  const spans: [number, number][] = []
  const visit = (n: any) => {
    const kids = n.children ?? []
    if (!kids.length) { if (n.endIndex > n.startIndex) spans.push([n.startIndex, n.endIndex]); return }
    for (const k of kids) visit(k)
  }
  visit(root)
  spans.sort((a, b) => a[0] - b[0])
  const out: string[] = []
  let cur = 0
  for (const [s, e] of spans) {
    if (s > cur && src.slice(cur, s).trim()) out.push(JSON.stringify(src.slice(cur, s)))
    cur = Math.max(cur, e)
  }
  if (cur < src.length && src.slice(cur).trim()) out.push(JSON.stringify(src.slice(cur)))
  return out
}

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

async function main() {
  const p = await makeParser()
  let reproduced = 0
  for (const [name, src] of CASES) {
    const a = p.pinned.parse(src)
    const b = p.candidate.parse(src)
    const ua = uncovered(a.rootNode, src)
    const ub = uncovered(b.rootNode, src)
    const hit = ub.length > 0 && ua.length === 0
    if (hit) reproduced++
    console.log(`### ${name}${hit ? "   <<< REPRODUCED" : ""}`)
    console.log(`  input:      ${JSON.stringify(src)}`)
    console.log(`  pinned:     errors=${a.rootNode.hasError} uncovered=${ua.length ? ua.join(" ") : "none"}`)
    console.log(`  candidate:  errors=${b.rootNode.hasError} uncovered=${ub.length ? ub.join(" ") : "none"}`)
    const flat = (n: any) => (n.toString().split("\n")[0] ?? "").slice(0, 240)
    console.log(`  pinned tree:    ${flat(a.rootNode)}`)
    console.log(`  candidate tree: ${flat(b.rootNode)}`)
    console.log()
  }
  console.log(`${reproduced} of ${CASES.length} cases: candidate drops source text that pinned covers.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
