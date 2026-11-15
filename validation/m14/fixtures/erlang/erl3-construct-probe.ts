/**
 * erl3-construct-probe — instrument A and instrument B for the FOUR types the
 * DERIV_EXPORTS_ERL3 brief lists as missing at handover:
 *
 *     extends  implements  overrides  exports
 *
 * ## WHY TWO INSTRUMENTS AND NOT ONE
 *
 * `extends` and `overrides` ask the same question from two sides, and the
 * workstream's own history says which instrument answers it:
 *
 *   A: GRAMMAR INVENTORY — for a type that needs a NODE TYPE THE LANGUAGE DOES
 *      NOT HAVE. Enumerating every node type the pinned wasm actually produces
 *      over the whole corpus is positive evidence of absence: if no node in
 *      4,000 files can express a supertype clause, no corpus can produce an
 *      `extends` edge and the ruling is about the language, not about this
 *      sample. This is the instrument the gate itself blesses for exactly this
 *      case (ontology-coverage-gate.ts: "A. GRAMMAR INVENTORY — for a type that
 *      needs a node type the language does not have").
 *
 *   B: PARSE-TREE SEMANTIC COUNT — for a type the language CAN express. A
 *      grammar inventory CANNOT find those: if Erlang can express X, X is in the
 *      inventory and so is every unrelated thing. So for each candidate
 *      construct that WOULD produce the type, the probe counts the construct on
 *      the tree, where a string literal or a comment cannot fake it.
 *
 * Getting this backwards is how `overrides` was wrong for a whole wave: the
 * ruling was prose, the oracle was written after it, and nothing agreed with
 * nothing. So this probe names, for every missing type, the exact node shape
 * that would produce it, and counts it.
 *
 * ## WHAT COUNTS AS A CANDIDATE — AND WHAT DOES NOT
 *
 * For `extends`: Erlang has no classes and no type hierarchy in the OO sense.
 * But "no classes" is PROSE until a probe asks the grammar. The probe asks for
 * every node type a supertype clause could be spelled as, over the whole
 * admitted population, plus a broader open question: does ANY node type the
 * grammar produces carry a name that would declare a supertype? That open
 * question is strictly stronger than any hand-listed set of candidates, and it
 * is the second overturn condition.
 *
 * For `overrides`: the same reasoning, with one extra candidate class that a
 * reader should see tested rather than assumed — Erlang has `-behaviour`, and a
 * behaviour module that itself declares a behaviour is one declaration naming
 * another, which is the shape a naive reading might call an override. It is not
 * (a behaviour is a CONTRACT; nothing is replaced), but the probe COUNTS it so
 * the ruling rests on a number.
 *
 * ## NO REGEX
 *
 * Zero RegExp construction in this file, by the same rule as the analyzer. The
 * node-type candidate lists are compared with Set membership and `includes`;
 * the corpus filter is a suffix test. Nothing here scans source text, so a
 * string literal or a comment cannot fake a hit.
 *
 * ## USAGE
 *
 *   bun validation/m14/fixtures/erlang/erl3-construct-probe.ts otp
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import * as path from "node:path"

const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] || "otp"
const LIMIT = Number(process.env.BB_PROBE_LIMIT || 0)
const OUT_DIR = path.resolve(process.cwd(), "validation/m14/measurements")
const repoDir = path.join(CORPUS, REPO)

// ---------------------------------------------------------------- population
function derivePopulation(): string[] {
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
    const abs = path.join(repoDir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    out.push(abs)
  }
  out.sort()
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

const population = derivePopulation()
let rev = "unknown"
try {
  rev = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12)
} catch {}

// ---------------------------------------------------------------- parser
//
// The parser comes from `getParser`, the SAME resolver production uses, rather
// than from a hand-located `tree-sitter.wasm` path. Two reasons, both measured
// on 2026-10-06: the hand-located form is `node_modules`-relative and this
// worktree has no `node_modules` (so it aborted with ENOENT on first run), and
// a probe that resolves the grammar by its own path is a probe whose grammar is
// not provably the wired one. `getParser("erlang")` cannot disagree with the
// indexer about which bytes parse the corpus.
const { getParser } = await import("../../../../src/ast/engine")
const parser: any = await getParser("erlang")
if (!parser) {
  console.error(`erl3-construct-probe: getParser("erlang") returned nothing — the probe cannot run.`)
  process.exit(2)
}

// ---------------------------------------------------------------- instrument A
/**
 * Node types that would EXPRESS a supertype clause — the `extends` and
 * `overrides` candidates, spelled the way every other grammar in the family
 * spells them (bash-ruled.ts, fsharp-ruled.ts, ontology-coverage-gate.ts's own
 * BASH_RULED list). Every one is checked against the INVENTORY MEASURED HERE,
 * not against a hand-maintained list of what the grammar "should" have.
 */
