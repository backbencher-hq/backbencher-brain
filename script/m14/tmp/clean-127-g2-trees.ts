// script/m14/tmp/clean-127-g2-trees.ts
//
// G2 adjudication for the tree-sitter-clean v1.2.4 → v1.2.7 candidate.
//
// F11's G2 gate found 14 files that are CLEAN under the pinned grammar and yet produce
// a different s-expression under the candidate, and it reports only the file list. G2
// exists because a count-level view said "pure win" for a cpp candidate that silently
// re-shaped 119 already-clean files (#743c), so a shape change on a clean file is the
// one thing that must be read rather than counted. This probe produces what the ruling
// needs: for each of the 14, both trees, the node-type multiset delta, and the FIRST
// differing path — then, for the shapes that matter, the source text at that point.
//
// Run: bun script/m14/tmp/clean-127-g2-trees.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")
const FILES = (process.env.G2_FILES ?? "").split(",").filter(Boolean)

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

function walk(node: any, out: { types: Map<string, number>; paths: string[] }, prefix = ""): void {
  const t = node.type
  out.types.set(t, (out.types.get(t) ?? 0) + 1)
  const kids = node.children ?? []
  // A path that names the child by FIELD where the grammar has one: field names are what
  // an analyzer keys on, so a shape change that moves a name between fields is invisible
  // to a node-type histogram and is exactly the class G2 was built to catch.
  for (let i = 0; i < kids.length; i++) {
    const field = node.fieldNameForChild?.(i) ?? null
    out.paths.push(`${prefix}${t}${field ? "." + field : ""}>`)
    walk(kids[i], out, `${prefix}${t}${field ? "." + field : ""}>`)
  }
}

function multiset(nodes: Map<string, number>): Map<string, number> { return nodes }

function delta(a: Map<string, number>, b: Map<string, number>): { added: [string, number][]; removed: [string, number][] } {
  const added: [string, number][] = []
  const removed: [string, number][] = []
  for (const [k, v] of b) { const d = v - (a.get(k) ?? 0); if (d > 0) added.push([k, d]) }
  for (const [k, v] of a) { const d = v - (b.get(k) ?? 0); if (d > 0) removed.push([k, d]) }
  return { added: added.sort((x, y) => y[1] - x[1]), removed: removed.sort((x, y) => y[1] - x[1]) }
}

async function main() {
  const p = await makeParser()
  const list = FILES.length ? FILES : []
  console.log(`G2 adjudication — pinned v1.2.4 vs candidate ${path.basename(CANDIDATE)}\n`)
  for (const entry of list) {
    const m = entry.match(/^([^/]+)\/(.+)$/)
    if (!m) continue
    const [, repo, rel] = m
    const abs = path.join(CORPUS, repo, rel)
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { console.log(`  ${entry}: unreadable`); continue }
    const a = p.pinned.parse(src)
    const b = p.candidate.parse(src)
    const A = { types: new Map<string, number>(), paths: [] as string[] }
    const B = { types: new Map<string, number>(), paths: [] as string[] }
    walk(a.rootNode, A); walk(b.rootNode, B)
    const { added, removed } = delta(multiset(A.types), multiset(B.types))
    const sa = a.rootNode.toString(), sb = b.rootNode.toString()
    // First differing line of the two s-expressions: the smallest thing a reader can look at.
    const la = sa.split("\n"), lb = sb.split("\n")
    let first = -1
    for (let i = 0; i < Math.max(la.length, lb.length); i++) if ((la[i] ?? "") !== (lb[i] ?? "")) { first = i; break }
    // Path-level: is the change a RE-SHAPE (same path set, different nesting) or a
    // genuine structural difference (a path exists on one side only)?
    const pathA = new Map<string, number>()
    for (const x of A.paths) pathA.set(x, (pathA.get(x) ?? 0) + 1)
    const pathB = new Map<string, number>()
    for (const x of B.paths) pathB.set(x, (pathB.get(x) ?? 0) + 1)
    const pd = delta(pathA, pathB)
    console.log(`### ${entry}   (${src.split("\n").length} lines)`)
    console.log(`  errors: pinned=${a.rootNode.hasError} candidate=${b.rootNode.hasError}`)
    console.log(`  node types delta: +${added.slice(0, 6).map(([k, n]) => `${k}×${n}`).join(" ") || "none"}  -${removed.slice(0, 6).map(([k, n]) => `${k}×${n}`).join(" ") || "none"}`)
    console.log(`  paths added ${pd.added.length}, removed ${pd.removed.length}`)
    for (const [k, n] of pd.added.slice(0, 3)) console.log(`    + ${k} ×${n}`)
    for (const [k, n] of pd.removed.slice(0, 3)) console.log(`    - ${k} ×${n}`)
    if (first >= 0) {
      console.log(`  first differing line of the s-expression (${first + 1}):`)
      console.log(`    pinned:    ${(la[first] ?? "").trim().slice(0, 200)}`)
      console.log(`    candidate: ${(lb[first] ?? "").trim().slice(0, 200)}`)
    }
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
