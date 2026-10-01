#!/usr/bin/env bun
// M14.0 — the Clean census.
//
// Recomputes, from the pinned grammar and the corpus, every figure quoted in
// `docs/analyzers/real-clean-analyzer.md` and
// `reviews/clean/m14-0-clean-completeness.md`. A number in a document that no
// command reproduces is a number that will be wrong, so this instrument exists
// to keep the prose checkable: run it, and the figures either still hold or the
// document is corrected.
//
// Usage: bun run script/m14/clean-census.ts [--corpus <dir>] [--json <out>]
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const ci = process.argv.indexOf("--corpus")
const REPOS = ci > 0 ? process.argv[ci + 1] : "$HOME/fixtures/repositories"
const ji = process.argv.indexOf("--json")
const JSON_OUT = ji > 0 ? process.argv[ji + 1] : ""

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(icl|dcl)$/.test(e.name)) out.push(p)
  }
  return out
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)
const { RealCleanAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-clean-analyzer.ts"))

// The same accessors `clean-completeness-gate.ts` uses, so the two instruments
// cannot disagree about what the grammar declares.
const namedSlots: string[] = []
for (let i = 0; i < (grammar as any).nodeTypeCount; i++) {
  if (!(grammar as any).nodeTypeIsNamed(i)) continue
  namedSlots.push((grammar as any).nodeTypeForId(i))
}
const distinctNamed = [...new Set(namedSlots)].sort()

const bump = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] || 0) + n
}
const sorted = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]))

const moduleOf = (_f: string, r: any): string | undefined =>
  r.symbols.find((s: any) => s.kind === "module")?.name

// `--manifest <file>` reads an explicit newline-delimited list of absolute paths
// instead of walking a directory. The WIDE corpus needs it twice over: it is
// several separate clones rather than one tree, and it must be de-duplicated BY
// CONTENT — iTasks vendors StdEnv, so a directory walk counts the same standard
// library repeatedly and inflates every figure. The manifest is a committed
// artifact, so a re-run measures the same files.
const mi = process.argv.indexOf("--manifest")
const files = (mi > 0
  ? fs.readFileSync(process.argv[mi + 1], "utf8").split("\n").map((l) => l.trim()).filter(Boolean).sort()
  : walk(REPOS).sort())