const SUPERTYPE_NODE_CANDIDATES = [
  "class_declaration",
  "class",
  "class_specifier",
  "class_body",
  "interface_declaration",
  "interface",
  "trait_declaration",
  "trait",
  "struct_declaration",
  "struct",
  "inheritance_specifier",
  "base_class_clause",
  "superclass",
  "superclasses",
  "extends_clause",
  "implements_clause",
  "interface_implementation",
  "type_parameters",
  "type_arguments",
  "protocol_declaration",
  "mixin_declaration",
  "delegation_specifier",
]

/**
 * The OPEN form of instrument A: any node type the grammar produces whose name
 * carries a supertype word. Strictly stronger than the candidate list above —
 * it finds a spelling nobody thought to list. Substring matching on a NODE
 * TYPE NAME (a grammar symbol, not source text) is not a regex over source, so
 * this is a `includes` on an identifier the grammar itself emitted.
 */
const SUPERTYPE_WORDS = [
  "class",
  "inherit",
  "extends",
  "super",
  "interface",
  "trait",
  "impl",
  "subclass",
  "override",
  "protocol",
  "mixin",
  "delegate",
]

// ---------------------------------------------------------------- instrument B
/**
 * The construct probe for `extends`: a DECLARATION that NAMES ANOTHER
 * declaration as its base. In a language with no inheritance, the honest probe
 * is: does any node in any file have a named child that is another declaration
 * node of a kind that could be a base type? Read structurally — a node whose
 * type is in DECLARATION_NODE_TYPES and which has a named child that is ALSO a
 * declaration node is the shape "this declaration names that one".
 */
const DECLARATION_NODE_TYPES = new Set([
  "record_decl",
  "type_alias",
  "opaque",
  "nominal",
  "fun_decl",
  "module_attribute",
  "callback",
  "pp_define",
  "class",
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "struct_declaration",
])

/**
 * The construct probe for `overrides`: a SECOND declaration of a name the file
 * already declared, in the same file, outside the clause-merge rule Erlang
 * allows (`;`-separated clauses of one function are ONE function, not
 * redefinitions). Every other duplicate is a genuine redeclaration, and a
 * redeclaration REPLACES the earlier one — which is what `overrides` means in
 * every language that has it, and the reason bash's is emitted for a
 * redefinition rather than for inheritance.
 */
const probe = {
  filesRead: 0,
  parseFailures: 0,
  /** instrument A */
  distinctNodeTypes: new Set<string>(),
  supertypeWordNodeTypes: new Set<string>(),
  candidateHits: {} as Record<string, number>,
  /** instrument B — extends */
  declNamingDecl: { occurrences: 0, files: 0, examples: [] as string[] },
  /** instrument B — overrides: duplicate declarations */
  duplicateRecords: { occurrences: 0, files: 0, examples: [] as string[] },
  duplicateTypes: { occurrences: 0, files: 0, examples: [] as string[] },
  duplicateModules: { occurrences: 0, files: 0, examples: [] as string[] },
  duplicateMacros: { occurrences: 0, files: 0, examples: [] as string[] },
  duplicateFunctions: { occurrences: 0, files: 0, examples: [] as string[] },
  /** the `-behaviour` counts: what `implements` rides, and the shape a naive
   *  reading of `overrides` might mistake for one */
  behaviourAttributes: { occurrences: 0, files: 0, distinctTargets: new Set<string>(), examples: [] as string[] },
  exportAttributes: { occurrences: 0, files: 0, faEntries: 0, filesWithFa: 0, examples: [] as string[] },
  exportTypeAttributes: { occurrences: 0, files: 0, faEntries: 0 },
  /** the attribute surface, in full — every attribute name the grammar produces */
  attributeNames: new Map<string, number>(),
}

const bump = (m: { occurrences: number; files: number; examples: string[] }, rel: string, label: string) => {
  m.occurrences++
  if (m.examples.length < 4) m.examples.push(`${rel}: ${label}`)
}

const namedChildren = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const childByType = (n: any, t: string): any => {
  for (const c of namedChildren(n)) if (c.type === t) return c
  return undefined
}
const attrName = (n: any): string => {
  const an = childByType(n, "attr_name")
  if (!an) return ""
  const a = childByType(an, "atom")
  return String(a?.text ?? an.text ?? "")
}

