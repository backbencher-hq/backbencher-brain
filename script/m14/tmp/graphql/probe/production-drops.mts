/**
 * WHAT THE PRODUCTION ENTRY POINT DROPS.
 *
 * ## Why this probe exists
 *
 * Every other number in this lane is measured through `parseFile` from
 * `src/ast/pool-worker.ts`, because `analyze()` is a per-file unit that skips the
 * pipeline stages. That choice has a blind spot it cannot see from inside: `parseFile`
 * runs `keepSymbol` over the analyzer's output and DROPS symbols whose name is on a
 * denylist, so a symbol the analyzer derived correctly can still be absent from the
 * product — and a dropped symbol takes its relationships' SOURCE with it, leaving
 * edges that name nothing.
 *
 * The ontology census found the residue: 3 of 34,023 relationships across 426 corpus
 * files have an unresolvable source, and all three are on one field. This probe names
 * the field and the rule.
 *
 * ## What it measures
 *
 * Per corpus file: the analyzer's symbols, called directly; the production symbols,
 * through `parseFile`; and the set difference, keyed on (kind, qualified name, line).
 *
 * One reading detail cost this probe its first result. `parseFile`'s symbols carry
 * `startLine` at the TOP level, while `analyze()`'s carry a `range` object, so reading
 * `s.range?.startLine` on the production rows yields `undefined` for every symbol and
 * reports all 8,796 of them dropped. `keyOf` reads `s.range?.startLine ?? s.startLine`
 * and the number collapses to the truth.
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { HERE, OUT, ROOT } from "../paths.mts"

const { detectLanguageFromPath } = (await import(path.join(ROOT, "src/ast/language-detection"))) as any
const { parseFile } = (await import(path.join(ROOT, "src/ast/pool-worker"))) as any
const { RealGraphqlAnalyzer } = (await import(path.join(ROOT, "src/ast/real-graphql-analyzer"))) as any

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))

const admitted: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!fs.statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!/\.(graphql|gql|graphqls)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (fs.statSync(abs).size > 512 * 1024) continue
      text = fs.readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}

const keyOf = (s: any) => `${s.kind}|${s.qualifiedName ?? `${s.ownerName ? `${s.ownerName}.` : ""}${s.name}`}|${s.range?.startLine ?? s.startLine}`

const dropped: Array<{ file: string; kind: string; name: string; qualified: string; line: number }> = []
const orphanedRelationships: Array<{ file: string; type: string; source: string; target: string; line: number; role: string }> = []
let directSymbols = 0
let productionSymbols = 0
let directRelationships = 0
let productionRelationships = 0

for (const f of admitted) {
  const lab = `${f.repo}/${f.rel}`
  const tree = parser.parse(f.text)
  if (!tree) continue
  const direct: any = new RealGraphqlAnalyzer().analyze(tree.rootNode, f.text, f.abs)
  tree.delete?.()
  const prod: any = await parseFile(f.abs, f.dir)
  directSymbols += direct.symbols.length
  productionSymbols += prod.symbols.length
  directRelationships += direct.relationships.length
  productionRelationships += prod.relationships.length
  const kept = new Set(prod.symbols.map(keyOf))
  for (const s of direct.symbols) {
    if (kept.has(keyOf(s))) continue
    dropped.push({
      file: lab,
      kind: String(s.kind ?? ""),
      name: String(s.name ?? ""),
      qualified: String(s.qualifiedName ?? `${s.ownerName ? `${s.ownerName}.` : ""}${s.name}`),
      line: Number(s.range?.startLine ?? s.startLine ?? 0),
    })
    // The relationships whose SOURCE is the dropped symbol. These are the rows the
    // ontology census counted as unresolvable sources, and they are the cost of the
    // drop: the edge survives and names nothing.
    for (const r of direct.relationships) {
      if (String(r.source ?? "") !== String(s.name ?? "")) continue
      if (String(s.ownerName ?? "") && String(r.source ?? "") !== `${s.ownerName}.${s.name}`) continue
      orphanedRelationships.push({
        file: lab,
        type: String(r.type ?? ""),
        source: String(r.source ?? ""),
        target: String(r.target ?? ""),
        line: Number(r.line_number ?? 0),
        role: String(r.metadata?.relationshipRole ?? ""),
      })
    }
  }
}

const byName = new Map<string, number>()
for (const d of dropped) byName.set(d.name, (byName.get(d.name) ?? 0) + 1)

const out = {
  schemaVersion: 1,
  kind: "graphql-production-drops",
  generatedAt: new Date().toISOString(),
  producedBy: "script/m14/tmp/graphql/probe/production-drops.mts",
  corpusRoot: CR,
  files: admitted.length,
  direct: { symbols: directSymbols, relationships: directRelationships },
  production: { symbols: productionSymbols, relationships: productionRelationships },
  droppedSymbols: dropped,
  droppedSymbolCount: dropped.length,
  droppedByName: Object.fromEntries([...byName.entries()].sort((a, b) => b[1] - a[1])),
  relationshipsLeftWithoutASource: orphanedRelationships,
  finding:
    "pool-worker.ts `keepSymbol` carries a UNIVERSAL denylist of names it calls keywords or tree-sitter artifacts: this, super, self, Self, me, My, destructor, root, program, source_file, module_declaration, package_manifest, GlobalScope, SCSS_FILE_SCOPE, unknown. GraphQL has NO keyword named `me` — it is an ordinary field name in most public APIs — so a correct analyzer symbol is deleted on the way to the store, and every relationship sourced on it is stored naming nothing. `pool-worker.ts` is shared machinery (all 46 lanes), so this probe measures and names it rather than editing it.",
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "production-drops.json"), JSON.stringify(out, null, 2) + "\n")

console.log(`production drops — ${admitted.length} corpus files`)
console.log(`  analyzer direct : ${directSymbols} symbols, ${directRelationships} relationships`)
console.log(`  production parseFile: ${productionSymbols} symbols, ${productionRelationships} relationships`)
console.log(`  DROPPED SYMBOLS: ${dropped.length}  ${JSON.stringify(out.droppedByName)}`)
for (const d of dropped) console.log(`    ${d.file}:${d.line} ${d.kind} ${d.qualified}`)
console.log(`  relationships left without a source: ${orphanedRelationships.length}`)
for (const r of orphanedRelationships) console.log(`    ${r.file}:${r.line} ${r.type} ${r.source} -> ${r.target} (${r.role})`)
console.log(`  wrote ${path.relative(ROOT, path.join(OUT, "production-drops.json"))}`)
process.exitCode = dropped.length === 0 ? 0 : 1