let totalNodes = 0
// PARSE HEALTH. The analyzer's ceiling is the grammar's, not its own: a file the
// pinned wasm cannot read is a damaged tree, and every downstream figure inherits
// that. Measured here rather than quoted, because at 312 files this lane read as
// 88.5% clean and at 2,179 it is far worse.
let parseCleanFiles = 0
let errorFiles = 0
let errorNodes = 0
let errorTextSamples: string[] = []
const typeCounts: Record<string, number> = Object.create(null)
const instanceArgField: Record<string, number> = Object.create(null)
const instanceHasDirectCtorChild = { yes: 0, no: 0 }
const filesWithChildlessInstance = new Set<string>()
const macroFiles = new Set<string>()
const localKinds: Record<string, number> = Object.create(null)
const localBindingWraps: Record<string, number> = Object.create(null)
const applicationUnderBinder = { total: 0, inWhere: 0 }
const qualifiedSpelling: Record<string, number> = Object.create(null)
const binderShadow = { selfFrame: 0, moduleLevel: 0, total: 0, bindings: 0 }
const selfOwnedShape: Record<string, number> = Object.create(null)
const binderFilesWithPmDriver = { file: "", ownerless: 0 }
const uppercaseApplied = { sites: 0, resolvedAs: {} as Record<string, number> }
const appHeadTypes: Record<string, number> = Object.create(null)
const appTotal = { total: 0, headIsApplication: 0, leftNestedApplications: 0 }
const classContextShape = { nodes: 0, constraints: 0, nodesNamingAClass: 0 }
const declined: Record<string, number> = Object.create(null)
const errors: Record<string, number> = Object.create(null)

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser.parse(src)
  totalNodes += tree.rootNode.descendantCount
  if (tree.rootNode.hasError) {
    errorFiles++
    let n = 0
    const count = (node: any): void => {
      if (node.type === "ERROR" || node.isMissing) n++
      for (let i = 0; i < node.childCount; i++) count(node.child(i))
    }
    count(tree.rootNode)
    errorNodes += n
    if (errorTextSamples.length < 12) {
      const first = (function find(node: any): any {
        if (node.type === "ERROR" || node.isMissing) return node
        for (let i = 0; i < node.childCount; i++) { const r = find(node.child(i)); if (r) return r }
        return null
      })(tree.rootNode)
      if (first) errorTextSamples.push(src.split("\n")[first.startPosition.row]?.trim().slice(0, 64) ?? "")
    }
  } else {
    parseCleanFiles++
  }

  // ---- grammar census over this file
  const cursor = tree.walk()
  const visit = (): boolean => {
    const n = cursor.currentNode
    if (n.isNamed) bump(typeCounts, n.type)
    if (n.type === "instance_declaration") {
      const args = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (n.fieldNameForChild(i) === "argument") args.push(c)
      }
      for (const a of args) bump(instanceArgField, a.type)
      let direct = false
      for (let i = 0; i < n.namedChildCount; i++) {
        if (n.namedChild(i).type === "constructor") {
          direct = true
          break
        }
      }
      if (direct) {
        instanceHasDirectCtorChild.yes++
      } else {
        instanceHasDirectCtorChild.no++
        filesWithChildlessInstance.add(f)
      }
    }
    if (n.type === "macro_definition") macroFiles.add(f)
    if (n.type === "local_binding") {
      binderShadow.bindings++
      // what each binder WRAPS: a local signature and its definition are one symbol,
      // so the occurrence count and the symbol count differ.
      for (let i = 0; i < n.namedChildCount; i++) bump(localBindingWraps, n.namedChild(i).type)
    }
    if (n.type === "single_quoted_name") bump(qualifiedSpelling, "single_quoted_name")
    if (n.type === "qualified_identifier") bump(qualifiedSpelling, "qualified_identifier")
    if (n.type === "application") {
      appTotal.total++
      const fn = n.childForFieldName("function")
      if (fn) bump(appHeadTypes, fn.type)
      if (fn?.type === "application") {
        appTotal.headIsApplication++
        // the nest: an application whose `function` is itself an application is not
        // a head at all, so counting every application as a call site would double-count
        appTotal.leftNestedApplications++
      }
    }
    if (n.type === "class_context") {
      classContextShape.nodes++
      for (let i = 0; i < n.namedChildCount; i++) {
        classContextShape.constraints++
        // a constraint names a class when it is a class name rather than a type variable
        const c = n.namedChild(i)
        const target = c.type === "type_variable" ? c.namedChild(0) : c
        if (target && /^[A-Z]/.test(target.text)) classContextShape.nodesNamingAClass++
      }
    }
    if (n.type === "index_access") bump(typeCounts, "index_access (counted once above)")
    if (n.type === "where_block" || n.type === "with_block") {
      // every application lexically inside a binder block
      for (let i = 0; i < n.namedChildCount; i++) {
        const binder = n.namedChild(i)
        if (binder.type !== "local_binding") continue
        const count = (function walkApps(node: any): number {
          let c = 0
          if (node.type === "application") c++
          for (let k = 0; k < node.namedChildCount; k++) c += walkApps(node.namedChild(k))
          return c
        })(binder)
        applicationUnderBinder.total += count
        if (n.type === "where_block") applicationUnderBinder.inWhere += count
      }
    }
    if (cursor.gotoFirstChild()) {
      do {
        if (!visit()) return false
      } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
    return true
  }
  visit()

  // ---- the analyzer, for the questions only the analyzer can answer
  const r: any = new RealCleanAnalyzer().analyze(tree.rootNode, src, f)
  for (const e of r.errors) bump(errors, String(e.message ?? e).slice(0, 80))

  // local binders: what kind is each, and what does it shadow?
  const symsByName = new Map<string, any[]>()
  for (const s of r.symbols) {
    const a = symsByName.get(s.name) ?? []
    a.push(s)
    symsByName.set(s.name, a)
  }
  const moduleLevel = new Set(r.symbols.filter((s: any) => !s.ownerName || s.ownerKind === "Module").map((s: any) => s.name))
  for (const s of r.symbols) {
    if (s.ownerName === s.name) {
      // Four distinct Clean naming conventions land here, and all four are correct:
      //   newtype        `:: ErrPrefs = ErrPrefs` — a data constructor named as its type
      //   one-method cls `class addTabViewItem a where addTabViewItem :: ...`
      //   module-named   a `.dcl` for module `Target` that declares type `Target`
      //   local shadow   a where/with/let binder sharing its own frame's name
      // The store keys a row `${fileId}:${name}:${lineStart}` and resolution also
      // matches `qualifiedName`, so no two of them collide.
      const shape =
        s.visibility === "local" ? "local binder shadowing its frame"
        : s.ownerKind === "type" ? "newtype: a constructor named as its type"
        : s.ownerKind === "interface" ? "one-method class: the method shares the class name"
        : s.ownerKind === "module" || s.ownerKind === "Module" || s.ownerName === moduleOf(f, r) ? "the MODULE is named as the symbol"
        : `other (ownerKind=${String(s.ownerKind)})`
      bump(selfOwnedShape, shape)
    }
    if (s.visibility !== "local") continue
    bump(localKinds, String(s.kind))
    binderShadow.total++
    const ownerSyms = symsByName.get(s.ownerName ?? "") ?? []
    if (ownerSyms.some((o: any) => o.name === s.name)) {
      binderShadow.selfFrame++
      if (f.includes("PmDriver.icl")) binderFilesWithPmDriver.file = path.basename(f)
    }
    if (moduleLevel.has(s.name)) binderShadow.moduleLevel++
  }

  // An uppercase applied name that is NOT a declared data constructor: the population
  // the `instantiates` decision is about. Counted on the AST — every application whose
  // innermost `function` field is a `constructor`-typed node — because the DECLINED sites
  // emit no edge, so counting emitted relationships cannot see them. A macro wins the
  // classification over a constructor because a macro and a data constructor share the
  // node type and a macro body is a call, never a construction.
  const declared = {
    constructor: new Set(r.symbols.filter((s: any) => s.kind === "constructor").map((s: any) => s.name)),
    function: new Set(r.symbols.filter((s: any) => s.kind === "function" || s.kind === "method").map((s: any) => s.name)),
    macro: new Set(r.symbols.filter((s: any) => s.kind === "macro").map((s: any) => s.name)),
    type: new Set(r.symbols.filter((s: any) => s.kind === "type").map((s: any) => s.name)),
    class: new Set(r.symbols.filter((s: any) => s.kind === "interface" || s.kind === "class").map((s: any) => s.name)),
  }
  const order: Array<keyof typeof declared> = ["macro", "constructor", "class", "type", "function"]
  const classify = (t: string): void => {
    if (!/^[A-Z]/.test(t)) return
    if (declared.constructor.has(t)) return
    uppercaseApplied.sites++
    let hit: string | null = null
    for (const k of order) if (declared[k].has(t)) { hit = k; break }
    bump(uppercaseApplied.resolvedAs, hit ?? "nothing in the corpus")
  }
  const walkApps = (node: any): void => {
    if (node.type === "application") {
      const fn = node.childForFieldName("function")
      if (fn?.type === "constructor") classify(fn.text)
    }
    for (let k = 0; k < node.namedChildCount; k++) walkApps(node.namedChild(k))
  }
  walkApps(tree.rootNode)
  const md = r.metadata ?? {}
  if (typeof md.declinedInstantiations === "number") bump(declined, "declinedInstantiations", md.declinedInstantiations)
  if (md.declinedInstantiations && typeof md.declinedInstantiations === "object") {
    bump(declined, "declinedInstantiations (object form)", md.declinedInstantiations.count ?? 0)
  }
}