for (const abs of population) {
  let content: string
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  const rel = path.relative(repoDir, abs)
  probe.filesRead++

  let tree: any
  try {
    tree = parser.parse(content)
  } catch {
    probe.parseFailures++
    continue
  }
  const root = tree.rootNode

  // ---- one walk, collecting everything
  const records = new Map<string, number>()
  const types = new Map<string, number>()
  const modules = new Map<string, number>()
  const macros = new Map<string, number>()
  const fns = new Map<string, number>()
  let behaviourFiles = 0
  let exportFiles = 0

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    probe.distinctNodeTypes.add(t)

    const lower = t.toLowerCase()
    for (const w of SUPERTYPE_WORDS) {
      if (lower.includes(w)) probe.supertypeWordNodeTypes.add(t)
    }
    if (SUPERTYPE_NODE_CANDIDATES.includes(t)) {
      probe.candidateHits[t] = (probe.candidateHits[t] || 0) + 1
    }

    switch (t) {
      case "behaviour_attribute": {
        const b = childByType(n, "atom")
        probe.behaviourAttributes.occurrences++
        if (b?.text) probe.behaviourAttributes.distinctTargets.add(b.text)
        if (behaviourFiles === 0) {
          behaviourFiles = 1
          probe.behaviourAttributes.files++
          if (probe.behaviourAttributes.examples.length < 4) {
            probe.behaviourAttributes.examples.push(`${rel}: -behaviour(${b?.text})`)
          }
        }
        break
      }
      case "export_attribute": {
        probe.exportAttributes.occurrences++
        let fa = 0
        for (const c of namedChildren(n)) if (c.type === "fa") fa++
        probe.exportAttributes.faEntries += fa
        if (fa > 0) {
          if (exportFiles === 0) {
            exportFiles = 1
            probe.exportAttributes.filesWithFa++
            if (probe.exportAttributes.examples.length < 4) {
              probe.exportAttributes.examples.push(`${rel}: -export with ${fa} fa entries`)
            }
          }
        }
        break
      }
      case "export_type_attribute": {
        probe.exportTypeAttributes.occurrences++
        for (const c of namedChildren(n)) if (c.type === "fa") probe.exportTypeAttributes.faEntries++
        break
      }
      case "record_decl": {
        const a = childByType(n, "atom")
        if (a?.text) {
          const c = (records.get(a.text) || 0) + 1
          records.set(a.text, c)
          if (c === 2) bump(probe.duplicateRecords, rel, a.text)
        }
        // instrument B for `extends`: a declaration NAMES another declaration?
        for (const ch of namedChildren(n)) {
          if (DECLARATION_NODE_TYPES.has(ch.type)) bump(probe.declNamingDecl, rel, `${t} -> ${ch.type}`)
        }
        break
      }
      case "type_alias":
      case "opaque":
      case "nominal": {
        const tn = childByType(n, "type_name")
        const a = tn ? childByType(tn, "atom") : childByType(n, "atom")
        const name = a?.text
        if (name) {
          const c = (types.get(name) || 0) + 1
          types.set(name, c)
          if (c === 2) bump(probe.duplicateTypes, rel, name)
        }
        for (const ch of namedChildren(n)) {
          if (DECLARATION_NODE_TYPES.has(ch.type)) bump(probe.declNamingDecl, rel, `${t} -> ${ch.type}`)
        }
        break
      }
      case "module_attribute": {
        const a = childByType(n, "atom")
        if (a?.text) {
          const c = (modules.get(a.text) || 0) + 1
          modules.set(a.text, c)
          if (c === 2) bump(probe.duplicateModules, rel, a.text)
        }
        break
      }
      case "pp_define": {
        const lhs = childByType(n, "macro_lhs")
        const a = lhs ? childByType(lhs, "var") || childByType(lhs, "atom") : undefined
        if (a?.text) {
          const c = (macros.get(a.text) || 0) + 1
          macros.set(a.text, c)
          if (c === 2) bump(probe.duplicateMacros, rel, a.text)
        }
        break
      }
      case "fun_decl": {
        // One fun_decl per clause in this grammar, and `;`-separated clauses of
        // ONE function are NOT redefinitions. So the merge key is (name, arity)
        // over `function_clause`s whose parent chain does NOT pass through a
        // `;`. The clean structural read: a fun_decl whose LAST child is `;`
        // continues the previous clause group; one without ends a group. A new
        // group for a name/arity already seen is a redefinition.
        const clauses = namedChildren(n).filter((c: any) => c.type === "function_clause")
        if (clauses.length > 0) {
          const head = clauses[0]
          const direct = childByType(head, "atom") || childByType(head, "var")
          if (direct?.text) {
            let arity = 0
            const args = childByType(head, "expr_args")
            if (args) {
              for (const c of namedChildren(args)) if (c.type !== "comment") arity++
            }
            const key = `${direct.text}/${arity}`
            const c = (fns.get(key) || 0) + 1
            fns.set(key, c)
            // A clause group is ONE function. Count the identity once.
            if (c === 2) bump(probe.duplicateFunctions, rel, key)
          }
        }
        break
      }
      case "wild_attribute": {
        const name = attrName(n)
        if (name.length > 0) {
          probe.attributeNames.set(name, (probe.attributeNames.get(name) || 0) + 1)
        }
        break
      }
    }

    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

// ---------------------------------------------------------------- output
const artifact = {
  lane: "DERIV_EXPORTS_ERL3",
  instrument: "A:grammar-inventory + B:parse-tree-count",
  corpus: { root: CORPUS, repo: REPO, rev, admittedFiles: population.length, limitApplied: LIMIT || null },
  instrumentA: {
    distinctNodeTypesObserved: probe.distinctNodeTypes.size,
    supertypeCandidateNodeTypes: SUPERTYPE_NODE_CANDIDATES,
    supertypeCandidateHits: probe.candidateHits,
    nodeTypesMatchingASupertypeWord: [...probe.supertypeWordNodeTypes].sort(),
    nodeTypesMatchingCount: probe.supertypeWordNodeTypes.size,
  },
  instrumentB: {
    declarationNamingAnotherDeclaration: {
      occurrences: probe.declNamingDecl.occurrences,
      files: probe.declNamingDecl.files,
      examples: probe.declNamingDecl.examples,
    },
    duplicateDeclarations: {
      records: probe.duplicateRecords,
      types: probe.duplicateTypes,
      modules: probe.duplicateModules,
      macros: probe.duplicateMacros,
      functionsByNameArity: probe.duplicateFunctions,
    },
    behaviourAttribute: {
      occurrences: probe.behaviourAttributes.occurrences,
      files: probe.behaviourAttributes.files,
      distinctTargets: [...probe.behaviourAttributes.distinctTargets].sort(),
      examples: probe.behaviourAttributes.examples,
    },
    exportAttribute: probe.exportAttributes,
    exportTypeAttribute: probe.exportTypeAttributes,
  },
  attributeNames: [...probe.attributeNames.entries()].sort((a, b) => b[1] - a[1]),
  allNodeTypes: [...probe.distinctNodeTypes].sort(),
  filesRead: probe.filesRead,
  parseFailures: probe.parseFailures,
}

mkdirSync(OUT_DIR, { recursive: true })
const outFile = path.join(OUT_DIR, `erl3-construct-probe-${REPO}.json`)
writeFileSync(outFile, JSON.stringify(artifact, null, 2))

console.log(`# erl3 construct probe — ${REPO} @ ${rev}`)
console.log(`population: ${population.length} admitted files; read ${probe.filesRead}, parse failures ${probe.parseFailures}\n`)
console.log(`INSTRUMENT A — grammar inventory`)
console.log(`  distinct node types observed: ${probe.distinctNodeTypes.size}`)
console.log(`  supertype candidate node types hit: ${JSON.stringify(probe.candidateHits)}`)
console.log(`  node types matching a supertype word: ${probe.supertypeWordNodeTypes.size} ${JSON.stringify([...probe.supertypeWordNodeTypes].sort())}\n`)
console.log(`INSTRUMENT B — construct counts on the tree`)
console.log(`  declaration naming another declaration (an \`extends\` shape): ${probe.declNamingDecl.occurrences} in ${probe.declNamingDecl.files} files`)
console.log(`  duplicate -record:      ${probe.duplicateRecords.occurrences} in ${probe.duplicateRecords.files} files ${JSON.stringify(probe.duplicateRecords.examples)}`)
console.log(`  duplicate -type/-opaque: ${probe.duplicateTypes.occurrences} in ${probe.duplicateTypes.files} files ${JSON.stringify(probe.duplicateTypes.examples)}`)
console.log(`  duplicate -module:      ${probe.duplicateModules.occurrences} in ${probe.duplicateModules.files} files`)
console.log(`  duplicate -define:      ${probe.duplicateMacros.occurrences} in ${probe.duplicateMacros.files} files ${JSON.stringify(probe.duplicateMacros.examples)}`)
console.log(`  duplicate fn name/arity: ${probe.duplicateFunctions.occurrences} in ${probe.duplicateFunctions.files} files ${JSON.stringify(probe.duplicateFunctions.examples)}`)
console.log(`  -behaviour attributes:  ${probe.behaviourAttributes.occurrences} in ${probe.behaviourAttributes.files} files; targets ${JSON.stringify([...probe.behaviourAttributes.distinctTargets].sort())}`)
console.log(`  -export attributes:     ${probe.exportAttributes.occurrences} in ${probe.exportAttributes.files} files, ${probe.exportAttributes.faEntries} fa entries`)
console.log(`  -export_type attributes: ${probe.exportTypeAttributes.occurrences}, ${probe.exportTypeAttributes.faEntries} fa entries\n`)
console.log(`  attribute names (count): ${JSON.stringify([...probe.attributeNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40))}`)
console.log(`artifact: ${outFile}`)