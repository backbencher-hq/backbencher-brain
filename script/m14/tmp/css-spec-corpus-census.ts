// Build instrument: corpus census for the CSS completeness spec.
//
//   bun script/m14/tmp/css-spec-corpus-census.ts > /tmp/opencode/css-census.json
//
// The 78 minimal reproductions in css-spec-classify.ts prove a type is REACHABLE
// on purpose; this proves which types the real corpus actually contains, so the
// spec's `handled_verified` / `internal_silent` split rests on observed code
// rather than on a table I wrote. For every node type seen it records how many
// files contain it, and whether the analyzer emits a symbol, an edge, a pattern,
// or nothing at all for it.

import { Parser, Language } from "web-tree-sitter"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/svelte"
const EXT = process.argv[3] ?? ".css"

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

function walk(dir: string, out: string[] = []): string[] {
  let ents: any[] = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const f = join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (e.name.endsWith(EXT)) out.push(f)
  }
  return out
}

const files = walk(ROOT).sort()
const nonempty = files.filter((f) => readFileSync(f, "utf8").trim().length > 0)

/** type -> { files, nodes, emitsFiles (files where the analyzer produced something) } */
const census = new Map<string, { files: number; nodes: number; symFiles: number; relFiles: number }>()
let errFiles = 0, errNodes = 0, crashes = 0, totalRels = 0, totalSyms = 0

for (const f of nonempty) {
  const src = readFileSync(f, "utf8")
  const tree = p.parse(src)
  const seen = new Set<string>()

  const w = (x: any) => {
    seen.add(x.type)
    if (x.type === "ERROR" || x.isMissing) errNodes++
    for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) w(c) }
  }
  w(tree.rootNode)
  if (tree.rootNode.hasError) errFiles++
  tree.delete?.()

  let syms = 0, rels = 0
  try {
    const r: any = await ASTEngine.parseFile(f, src)
    syms = r.symbols?.length ?? 0
    rels = r.relationships?.length ?? 0
  } catch { crashes++ }
  totalSyms += syms; totalRels += rels

  for (const t of seen) {
    const e = census.get(t) ?? { files: 0, nodes: 0, symFiles: 0, relFiles: 0 }
    e.files++
    if (syms > 0) e.symFiles++
    if (rels > 0) e.relFiles++
    census.set(t, e)
  }
}

const ALL: string[] = []
for (let i = 0; i < lang.nodeTypeCount; i++) ALL.push(lang.nodeTypeForId(i))

// tree-sitter's OWN named/anonymous flag, not a regex guess: the grammar pin gate
// reports ids / namedUnique / anonUnique from this flag, and the spec's buckets
// have to speak the same vocabulary or the two documents cannot be compared.
const namedFlag = new Map<string, boolean>()
for (let i = 0; i < lang.nodeTypeCount; i++) namedFlag.set(lang.nodeTypeForId(i), lang.nodeTypeIsNamed(i))

const rows = ALL.map((t) => ({
  type: t,
  nodeTypeIsNamed: namedFlag.get(t) ?? null,
  ...(census.get(t) ?? { files: 0, nodes: 0, symFiles: 0, relFiles: 0 }),
}))

console.log(JSON.stringify({
  corpusRoot: ROOT, ext: EXT,
  filesTracked: files.length, filesNonEmpty: nonempty.length,
  filesWithGrammarError: errFiles, errorNodes: errNodes, crashes,
  totalSymbols: totalSyms, totalRelationships: totalRels,
  vocabulary: {
    ids: ALL.length,
    namedUnique: new Set(ALL.filter((t) => namedFlag.get(t))).size,
    anonUnique: new Set(ALL.filter((t) => !namedFlag.get(t))).size,
    note: "from tree-sitter's nodeTypeIsNamed flag, the same vocabulary script/m14/verify-grammar-pins.ts reports",
  },
  typesSeenInCorpus: rows.filter((r) => r.files > 0).length,
  typesNeverSeen: rows.filter((r) => r.files === 0).length,
  typesNeverSeenList: rows.filter((r) => r.files === 0).map((r) => r.type),
  rows,
}, null, 2))
p.delete?.()