// index_access was double-counted in typeCounts by the census walk; subtract it
typeCounts["index_access (counted once above)"] = 0
delete typeCounts["index_access (counted once above)"]

const namedInCorpus = distinctNamed.filter((t) => (typeCounts[t] ?? 0) > 0)
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/clean-completeness.json"), "utf8"))
// Mirrors `clean-completeness-gate.ts` exactly, including the comma/whitespace split of
// a ruling's `node_type` and the `_`-prefixed ALIASED slot exclusion (CL-D12). Two
// instruments that count the grammar differently is how a gate goes green on 135 of 137.
const splitTypes = (rows: any[]): string[] =>
  rows.flatMap((r) => String(r.node_type ?? r).split(/[,\s]+/).filter(Boolean))
const handled: string[] = spec.handled_verified.types
const silent: string[] = spec.internal_silent.types
const gaps: string[] = splitTypes(spec.gap.gaps)
const decided: string[] = splitTypes(spec.design_decision.decisions)
// `rulings_without_a_bucket` is a dict whose `items` are the rulings; each names a
// `node_type` that is ALREADY in handled_verified or internal_silent, which is why F8
// does not count them again.
const rulingsWithoutBucket: string[] = splitTypes(spec.design_decision.rulings_without_a_bucket.items ?? [])
const closed: string[] = splitTypes(spec.closed_gaps.items)
const bucketed = new Set([...handled, ...silent, ...gaps, ...decided])
const classifiedTotal = bucketed.size
const unclassified = distinctNamed.filter((t) => !bucketed.has(t))

