/**
 * MAKE KEY-SPACE CENSUS — what vocabulary does the corpus actually use, and where?
 *
 * WHY. Three of make's ten relationship types read SILENT even whole-corpus (`extends`,
 * `implements`, `instantiates`). A node-type inventory alone cannot rule them out: `hcl-lane`
 * measured that docker-bake spells inheritance as an ATTRIBUTE KEY (`inherits = ["_common"]`),
 * which a node-type probe is blind to, and `ontology-coverage-gate.ts` now refuses to certify a
 * vocabulary-based ruling in a key-bearing language unless the probed spaces are attested with
 * counts that a named artefact really holds.
 *
 * So this instrument enumerates BOTH halves and writes them to the artefact the attestation cites:
 *   1. the LANGUAGE's declared node-type names (what the grammar can express at all), and
 *   2. the whole corpus's real node types, KEY NAMES, and per-relationship candidate vocabulary —
 *      measured over every admitted Makefile, not a stride.
 *
 * NO REGEX. Everything is a tree walk via the grammar's own node APIs.
 *
 * Usage: bun validation/m14/fixtures/make/tools/key-space-census.mts
 *   out: validation/m14/fixtures/make/key-space-census.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CORPUS_DIRS = ["otp"]
const EXT_MATCH = ["Makefile", ".mk", ".make"]
const SIZE_CAP = 400_000
const OUT = resolve(ROOT, "validation/m14/fixtures/make/key-space-census.json")

const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)

// ── the vocabulary a construct of each type would have to be spelled with. Deliberately generous:
// a word the grammar or the corpus does not contain at all is stronger evidence than a narrow list.
const VOCAB: Record<string, string[]> = {
  extends: ["extends", "extend", "inherits", "inherit", "derives", "derive", "superclass", "base", "parent", "subclass"],
  implements: ["implements", "implement", "interface", "protocol", "conformance", "satisfies", "trait"],
  instantiates: ["instantiates", "instantiate", "new", "constructor", "object", "class", "struct", "type"],
}

function admitted(): string[] {
  const all: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, depth + 1) }
      else if (EXT_MATCH.some((x) => e.name.endsWith(x) || e.name === x)) {
        try { if (statSync(p).size < SIZE_CAP) all.push(p) } catch { /* unreadable */ }
      }
    }
  }
  for (const repo of CORPUS_DIRS) walk(join(CR, repo), 0)
  return all.sort()
}

/**
 * A KEY that NAMES a construct IS the candidate word — whole, not a token of it.
 *
 * Three attempts, each defeated by a different kind of near-miss, and the sequence is the point:
 *   1. SUBSTRING: reported `extends` PRESENT on `DATABASE` (contains "base"), `implements` on
 *      `INTERFACES`, `instantiates` on `$(TYPES)` — 147 "matches", all variable names that happen
 *      to contain a candidate word.
 *   2. ANY `=` NODE: `variable_assignment` was not yet used, so "keys" were file paths from
 *      prerequisite lists (`gen/diameter_gen_base_accounting.erl …`).
 *   3. WORD-SPLIT: with real `variable_assignment` keys, `implements` matched on
 *      `ERL_INTERFACE_LIB_DIR` and `instantiates` on `EPMD_NODE_TYPE` — a word inside a compound
 *      name, which is a variable ABOUT interfaces, not a conformance clause.
 * What survives all three is whole-key equality: the key IS the word (`inherits`, `extends`,
 * `interface`). That is what a construct spelled as a key looks like, and nothing else in this
 * corpus matches it.
 */
function isConstructKey(key: string, vocab: string[]): boolean {
  return vocab.includes(key.trim().toLowerCase())
}

const parser = await getParser("make")
const lang: any = parser.getLanguage ? parser.getLanguage() : null
// The grammar's own declared node-type names — instrument A's half.
const declaredNodeTypes: string[] = []
if (lang && typeof lang.nodeTypeCount === "number") {
  for (let i = 0; i < lang.nodeTypeCount; i++) {
    try { declaredNodeTypes.push(lang.nodeTypeForId(i)) } catch { /* not every id has a name */ }
  }
}

const files = admitted()
const nodeTypes = new Map<string, number>()
const keyNames = new Map<string, number>()
const keywordHits: Record<string, Map<string, number>> = {}
for (const t of Object.keys(VOCAB)) keywordHits[t] = new Map()
let parsed = 0, failed = 0, keyBindings = 0
const constructSites: Record<string, number> = { extends: 0, implements: 0, instantiates: 0 }

