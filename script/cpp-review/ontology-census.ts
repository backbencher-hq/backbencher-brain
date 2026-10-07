#!/usr/bin/env bun
// DERIV_EXPORTS_CPP3 — the relationship-ontology census for the C++ lane.
//
// INSTRUMENT A (grammar-inventory) and INSTRUMENT B (parse-tree semantic
// count), per ONTOLOGY-WORKSTREAM.md Part 2 §"The two instruments":
//
//   A: enumerate every node type the grammar actually produces across the
//      population. A type the language cannot express is ruled by the ABSENCE
//      of a node that expresses it — positive evidence, not prose.
//   B: count on the tree. A construct that IS expressible (a second
//      declaration of a name, a base-class clause, an attribute) must be
//      counted where a string literal or a comment cannot fake it.
//
// NO REGEX (the programme's hard rule 1). Every predicate below is
// `string.includes`, `startsWith`, `charCodeAt` or a tree-sitter node-type
// comparison. There is not one RegExp literal and not one `RegExp`
// constructor in this file.
//
// POPULATION (the honesty contract §"an instrument must declare the
// population it covered"): derived by `readdir` walk over the corpus repos
// named in CPP_REPOS, filtered by the lane's own extension universe, and
// PRINTED before any count. There is no hand-written FILES array.
//
// USES THE PRODUCTION PATH: getParser -> parser.parse -> RealCppAnalyzer.
// Not `analyze()` in isolation, not the fixture harness.
//
//   BB_CORPUS_ROOT  corpus root (default $HOME/fixtures/repositories)
//   CPP_REPOS       comma-separated repo dirs (default cpp-example,cpp-sample,kotlin,objc,okio)
//   CPP_LIMIT       cap the file count (default 0 = no cap)
//   CPP_SECTION     run only sections whose name contains this (default all)

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.BB_ROOT || "/tmp/opencode/wt/DERIV_EXPORTS_CPP3"
const CORPUS = process.env.BB_CORPUS_ROOT || "$HOME/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS || "cpp-example,cpp-sample,kotlin,objc,okio").split(",").filter(Boolean)
const LIMIT = Number(process.env.CPP_LIMIT || 0)
const SECTION = process.env.CPP_SECTION || ""

// The lane's own extension universe (docs/analyzers/real-cpp-analyzer.md
// "Language detection" + parallel-indexer's accepted set).
const EXTS = [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".hh", ".h++", ".h"]

// ---------------------------------------------------------------------------
// POPULATION — derived, and printed before any count is read off it.
// ---------------------------------------------------------------------------
type FileRec = { repo: string; path: string; rel: string; bytes: number }
const population: FileRec[] = []
const perRepo: Array<{ repo: string; walked: number; kept: number }> = []

function walk(dir: string, repo: string, depth: number, acc: string[]): void {
  if (depth > 24) return
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "out") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      walk(p, repo, depth + 1, acc)
      continue
    }
    acc.push(p)
  }
}

for (const repo of REPOS) {
  const dir = join(CORPUS, repo)
  const acc: string[] = []
  walk(dir, repo, 0, acc)
  let kept = 0
  for (const p of acc) {
    let ok = false
    for (const x of EXTS) if (p.endsWith(x)) { ok = true; break }
    if (!ok) continue
    let bytes = 0
    try {
      bytes = statSync(p).size
    } catch {
      continue
    }
    // A 4 MB generated amalgamation would dominate the counts and the parser.
    if (bytes > 2_000_000) continue
    population.push({ repo, path: p, rel: p.slice(dir.length + 1), bytes })
    kept++
  }
  perRepo.push({ repo, walked: acc.length, kept })
}
if (LIMIT > 0 && population.length > LIMIT) population.length = LIMIT

console.log("=".repeat(78))
console.log("DERIV_EXPORTS_CPP3 — relationship-ontology census")
console.log("=".repeat(78))
console.log(`corpus root : ${CORPUS}`)
console.log(`repos       : ${REPOS.join(", ")}`)
console.log(`extensions  : ${EXTS.join(" ")}`)
console.log(`POPULATION  : ${population.length} files (derived by readdir walk; no hand-written list)`)
for (const r of perRepo) console.log(`   ${r.repo.padEnd(14)} walked ${String(r.walked).padStart(6)} files -> ${String(r.kept).padStart(5)} C++ files counted`)
console.log(`total bytes : ${population.reduce((a, f) => a + f.bytes, 0).toLocaleString("en-US")}`)
console.log()