const report = {
  universe: {
    files: files.length,
    totalNodes,
    distinctNamedInGrammar: distinctNamed.length,
    namedSlotCount: namedSlots.length,
    namedTypesOccurringInCorpus: namedInCorpus.length,
    namedTypesNeverOccurring: distinctNamed.filter((t) => (typeCounts[t] ?? 0) === 0),
    indexAccessSites: typeCounts["index_access"] ?? 0,
    parseCleanFiles,
    errorFiles,
    errorNodes,
    errorTextSamples,
  },
  analyzer: {
    specBuckets: { handled: handled.length, internalSilent: silent.length, gap: gaps.length, designDecision: decided.length, closedGaps: closed.length, rulingsWithoutABucket: rulingsWithoutBucket.length },
    distinctNamed: distinctNamed.length,
    classifiedTotal,
    unclassifiedNamedTypes: unclassified,
    handledPresentInCorpus: handled.filter((t) => (typeCounts[t] ?? 0) > 0).length,
    handledOnlyInFixtures: handled.filter((t) => (typeCounts[t] ?? 0) === 0),
    macroDefinitionSites: typeCounts["macro_definition"] ?? 0,
    filesDefiningMacros: macroFiles.size,
    classContexts: typeCounts["class_context"] ?? 0,
    genericDeclarations: typeCounts["generic_declaration"] ?? 0,
    genericCaseDefinitions: typeCounts["generic_case_definition"] ?? 0,
    deriveDeclarations: typeCounts["derive_declaration"] ?? 0,
    foreignExports: typeCounts["foreign_export"] ?? 0,
    fixityDeclarations: typeCounts["fixity_declaration"] ?? 0,
    fixityAnnotations: typeCounts["fixity_annotation"] ?? 0,
    typeSignatures: typeCounts["type_signature"] ?? 0,
    instanceMembers: typeCounts["instance_member"] ?? 0,
    specialBlocks: typeCounts["special_block"] ?? 0,
    specialMembers: typeCounts["special_member"] ?? 0,
    recordFields: typeCounts["record_field"] ?? 0,
    recordExpressions: typeCounts["record_expression"] ?? 0,
    recordUpdates: typeCounts["record_update"] ?? 0,
    fieldAccesses: typeCounts["field_access"] ?? 0,
    constructorPatterns: typeCounts["constructor_pattern"] ?? 0,
    applications: appTotal.total,
    applicationHeadTypes: sorted(appHeadTypes),
    applicationsWhoseHeadIsTheNest: appTotal.headIsApplication,
    classContext: classContextShape,
  },
  instanceTarget: {
    total: instanceHasDirectCtorChild.yes + instanceHasDirectCtorChild.no,
    withDirectConstructorChild: instanceHasDirectCtorChild.yes,
    without: instanceHasDirectCtorChild.no,
    filesWithout: filesWithChildlessInstance.size,
    argumentFieldByType: sorted(instanceArgField),
  },
  locals: {
    bindingOccurrences: binderShadow.bindings,
    publishedLocalSymbols: binderShadow.total,
    selfOwnedTotal: Object.values(selfOwnedShape).reduce((a, b) => a + b, 0),
    selfOwnedByShape: sorted(selfOwnedShape),
    byKind: sorted(localKinds),
    shadowingOwnFrame: binderShadow.selfFrame,
    shadowingModuleLevel: binderShadow.moduleLevel,
    applicationsUnderBinders: applicationUnderBinder.total,
    applicationsUnderWhereBinders: applicationUnderBinder.inWhere,
    localBindingWraps: sorted(localBindingWraps),
  },
  qualifiedNames: sorted(qualifiedSpelling),
  uppercaseApplied: {
    sites: uppercaseApplied.sites,
    byDeclaredKind: sorted(uppercaseApplied.resolvedAs),
  },
  declinedInstantiations: sorted(declined),
  topNodeTypes: sorted(typeCounts),
  errors: sorted(errors),
}

