/**
 * Regenerate `extends-construct-probe.json` — the measurement behind
 * `script/m14/clean-ruled.ts`'s single ruling.
 *
 *   npx tsx validation/m14/fixtures/clean/extends-construct-probe.mts [--limit N]
 *
 * The census itself is imported from the ruling table, so the evidence file and the
 * arbiter's instrument-B probe cannot drift apart: there is one walk, and this script
 * records what it returned.
 *
 * Two populations are reported separately and never mixed, because a count without its
 * population is a statement about the wrong thing:
 *
 *   TRACKED  what `git ls-files` admits for the language — the same 312 files
 *            `script/m14/ontology-coverage-gate.ts` walks, so the JSON states the
 *            arbiter's own numbers rather than a different draw.
 *   WIDE     git-tracked PLUS `script/m14/clean-wide-manifest.txt` (2,181 files,
 *            content-deduplicated). This is the population the ruling's prose quotes.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { censusCleanDeclarations, CLEAN_DECLARATION_NODES, CLEAN_DECLARATION_SLOTS, CLEAN_SUPERTYPE_NODE_TYPES, CLEAN_SUPERTYPE_WORDS } from "../../../../script/m14/clean-ruled"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = path.resolve(process.cwd())
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const OUT = path.join(ROOT, "validation", "m14", "fixtures", "clean", "extends-construct-probe.json")
const argv = process.argv.slice(2)
const li = argv.indexOf("--limit")
const LIMIT = li >= 0 ? Number(argv[li + 1]) : 0

function gitTrackedCleanFiles(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of fs.readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try { if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "clean") continue
      if (seen.has(abs)) continue
      seen.add(abs); out.push(abs)
    }
  }
  return out.sort()
}

const tracked = gitTrackedCleanFiles()
const wide = new Set(tracked)
if (fs.existsSync(WIDE)) {
  for (const l of fs.readFileSync(WIDE, "utf8").split("\n")) {
    const abs = l.trim()
    if (!abs || wide.has(abs) || !fs.existsSync(abs)) continue
    if (fs.statSync(abs).size > 512 * 1024) continue
    if (detectLanguageFromPath(abs, fs.readFileSync(abs, "utf8")) !== "clean") continue
    wide.add(abs)
  }
}
const wideList = [...wide].sort()
const sample = (list: string[]) => (LIMIT > 0 ? list.slice(0, LIMIT) : list)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmPath = path.join(ROOT, "wasm", "tree-sitter-clean.wasm")
const grammar: any = await L.load(fs.readFileSync(wasmPath))
const parser = new P()
parser.setLanguage(grammar)

function run(list: string[], label: string) {
  const produced = new Map<string, number>()
  const totals = { files: 0, parsed: 0, unparsed: 0, nodes: 0, declarations: 0, unclassified: 0 }
  const byNodeType: Record<string, number> = {}
  const slotsByRole: Record<string, number> = {}
  const slotTypesByRole: Record<string, string[]> = {}
  const examples: { file: string; line: number; nodeType: string; childType: string; text: string }[] = []
  const declFiles = new Set<string>()
  const childInventory: Record<string, number> = {}
  const unclassifiedByChildType: Record<string, number> = {}
  for (const f of list) {
    totals.files++
    let t: any
    try { t = parser.parse(fs.readFileSync(f, "utf8")) } catch { t = null }
    if (!t) { totals.unparsed++; continue }
    totals.parsed++
    const count = (n: any) => { produced.set(n.type, (produced.get(n.type) ?? 0) + 1); totals.nodes++; for (let i = 0; i < n.childCount; i++) count(n.child(i)) }
    count(t.rootNode)
    const c = censusCleanDeclarations(t.rootNode)
    totals.declarations += c.declarations
    totals.unclassified += c.unclassified.length
    for (const [k, v] of Object.entries(c.byNodeType)) byNodeType[k] = (byNodeType[k] ?? 0) + v
    for (const [k, v] of Object.entries(c.slotsByRole)) slotsByRole[k] = (slotsByRole[k] ?? 0) + v
    for (const [k, v] of Object.entries(c.slotTypesByRole)) slotTypesByRole[k] = v.slice().sort()
    for (const [k, v] of Object.entries(c.childInventory)) childInventory[k] = (childInventory[k] ?? 0) + v
    for (const [k, v] of Object.entries(c.unclassifiedByChildType)) unclassifiedByChildType[k] = (unclassifiedByChildType[k] ?? 0) + v
    for (const u of c.unclassified) {
      if (examples.length < 20) examples.push({ ...u, file: path.relative(CR, f) })
      declFiles.add(path.relative(CR, f))
    }
    t.delete?.()
  }
  const producedList = [...produced.keys()].sort()
  const supertypeHits = CLEAN_SUPERTYPE_NODE_TYPES.filter((n) => produced.has(n))
  const wordHits = CLEAN_SUPERTYPE_WORDS.filter((n) => produced.has(n))
  const declaredTypes: string[] = grammar.types ?? []
  const declaredFields: string[] = (grammar.fields ?? []).filter((f: unknown): f is string => typeof f === "string")
  const CLEAN_KEYWORDS = ["class", "instance", "where", "with", "derive", "import", "definition", "implementation", "infix", "special", "generic", "if", "case", "let", "export", "qualified", "as", "from", "module", "of", "::", "|", "deriving"]
  const keywordsPresent = CLEAN_KEYWORDS.filter((k) => declaredTypes.includes(k))
  const supertypeInDeclaredTypes = CLEAN_SUPERTYPE_WORDS.filter((n) => declaredTypes.includes(n))
  const supertypeFieldHits = declaredFields.filter((f) => /^(extends|extend|implements|inherit|inheritance|superclass|super|base_class|parent_class|base_type|parent|mixin|sub_type|subclass)$/.test(f))
  const result = {
    population: label,
    files: totals.files,
    filesParsed: totals.parsed,
    filesUnparsed: totals.unparsed,
    nodesWalked: totals.nodes,
    distinctNodeTypesProduced: producedList.length,
    distinctNodeTypesProducedList: producedList,
    instrumentA: {
      supertypeNodeTypesProbed: CLEAN_SUPERTYPE_NODE_TYPES.length,
      supertypeNodeTypesProduced: supertypeHits,
      supertypeWordsProbed: CLEAN_SUPERTYPE_WORDS.length,
      supertypeWordsProduced: wordHits,
      grammarDeclaredTypes: declaredTypes.length,
      grammarDeclaredFields: declaredFields.length,
      cleanKeywordsProbed: CLEAN_KEYWORDS.length,
      cleanKeywordsPresentAsDeclaredTypes: keywordsPresent,
      supertypeWordsInDeclaredTypes: supertypeInDeclaredTypes,
      supertypeSlotFieldNamesInDeclaredFields: supertypeFieldHits,
    },
    instrumentB: {
      declarationNodesWalked: totals.declarations,
      byDeclarationNodeType: byNodeType,
      unclassified: totals.unclassified,
      unclassifiedExamples: examples,
      unclassifiedByChildType,
      filesWithUnclassified: declFiles.size,
      slotsByRole,
      slotTypesByRole,
      childInventory,
      declarationNodesProbed: CLEAN_DECLARATION_NODES,
      slotTable: CLEAN_DECLARATION_SLOTS,
    },
  }
  console.log(
    `${label}: files ${totals.files} (parsed ${totals.parsed}, unparsed ${totals.unparsed}); nodes ${totals.nodes.toLocaleString()}; ` +
      `node types ${producedList.length}; declarations ${totals.declarations}; UNCLASSIFIED ${totals.unclassified}`,
  )
  console.log(`  A: ${supertypeHits.length + wordHits.length} of ${CLEAN_SUPERTYPE_NODE_TYPES.length + CLEAN_SUPERTYPE_WORDS.length} probed supertype names produced; declared types ${declaredTypes.length} / fields ${declaredFields.length}; keywords ${keywordsPresent.length}/${CLEAN_KEYWORDS.length}; supertype field names ${supertypeFieldHits.length}`)
  return result
}

const out = {
  generatedBy: "validation/m14/fixtures/clean/extends-construct-probe.mts",
  wasm: path.relative(ROOT, wasmPath),
  corpusRoot: CR,
  note:
    "TWO POPULATIONS, never mixed. TRACKED is what git ls-files + detectLanguageFromPath admits — the same set script/m14/ontology-coverage-gate.ts walks. WIDE adds script/m14/clean-wide-manifest.txt (content-deduplicated) and is the population the ruling's prose quotes.",
  tracked: run(sample(tracked), "TRACKED (git ls-files, what the arbiter walks)"),
  wide: run(sample(wideList), "WIDE (git ls-files + committed wide manifest)"),
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
if (out.wide.instrumentB.unclassified > 0) {
  console.log(`\n>>> extends construct occurs ${out.wide.instrumentB.unclassified}x — the ruling is FALSIFIED by its own probe.`)
  process.exitCode = 1
} else {
  console.log(`extends: 0 on instrument B and 0 on instrument A over ${out.wide.files} files. RULED.`)
}