const { getParser, ASTEngine } = await import(`${ROOT}/src/ast/engine.ts`)
const { RealCppAnalyzer } = await import(`${ROOT}/src/ast/real-cpp-analyzer.ts`)

const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]
const ALL_TEN = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

type Rel = { source?: string; target?: string; type?: string; confidence?: number; line_number?: number; metadata?: Record<string, any> }

// ---------------------------------------------------------------------------
// Accumulators
// ---------------------------------------------------------------------------
const relCount = new Map<string, number>()
const relFiles = new Map<string, Set<string>>()
const relSample = new Map<string, string[]>()
let importRows = 0
let importFiles = 0
let importModuleMissing = 0
let exportRows = 0
let exportFiles = 0
let exportDupNames = 0
const importByModule = new Map<string, number>()
// hygiene
const emptyEndpoint = new Map<string, number>()
const placeholderEndpoint = new Map<string, number>()
const unknownKindSymbols = 0 as number
const noConfidence = new Map<string, number>()
const underSeven = new Map<string, number>()
const evidenceClass = new Map<string, Map<string, number>>()
// resolution
const resolvedBoth = new Map<string, number>()
const resolvedSrc = new Map<string, number>()
const resolvedTgt = new Map<string, number>()
const unresolvedTargetSamples = new Map<string, string[]>()

// grammar inventory — EVERY node type the wired grammar produces
const nodeInventory = new Map<string, number>()
let filesWithError = 0
let errorNodes = 0

// IMPLEMENTS instrument: children under every base_class_clause
const baseClauseChildTypes = new Map<string, number>()
let baseClauses = 0
let basesTotal = 0
// a base that IS declared in this file and whose declared member functions are
// ALL pure virtual = the semantic "interface" candidate
let interfaceCandidateBases = 0
let classesWithBases = 0
let classesWithMixedBases = 0 // a class with BOTH a pure-virtual-only base AND a non-abstract base

// EXPORTS instrument: node types that could express an export
const exportNodeTypes = new Map<string, number>()
const exportNodeSamples = new Map<string, string[]>()
// IMPORTS instrument
let preprocInclude = 0
let preprocImport = 0
let importDeclarationNodes = 0
let includeResolvable = 0
let includeUnresolvable = 0
let includeSystem = 0
let includeLocal = 0
const includeSampleModules = new Set<string>()
// the C++20 `import` / `export module` spellings: does the wired grammar make
// a node of them at all?
let filesWithTopLevelImportWord = 0
let filesWithExportModuleWord = 0

const analyzer = new RealCppAnalyzer()
// getParser is hoisted: it is a loader, not a per-file operation, and calling
// it inside the loop re-reads the wasm once per file (measured: 2 loads logged
// in the first 30 s of a 1,729-file run).
const parser = await getParser("cpp")
let symbolTotal = 0
let errTotal = 0
let parsed = 0

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) || 0) + 1)
}

function noteSample(m: Map<string, string[]>, k: string, v: string) {
  const a = m.get(k)
  if (!a) { m.set(k, [v]); return }
  if (a.length < 4) a.push(v)
}