const lines: string[] = []
const p = (s: string) => lines.push(s)
p(`clean census — ${report.universe.files} files, ${report.universe.totalNodes} nodes`)
p("")
p("grammar:")
p(`  distinct named types declared        ${report.universe.distinctNamedInGrammar}`)
p(`  named slots (duplicates collapsed)  ${report.universe.namedSlotCount}`)
p(`  named types occurring in the corpus ${report.universe.namedTypesOccurringInCorpus}`)
p(`  never occurring                     ${report.universe.namedTypesNeverOccurring.join(", ") || "(none)"}`)
p(`  index_access sites                  ${report.universe.indexAccessSites}`)
p(`  PARSE HEALTH  files with NO error  ${report.universe.parseCleanFiles} (${((100 * report.universe.parseCleanFiles) / report.universe.files).toFixed(1)}%)`)
p(`                  files with >=1 ERROR ${report.universe.errorFiles} (${((100 * report.universe.errorFiles) / report.universe.files).toFixed(1)}%), ${report.universe.errorNodes} ERROR nodes`)
p(`  first-error lines seen (sample):`)
for (const t of report.universe.errorTextSamples) p(`    ${t}`)
p("")
p("analyzer reach:")
p(`  spec buckets                        handled ${report.analyzer.specBuckets.handled}, internal_silent ${report.analyzer.specBuckets.internalSilent}, gap ${report.analyzer.specBuckets.gap}, design_decision ${report.analyzer.specBuckets.designDecision} (+${report.analyzer.specBuckets.rulingsWithoutABucket} rulings without a bucket), closed_gaps ${report.analyzer.specBuckets.closedGaps}`)
p(`  distinct named / classified         ${report.analyzer.distinctNamed} / ${report.analyzer.classifiedTotal}`)
p(`  unclassified named types            ${report.analyzer.unclassifiedNamedTypes.join(", ") || "(none)"}`)
p(`  handled present in the corpus       ${report.analyzer.handledPresentInCorpus} of ${report.analyzer.specBuckets.handled}`)
p(`  handled ONLY in fixtures            ${report.analyzer.handledOnlyInFixtures.join(", ") || "(none)"}`)
for (const [k, v] of Object.entries(report.analyzer)) {
  if (["specBuckets", "distinctNamed", "classifiedTotal", "unclassifiedNamedTypes", "handledPresentInCorpus", "handledOnlyInFixtures"].includes(k)) continue
  p(`  ${k.padEnd(37)} ${v}`)
}
p("")
p("instance target:")
p(`  instances                            ${report.instanceTarget.total}`)
p(`  with a direct constructor child      ${report.instanceTarget.withDirectConstructorChild}`)
p(`  WITHOUT (the defect)                 ${report.instanceTarget.without}`)
p(`  files affected                       ${report.instanceTarget.filesWithout}`)
p(`  argument field by type               ${JSON.stringify(report.instanceTarget.argumentFieldByType)}`)
p("")
p("locals:")
p(`  local_binding occurrences            ${report.locals.bindingOccurrences}`)
p(`  published local SYMBOLS              ${report.locals.publishedLocalSymbols}`)
p(`  self-owned (ownerName === name)      ${report.locals.selfOwnedTotal}`)
for (const [k, v] of Object.entries(report.locals.selfOwnedByShape)) p(`    ${k.padEnd(51)} ${v}`)
p(`  by kind                              ${JSON.stringify(report.locals.byKind)}`)
p(`  shadowing their own frame            ${report.locals.shadowingOwnFrame}`)
p(`  shadowing a module-level symbol      ${report.locals.shadowingModuleLevel}`)
p(`  applications under binders           ${report.locals.applicationsUnderBinders}`)
p(`  applications under where binders     ${report.locals.applicationsUnderWhereBinders}`)
p(`  what a local_binding wraps           ${JSON.stringify(report.locals.localBindingWraps)}`)
p("")
p("qualified name spellings:")
for (const [k, v] of Object.entries(report.qualifiedNames)) p(`  ${k.padEnd(37)} ${v}`)
p("")
p("uppercase applied names (the 19.3% row):")
p(`  sites                                ${report.uppercaseApplied.sites}`)
for (const [k, v] of Object.entries(report.uppercaseApplied.byDeclaredKind)) {
  const pct = ((v / report.uppercaseApplied.sites) * 100).toFixed(2)
  p(`    ${k.padEnd(35)} ${String(v).padStart(5)}  ${pct}%`)
}
p("")
p("declined instantiations:")
for (const [k, v] of Object.entries(report.declinedInstantiations)) p(`  ${k.padEnd(37)} ${v}`)
p("")
p(`errors: ${JSON.stringify(report.errors)}`)
p("")
p("top 40 node types:")
const top = Object.entries(report.topNodeTypes).slice(0, 40)
for (const [k, v] of top) p(`  ${k.padEnd(37)} ${v}`)

const out = lines.join("\n")
console.log(out)
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")
