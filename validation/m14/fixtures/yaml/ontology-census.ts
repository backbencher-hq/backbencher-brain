/**
 * YAML's SPACE + CONSTRUCT CENSUS — the artefact behind
 * `validation/m14/fixtures/yaml/ruling-attestation.json`.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `script/m14/ontology-coverage-gate.ts` certifies a lane's ABSENT types only when the ruling
 * says WHICH SPACES its probe enumerated. That gate learned the lesson on HCL: a node-type
 * inventory certified `extends` absent while 44 `inherits` attribute-key sites sat in the same
 * corpus, because Docker-bake spells inheritance as a KEY and no vocabulary can see a key.
 *
 * YAML has the same exposure and it is not hypothetical — the wired grammar's entire field
 * surface is two fields (`key`, `value`), and 1.38M `contains` edges come from mapping pairs, so a
 * construct spelled as a mapping KEY is the normal way to write anything in this language. Run
 * without an attestation the arbiter printed, over the whole admitted population:
 *
 *     ontology coverage gate — no RULING SOURCE for yaml.
 *     Refusing to report: with no ruling anywhere, every un-emitted type would be called
 *     RULED-UNJUSTIFIED …
 *
 * So this census measures the three spaces the gate asks a KEY-BEARING language to declare —
 * `node-types`, `block-types`, `attribute-keys` — plus the construct-site counts for the two
 * types yaml rules absent, and writes them to a JSON artefact. The attestation points at this
 * file; every number the gate reads is read THROUGH a pointer into this artefact, so a stale
 * attestation fails rather than passes.
 *
 * ## WHAT "CONSTRUCT SITE" MEANS HERE, AND WHY ZERO IS NOT ASSUMED
 *
 * A construct site is a spot where the corpus WRITES the construct, i.e. where the analyzer would
 * have to read it. For a KEY-bearing language the trap is a keyword KEY (`implements:`, `new:`) that
 * a vocabulary probe cannot see. But a keyword key is not automatically a site: `create: true` in a
 * k8s manifest and `create: x.yml` in a task list both spell the word and neither constructs
 * anything. The rule used here, stated so it can be argued with:
 *
 *   a pair whose key is a conformance/construction keyword is a SITE only when the document ALSO
 *   declares a TYPE for it to name — the same test the spec's YAML-D10/D11 apply. YAML has NO
 *   type-declaration construct at all (that is what instrument A measures), so the type set is
 *   empty and the site count is 0 by construction, MEASURED rather than asserted.
 *
 * The raw keyword populations are printed beside the site counts, because "we looked and found
 * none" and "we found 311 and excluded them all with a rule" are different statements.
 *
 * ## POPULATION
 *
 * Whole admitted `.yaml`/`.yml` population, walked with a stride draw whose size is STATED in the
 * artefact (default 4000, override with argv[2]). A stride draw is enough for a SPACE question —
 * "does this language write key/value bindings, and how many distinct keys" — which is what the
 * gate asks. The grammar inventory half reads the WASM directly and is population-independent.
 *
 * usage:  npx tsx validation/m14/fixtures/yaml/ontology-census.ts [drawSize]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
const OUT = "validation/m14/fixtures/yaml/ontology-census.json"
const DRAW = Number(process.argv[2] ?? process.env.YAML_ONTOLOGY_DRAW ?? 4000)

/** Keys that would mean CONFORMANCE if a document also declared a type. */
const IMPLEMENTS_KEYWORDS = ["implements", "interface", "protocol", "trait", "impl", "conforms", "satisfies"]
/** Keys that would mean CONSTRUCTION if a document also declared a type. */
const INSTANTIATES_KEYWORDS = ["new", "instantiate", "newinstance", "create", "construct", "clone"]
/** Node types that would mean a TYPE DECLARATION, had the grammar one. */
const DECLARATION_NODE_TYPES = [
  "class_declaration",
  "interface_declaration",
  "declaration",
  "type_declaration",
  "extends_clause",
  "implements_clause",
  "base_class_clause",
]
/** Node types that would mean CONSTRUCTION, had the grammar one. */
const CONSTRUCTION_NODE_TYPES = [
  "new_expression",
  "object_creation",
  "constructor_call",
  "class_instance",
  "instance",
]

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