// --- AST helpers. Cursor-free; named children and node.type only. ------------
function forEachNode(root: any, fn: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    fn(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

function topLevelWord(node: any, word: string): boolean {
  // Is `word` one of the node's own (unnamed) tokens at the head of this
  // statement? Reads the node's own children, not the source text.
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    if (c.type === word) return true
  }
  return false
}

const parseStart = Date.now()
for (const f of population) {
  let content: string
  try {
    content = readFileSync(f.path, "utf8")
  } catch {
    continue
  }
  const parserForFile = parser
  const pr = await parserForFile.parse(content, f.path)
  const root = pr.rootNode
  const res: any = analyzer.analyze(root as any, content, f.path)
  parsed++

  // ---- grammar inventory (instrument A) ------------------------------------
  let sawErr = false
  forEachNode(root, (n) => {
    bump(nodeInventory, n.type)
    if (n.type === "ERROR") { errorNodes++; sawErr = true }
    else if (n.isMissing) { errorNodes++; sawErr = true }
    // export-capable node types
    if (
      n.type === "attribute_specifier" || n.type === "attribute_declaration" ||
      n.type === "ms_declspec_modifier" || n.type === "attribute_list" ||
      n.type === "concept_definition" || n.type === "requires_clause" ||
      n.type === "export_declaration" || n.type === "module_declaration" ||
      n.type === "module_import_declaration" || n.type === "import_declaration" ||
      n.type === "global_module_fragment" || n.type === "module_partition" ||
      n.type === "visibility_specifier" || n.type === "linkage_specification"
    ) {
      bump(exportNodeTypes, n.type)
      noteSample(exportNodeSamples, n.type, `${f.rel}:${n.startPosition.row + 1}`)
    }
    if (n.type === "preproc_include") preprocInclude++
    if (n.type === "preproc_import") preprocImport++
    if (n.type === "import_declaration" || n.type === "module_import_declaration" ||
        n.type === "export_declaration" || n.type === "module_declaration") importDeclarationNodes++
    if (n.type === "base_class_clause") {
      baseClauses++
      basesTotal += n.namedChildCount
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) bump(baseClauseChildTypes, c.type)
      }
    }
  })
  if (sawErr) filesWithError++

  // top-level `import ...;` / `export module ...;` spellings, from the TREE
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (!c) continue
    if (topLevelWord(c, "import")) filesWithTopLevelImportWord++
    if (topLevelWord(c, "export")) filesWithExportModuleWord++
  }

  // ---- semantic counts (instrument B) -------------------------------------
  // `#include` path resolvability, read from the path node
  forEachNode(root, (n) => {
    if (n.type !== "preproc_include") return
    const p = n.childForFieldName("path")
    if (p && (p.type === "string_literal" || p.type === "system_lib_string")) {
      includeResolvable++
      if (p.text.startsWith("<")) includeSystem++
      else includeLocal++
    } else {
      includeUnresolvable++
    }
    if (includeSampleModules.size < 8) {
      const t = (p?.text ?? "").split("<").join("").split(">").join("").split('"').join("").trim()
      if (t) includeSampleModules.add(t)
    }
  })

  // "is this base an interface?" — a base DECLARED IN THIS FILE whose declared
  // member functions are all pure virtual.
  {
    // collect pure-virtual counts per declared class, and each class's bases
    const declBases = new Map<string, string[]>()
    const pureVirtual = new Map<string, number>()
    const anyVirtual = new Map<string, number>()
    forEachNode(root, (n) => {
      if (n.type === "class_specifier" || n.type === "struct_specifier") {
        const nm = n.childForFieldName("name")
        if (!nm || nm.type !== "type_identifier") return
        const bc = n.namedChildren.find((c: any) => c.type === "base_class_clause")
        if (bc) {
          const bs: string[] = []
          for (let i = 0; i < bc.namedChildCount; i++) {
            const c = bc.namedChild(i)
            if (!c || c.type === "access_specifier") continue
            const tn = c.namedChildren.find((x: any) => x.type === "type_identifier") ?? c
            bs.push(tn.type === "type_identifier" ? tn.text : "")
          }
          if (bs.length > 0) { declBases.set(nm.text, bs); classesWithBases++ }
        }
      }
      if (n.type === "field_declaration" || n.type === "declaration" || n.type === "function_definition") {
        let p = n.parent
        while (p && p.type !== "class_specifier" && p.type !== "struct_specifier") p = p.parent
        if (!p) return
        const cn = p.childForFieldName("name")
        if (!cn || cn.type !== "type_identifier") return
        // pure virtual = a function_declarator with `= 0`
        const txt = n.text
        if (txt.indexOf("virtual") !== -1 || topLevelWord(n, "virtual_specifier")) {
          anyVirtual.set(cn.text, (anyVirtual.get(cn.text) || 0) + 1)
        }
        if (txt.indexOf("= 0") !== -1) pureVirtual.set(cn.text, (pureVirtual.get(cn.text) || 0) + 1)
      }
    })
    for (const [, bases] of declBases) {
      let iface = 0
      let concrete = 0
      for (const b of bases) {
        if (!b) continue
        const pv = pureVirtual.get(b) || 0
        const av = anyVirtual.get(b) || 0
        if (av > 0 && pv >= av) iface++
        else concrete++
      }
      if (iface > 0) interfaceCandidateBases += iface
      if (iface > 0 && concrete > 0) classesWithMixedBases++
    }
  }

  // ---- production output --------------------------------------------------
  const fileLabel = `${f.repo}/${f.rel}`
  const rels: Rel[] = res.relationships || []
  const symNames = new Set<string>()
  const symDotted = new Set<string>()
  for (const s of res.symbols || []) {
    if (!s || !s.name) continue
    symNames.add(s.name)
    if (s.ownerName) {
      symDotted.add(`${s.ownerName}.${s.name}`)
      symNames.add(`${s.ownerName}.${s.name}`)
    }
    if ((s as any).kind === undefined || (s as any).kind === null || (s as any).kind === "" || (s as any).kind === "unknown") {
      bump(nodeInventory, "__UNKNOWN_SYMBOL_KIND__")
    }
  }
  symbolTotal += (res.symbols || []).length
  errTotal += (res.errors || []).length

  for (const r of rels) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (!t) continue
    bump(relCount, t)
    const fs = relFiles.get(t)
    if (fs) fs.add(fileLabel); else relFiles.set(t, new Set([fileLabel]))
    noteSample(relSample, t, `${fileLabel}:${r.line_number ?? "?"} ${r.source} -> ${r.target}`)
    // hygiene
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    if (src.length === 0 || tgt.length === 0) bump(emptyEndpoint, t)
    if (src === "unknown" || tgt === "unknown") bump(placeholderEndpoint, t)
    if (typeof r.confidence !== "number") bump(noConfidence, t)
    else if (r.confidence < 0.7) bump(underSeven, t)
    let em = evidenceClass.get(t)
    if (!em) { em = new Map(); evidenceClass.set(t, em) }
    bump(em, String((r.metadata || {}).evidenceClass ?? "(absent)"))
    // resolution: `global` is the file-scope sentinel the lane declares
    const sOk = src === "global" || symNames.has(src) || symDotted.has(src)
    const tOk = tgt === "global" || symNames.has(tgt) || symDotted.has(tgt)
    if (sOk) bump(resolvedSrc, t)
    if (tOk) bump(resolvedTgt, t)
    if (sOk && tOk) bump(resolvedBoth, t)
    else if (!tOk) noteSample(unresolvedTargetSamples, t, `${fileLabel}: ${tgt}`)
  }

  const imps = res.imports || []
  if (imps.length) { importFiles++; importRows += imps.length }
  for (const im of imps) {
    if (!im || !im.module) { importModuleMissing++; continue }
    bump(importByModule, im.module)
  }
  const exps = res.exports || []
  if (exps.length) { exportFiles++; exportRows += exps.length }
  const seenNames = new Set<string>()
  for (const ex of exps) {
    if (!ex || !ex.name) { exportDupNames++; continue }
    if (seenNames.has(ex.name)) exportDupNames++
    seenNames.add(ex.name)
  }
}
const elapsed = Date.now() - parseStart