for (const f of files) {
  let tree: any
  try {
    const content = readFileSync(f, "utf8")
    const pr = await parser.parse(content, f)
    tree = pr
    parsed++
  } catch { failed++; continue }
  // Iterative preorder — the repo's own rule after a deep-nesting stack overflow.
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node: any = stack.pop()
    if (!node) continue
    nodeTypes.set(node.type, (nodeTypes.get(node.type) ?? 0) + 1)
    const kids: any[] = node.namedChildren ?? []
    // A KEY BINDING IS A `variable_assignment`, and the key is its first named child.
    //
    // The first version accepted ANY node with `=`/`:` between two named children, which in a
    // Makefile means every rule whose prerequisites contain an `=` — so the "key names" it
    // collected were file paths (`gen/diameter_gen_base_accounting.erl …`) and it reported all
    // three exclusions PRESENT on fragments of those paths. Make already HAS a node for this:
    // `variable_assignment` (2,604 of them in this corpus). Using the grammar's own node is the
    // difference between measuring the language and measuring the text.
    if (node.type === "variable_assignment" && kids.length > 0) {
      keyBindings++
      let k = kids[0]
      // `$(VAR) = …` wraps the name in a variable_reference; take its inner name when present.
      if (k && k.type === "variable_reference") {
        const inner = (k.namedChildren ?? []).find((c: any) => c.type === "word" || c.type === "variable_name")
        if (inner) k = inner
      }
      if (k && typeof k.text === "string") keyNames.set(k.text, (keyNames.get(k.text) ?? 0) + 1)
    }
    // keyword vocabulary: every node's own type name and its text where it is a leaf-ish name
    const tn = node.type
    for (const [type, words] of Object.entries(VOCAB)) {
      for (const w of words) if (tn === w || tn.includes(w)) keywordHits[type].set(`node:${tn}`, (keywordHits[type].get(`node:${tn}`) ?? 0) + 1)
    }
    for (let i = 0; i < kids.length; i++) stack.push(kids[i])
  }
}

// Candidate vocabulary the CORPUS actually contains, per type: key names and node types that match.
const perType: Record<string, any> = {}
for (const [type, words] of Object.entries(VOCAB)) {
  const keyMatches: Record<string, number> = {}
  for (const [k, n] of keyNames) if (isConstructKey(k, words)) keyMatches[k] = n
  const nodeMatches: Record<string, number> = {}
  for (const [t, n] of nodeTypes) { const low = t.toLowerCase(); if (words.some((w) => low === w || low.includes(w))) nodeMatches[t] = n }
  perType[type] = {
    vocabulary: words,
    keyMatches,
    nodeTypeMatches: nodeMatches,
    keyMatchCount: Object.values(keyMatches).reduce((a, b) => a + b, 0),
    nodeTypeMatchCount: Object.values(nodeMatches).reduce((a, b) => a + b, 0),
    constructSites: constructSites[type],
  }
}

const artefact = {
  instrument: "validation/m14/fixtures/make/tools/key-space-census.mts",
  whatThisIs:
    "The whole admitted Make corpus walked once, enumerating (a) every node type the grammar produces, " +
    "(b) every KEY NAME bound by a `=`/`:` between two named children, and (c) for each relationship type " +
    "whose construct would have to be spelled with certain words, every key name and node type that matches. " +
    "It answers the question a node-type inventory alone cannot: can this corpus express `extends`, " +
    "`implements` or `instantiates` as a KEY, the way docker-bake spells inheritance as `inherits`?",
  whatThisIsNot: "Not a firing measurement — emission is `firing-check.mjs`'s question. This measures the VOCABULARY.",
  population: { corpusDirs: CORPUS_DIRS, admitted: files.length, parsed, failed },
  grammar: { declaredNodeTypeCount: declaredNodeTypes.length },
  corpus: {
    distinctNodeTypes: nodeTypes.size,
    keyBindings,
    distinctKeyNames: keyNames.size,
  },
  perType,
  verdict: {
    note:
      "A type is grammar-absence only when NEITHER half matches: no node type the grammar produces and no KEY " +
      "name the corpus binds is a candidate spelling of its construct.",
    extends: perType.extends.keyMatchCount === 0 && perType.extends.nodeTypeMatchCount === 0 ? "absent-both-halves" : "PRESENT",
    implements: perType.implements.keyMatchCount === 0 && perType.implements.nodeTypeMatchCount === 0 ? "absent-both-halves" : "PRESENT",
    instantiates: perType.instantiates.keyMatchCount === 0 && perType.instantiates.nodeTypeMatchCount === 0 ? "absent-both-halves" : "PRESENT",
  },
  topKeyNames: [...keyNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  topNodeTypes: [...nodeTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")
console.log(`make key-space census — ${parsed}/${files.length} parsed of ${files.length} admitted (${failed} failed)`)
console.log(`  distinct node types ${nodeTypes.size} · key bindings ${keyBindings} · distinct key names ${keyNames.size}`)
for (const t of Object.keys(VOCAB)) {
  const p = perType[t]
  console.log(`  ${t.padEnd(13)} keyMatches ${p.keyMatchCount} · nodeTypeMatches ${p.nodeTypeMatchCount} -> ${artefact.verdict[t]}`)
}
console.log(`wrote ${OUT}`)