/** A mapping pair's key text, read through the grammar's own `key` field, unquoted. */
const keyTextOf = (pair: any): string | null => {
  const k = pair.childForFieldName?.("key")
  if (!k) return null
  const raw = String(k.text ?? "").trim()
  if (raw.length >= 2) {
    const a = raw[0]
    if ((a === '"' || a === "'") && raw[raw.length - 1] === a) return raw.slice(1, -1)
  }
  return raw
}
const valueNodeOf = (pair: any): any => pair.childForFieldName?.("value") ?? null

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))

  // ---- 1. the grammar's enumerable surface (population-independent) --------
  const named: string[] = []
  const anon: string[] = []
  const fields: string[] = []
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    if (grammar.nodeTypeIsNamed(i)) named.push(grammar.nodeTypeForId(i))
    else anon.push(grammar.nodeTypeForId(i))
  }
  for (let i = 1; i <= grammar.fieldCount; i++) fields.push(grammar.fieldNameForId(i))
  const namedTypes = [...new Set(named)].sort()
  const declarationNodeTypesPresent = DECLARATION_NODE_TYPES.filter((t) => namedTypes.includes(t))
  const constructionNodeTypesPresent = CONSTRUCTION_NODE_TYPES.filter((t) => namedTypes.includes(t))

  // ---- 2. the walk ---------------------------------------------------------
  const all: string[] = []
  walk(CORPUS_ROOT, all)
  all.sort()
  const stride = all.length <= DRAW ? 1 : Math.ceil(all.length / DRAW)
  const chosen = all.filter((_, i) => i % stride === 0)

  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const nodeTypes = new Map<string, number>()
  const attrKeys = new Map<string, number>()
  const topLevelKeys = new Map<string, number>()
  let attrKeySites = 0
  const blockTypeCounts = new Map<string, number>()
  const implementsKeywordSites: Array<{ key: string; file: string; line: number }> = []
  const instantiatesKeywordSites: Array<{ key: string; file: string; line: number }> = []
  let implementsSiteCount = 0
  let instantiatesSiteCount = 0
  let documentsDeclaringAType = 0
  let parsed = 0
  let failed = 0
  const repos = new Set<string>()

  for (const f of chosen) {
    let content: string
    try {
      content = fs.readFileSync(f, "utf8")
    } catch {
      failed++
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      failed++
      continue
    }
    if (!tree?.rootNode) {
      failed++
      continue
    }
    parsed++
    const rel = path.relative(CORPUS_ROOT, f)
    repos.add(rel.split(path.sep)[0])

    // Does this DOCUMENT declare a type? (top-level or nested key in the declaration set.)
    const declaredTypeKeys = new Set<string>()

    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      if (n.parent && n.parent.type === "document") blockTypeCounts.set(n.type, (blockTypeCounts.get(n.type) ?? 0) + 1)
      if (n.type === "block_mapping_pair" || n.type === "flow_pair") {
        const k = keyTextOf(n)
        if (k !== null) {
          attrKeys.set(k, (attrKeys.get(k) ?? 0) + 1)
          attrKeySites++
          if (DECLARATION_NODE_TYPES.includes(k)) declaredTypeKeys.add(k)
          const line = (n.startPosition?.row ?? 0) + 1
          if (IMPLEMENTS_KEYWORDS.includes(k)) implementsKeywordSites.push({ key: k, file: rel, line })
          if (INSTANTIATES_KEYWORDS.includes(k)) instantiatesKeywordSites.push({ key: k, file: rel, line })
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }

    // The document's TOP-LEVEL sections: the pairs directly under the first block_mapping of the
    // document. This is the yaml analogue of HCL's block labels, and it is the space a construct
    // spelled as a top-level key would hide in.
    const doc = tree.rootNode.namedChildren?.find?.((c: any) => c.type === "document")
    const rootBlock = doc?.namedChildren?.find?.((c: any) => c.type === "block_node")?.namedChildren?.find?.((c: any) => c.type === "block_mapping")
      ?? doc?.namedChildren?.find?.((c: any) => c.type === "block_mapping")
    if (rootBlock) {
      for (let i = 0; i < rootBlock.namedChildCount; i++) {
        const c = rootBlock.namedChild(i)
        if (c?.type !== "block_mapping_pair") continue
        const k = keyTextOf(c)
        if (k !== null) topLevelKeys.set(k, (topLevelKeys.get(k) ?? 0) + 1)
      }
    }

    const declaresType = declaredTypeKeys.size > 0
    if (declaresType) documentsDeclaringAType++
    // The site rule: a keyword key is a SITE only when the document declares a type to name.
    if (declaresType) {
      for (const s of implementsKeywordSites) {
        if (s.file === rel && s.line >= 0) implementsSiteCount++
      }
      for (const s of instantiatesKeywordSites) {
        if (s.file === rel && s.line >= 0) instantiatesSiteCount++
      }
    }
  }

  const topTypes = [...nodeTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  const artefact = {
    _purpose:
      "The yaml lane's SPACE + CONSTRUCT census, read by validation/m14/fixtures/yaml/ruling-attestation.json through POINTERS so a stale attestation fails instead of passing. Emitted by validation/m14/fixtures/yaml/ontology-census.ts.",
    generatedAt: new Date().toISOString(),
    population: {
      corpusRoot: CORPUS_ROOT,
      filesOnDisk: all.length,
      draw: chosen.length,
      stride,
      repos: repos.size,
      parsed,
      failed,
      note: "A stride draw over the whole admitted .yaml/.yml population. Enough for a SPACE question; the grammar inventory half is population-independent.",
    },
    grammarInventory: {
      nodeTypeCount: grammar.nodeTypeCount,
      namedTypes: namedTypes.length,
      anonymousTokens: new Set(anon).size,
      fields,
      namedTypeList: namedTypes,
      declarationNodeTypesSought: DECLARATION_NODE_TYPES,
      declarationNodeTypesPresent,
      constructionNodeTypesSought: CONSTRUCTION_NODE_TYPES,
      constructionNodeTypesPresent,
    },
    treeCensus: {
      distinctNodeTypes: nodeTypes.size,
      distinctBlockTypes: blockTypeCounts.size,
      blockTypesNote: "distinct node types a document directly contains",
      distinctTopLevelKeys: topLevelKeys.size,
      distinctAttributeKeys: attrKeys.size,
      attributeKeySites: attrKeySites,
      topTypes: topTypes.map(([t, n]) => ({ type: t, count: n })),
      topLevelKeysByFrequency: [...topLevelKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => ({ key: k, count: n })),
    },
    implementsSites: implementsSiteCount,
    instantiatesSites: instantiatesSiteCount,
    candidateWordPopulations: {
      _rule:
        "A keyword KEY is a SITE only when the document ALSO declares a type for the construct to name. yaml has no type-declaration construct, so no document does, and the site counts are 0 by measurement. The raw keyword counts below are what was found and excluded.",
      implementsKeywordSites: implementsKeywordSites.length,
      instantiatesKeywordSites: instantiatesKeywordSites.length,
      documentsDeclaringAType,
      implementsSamples: implementsKeywordSites.slice(0, 20),
      instantiatesSamples: instantiatesKeywordSites.slice(0, 20),
    },
  }

  fs.writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")
  console.log(JSON.stringify({
    out: OUT,
    population: artefact.population,
    grammar: {
      nodeTypeCount: artefact.grammarInventory.nodeTypeCount,
      namedTypes: artefact.grammarInventory.namedTypes,
      declarationNodeTypesPresent,
      constructionNodeTypesPresent,
    },
    treeCensus: {
      distinctNodeTypes: artefact.treeCensus.distinctNodeTypes,
      distinctBlockTypes: artefact.treeCensus.distinctBlockTypes,
      distinctTopLevelKeys: artefact.treeCensus.distinctTopLevelKeys,
      distinctAttributeKeys: artefact.treeCensus.distinctAttributeKeys,
      attributeKeySites: artefact.treeCensus.attributeKeySites,
    },
    implementsSites: implementsSiteCount,
    instantiatesSites: instantiatesSiteCount,
    implementsKeywordSites: implementsKeywordSites.length,
    instantiatesKeywordSites: instantiatesKeywordSites.length,
  }, null, 2))
}

await main()