// ---------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------
const want = (name: string) => SECTION === "" || name.includes(SECTION)

console.log(`parsed ${parsed}/${population.length} files in ${(elapsed / 1000).toFixed(1)}s`)
console.log(`symbols published : ${symbolTotal.toLocaleString("en-US")}`)
console.log(`errors published  : ${errTotal.toLocaleString("en-US")}`)
console.log(`files with ERROR/MISSING nodes: ${filesWithError}   (total ERROR/MISSING nodes: ${errorNodes})`)
console.log()

if (want("A-types")) {
  console.log("--- SECTION A: per-type verdict tally (production path) ---")
  console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
  console.log()
  console.log("type".padEnd(14) + "fires?".padEnd(8) + "count".padStart(9) + "  files".padStart(6) + "   confidence / evidenceClass")
  for (const t of ALL_TEN) {
    const n = relCount.get(t) || 0
    const files = relFiles.get(t)?.size || 0
    const ec = evidenceClass.get(t)
    const ecTxt = ec ? [...ec.entries()].map(([k, v]) => `${k}:${v}`).join(" ") : "-"
    console.log(
      t.padEnd(14) + (n > 0 ? "YES" : "NO ").padEnd(8) +
      n.toLocaleString("en-US").padStart(9) + String(files).padStart(6) + "   " + ecTxt,
    )
  }
  console.log()
  console.log(`OFF-VOCABULARY relationship types published (not one of the 10): ${[...relCount.keys()].filter((k) => !ALL_TEN.includes(k)).join(" ") || "(none)"}`)
  console.log()
}

if (want("B-channels")) {
  console.log("--- SECTION B: the two non-relationship channels ---")
  console.log(`imports[]  rows: ${importRows.toLocaleString("en-US")} in ${importFiles} files; rows with NO module field (the persister DROPS these): ${importModuleMissing}`)
  console.log(`exports[]  rows: ${exportRows.toLocaleString("en-US")} in ${exportFiles} files; empty-or-duplicate names (M49 F3): ${exportDupNames}`)
  console.log(`#include nodes: ${preprocInclude}  (resolvable path ${includeResolvable} / unresolvable ${includeUnresolvable}; system ${includeSystem} / quoted ${includeLocal})`)
  console.log(`preproc_import nodes: ${preprocImport} · import/module declaration nodes: ${importDeclarationNodes}`)
  console.log(`files whose top level carries an 'import' token: ${filesWithTopLevelImportWord}`)
  console.log(`files whose top level carries an 'export' token: ${filesWithExportModuleWord}`)
  console.log(`distinct import modules (top 12): ${[...importByModule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log()
}

if (want("C-hygiene")) {
  console.log("--- SECTION C: hygiene (six questions 4-6, and standing rule R7) ---")
  console.log("type".padEnd(14) + "empty-ep".padStart(9) + "'unknown'".padStart(11) + "no-conf".padStart(9) + "conf<0.7".padStart(10) + "  2-endpoint resolution")
  for (const t of ALL_TEN) {
    const n = relCount.get(t) || 0
    if (n === 0) continue
    const both = resolvedBoth.get(t) || 0
    console.log(
      t.padEnd(14) +
      String(emptyEndpoint.get(t) || 0).padStart(9) +
      String(placeholderEndpoint.get(t) || 0).padStart(11) +
      String(noConfidence.get(t) || 0).padStart(9) +
      String(underSeven.get(t) || 0).padStart(10) +
      `   ${both}/${n} = ${((100 * both) / n).toFixed(1)}%  (src ${resolvedSrc.get(t) || 0}, tgt ${resolvedTgt.get(t) || 0})`,
    )
  }
  const unknownKind = nodeInventory.get("__UNKNOWN_SYMBOL_KIND__") || 0
  console.log()
  console.log(`symbols with empty/unknown SymbolKind: ${unknownKind}`)
  console.log(`edges with a 'unknown' endpoint (rule R7): ${[...placeholderEndpoint.values()].reduce((a, b) => a + b, 0)}`)
  console.log()
  console.log("unresolved-target samples per type (up to 4 each):")
  for (const [t, v] of unresolvedTargetSamples) console.log(`   ${t}: ${v.join(" | ")}`)
  console.log()
}

if (want("D-implements")) {
  console.log("--- SECTION D: IMPLEMENTS — instrument A, the grammar inventory under every base_class_clause ---")
  console.log(`base_class_clause nodes: ${baseClauses}; bases across them: ${basesTotal}`)
  console.log("every node type the grammar produces as a child of a base_class_clause:")
  for (const [k, v] of [...baseClauseChildTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(28)} ${String(v).padStart(6)}`)
  }
  console.log(`classes with a base_class_clause AND a plain type_identifier name: ${classesWithBases}`)
  console.log(`bases that are semantically "interface-like" (declared in-file, ALL declared virtuals pure): ${interfaceCandidateBases}`)
  console.log(`classes mixing an interface-like base with a concrete base: ${classesWithMixedBases}`)
  console.log()
}

if (want("E-exports")) {
  console.log("--- SECTION E: EXPORTS — every node type in the grammar that could carry an export ---")
  if (exportNodeTypes.size === 0) console.log("   (none of the candidate node types occur in this population)")
  for (const [k, v] of [...exportNodeTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(30)} ${String(v).padStart(7)}   e.g. ${exportNodeSamples.get(k)?.join(" ")}`)
  }
  console.log()
  console.log("full node-type inventory produced by the wired grammar (count descending):")
  const inv = [...nodeInventory.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, v] of inv) console.log(`   ${k.padEnd(42)} ${String(v).padStart(9)}`)
  console.log(`distinct node types produced: ${inv.length}`)
  console.log()
}

console.log("DONE")