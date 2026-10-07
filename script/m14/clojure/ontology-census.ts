// VERIFY_CLOJURE · INSTRUMENT 1 — the ontology census.
//
// WHAT THIS MEASURES, and why source-derivation cannot answer it. Counting which
// `RelationshipType.X` symbols appear in an analyzer's source answers ONE
// question: is the type CONSTRUCTIBLE. It does not answer whether the branch that
// builds it ever MATCHES, whether the endpoints bind to real symbols, whether the
// confidence is right, or whether the label is the right one. This instrument runs
// the analyzer through the PRODUCTION path (`getParser` -> `parse` -> `analyze`)
// over the WHOLE corpus and, per type:
//
//   · count, and the FILES the edges came from (a count with no file list is not
//     reproducible by anyone else);
//   · LINE coverage (the store contract's `line_number`);
//   · CONFIDENCE distribution, and how many of those edges carry an
//     `evidenceClass` reason code at all;
//   · ENDPOINT RESOLUTION for source and target, classified from the symbol tables
//     this same run produced — never from a name list typed by hand;
//   · R7 checks: empty symbol names, undeclared SymbolKinds, placeholder-literal
//     endpoints (`unknown`, `undefined`, `?`, `<anonymous>`), string-literal targets.
//
// It ALSO counts, over the raw tree, the candidate sites for the types the analyzer
// does not emit. That is the instrument a RULED verdict needs (a construct that
// occurs 0 times in the corpus is the only thing that settles it) and a GAP verdict
// needs (a construct that occurs N times).
//
// Two passes, in that order, on purpose: pass 1 collects every symbol identity and
// every namespace name the corpus mentions, pass 2 classifies each edge's endpoints
// against the WHOLE corpus. Classifying while parsing scored a call to
// `clojure.string/trim` as dangling simply because that file's own `references`
// edge had not been read yet — a measurement artefact, not a finding.
//
// AST ONLY. NO REGEX anywhere in this file: file selection uses `endsWith`, name
// predicates use charCodeAt / indexOf / split, and every structural question is asked
// of a node. Read-only: it writes one JSON file under /tmp and edits nothing.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

function argOf(f: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(f)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}

const CLOJURE_EXTS = [".clj", ".cljc", ".cljs"]

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  const out: string[] = []
  try {
    const tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n")
      .filter((f) => f.length > 0 && CLOJURE_EXTS.some((e) => f.endsWith(e)))
    for (const f of tracked) out.push(path.join(dir, f))
    return out.sort()
  } catch {
    const walk = (d: string): void => {
      for (const e of readdirSync(d)) {
        if (e === ".git" || e === "target" || e === "node_modules" || e === "out") continue
        const p = path.join(d, e)
        const st = statSync(p)
        if (st.isDirectory()) walk(p)
        else if (CLOJURE_EXTS.some((x) => e.endsWith(x))) out.push(p)
      }
    }
    walk(dir)
    return out.sort()
  }
}

// ── endpoint / name predicates (char scans, never regex) ────────────────────
const PLACEHOLDERS = ["unknown", "unknown_fn", "unknown_symbol", "?", "<anonymous>", "undefined", "null", "TODO", "<unknown>"]
const isPlaceholder = (s: string): boolean => PLACEHOLDERS.some((p) => s === p)
/** A `str_lit` target: the quotes are in the node's own text, and an edge target
 *  that carries them names nothing. Counted as a defect wherever it appears. */
const hasQuote = (s: string): boolean => {
  const q = 34
  return s.length > 0 && (s.charCodeAt(0) === q || s.charCodeAt(s.length - 1) === q)
}
const prefixOf = (q: string): string => {
  const slash = q.indexOf("/")
  return slash > 0 ? q.slice(0, slash) : q
}
const suffixOf = (q: string): string => {
  const slash = q.indexOf("/")
  return slash >= 0 && slash + 1 < q.length ? q.slice(slash + 1) : q
}
const isUpperStart = (s: string): boolean => {
  if (s.length === 0) return false
  const c = s.charCodeAt(0)
  return c >= 65 && c <= 90
}
const hasDot = (s: string): boolean => s.indexOf(".") !== -1

interface Row {
  count: number
  files: Set<string>
  fileCount: number
  lined: number
  unlined: string[]
  confidence: Record<string, number>
  withEvidenceClass: number
  explained: number
  unexplainedSamples: string[]
  srcLocal: number
  srcNotLocal: string[]
  tgtLocal: number
  tgtCorpus: number
  tgtExternalNs: number
  tgtMember: number
  tgtQuoted: number
  tgtDangling: string[]
  metaTop: Record<string, number>
}

interface EdgeRec {
  file: string
  ns: string
  type: string
  source: string
  target: string
  line: number
  confidence: number
  meta: Record<string, any>
  hasLine: boolean
}

async function main() {
  const repos = (argOf("--repos", "clj-kondo") as string).split(",").filter(Boolean)
  const outPath = argOf("--out", "/tmp/opencode/clj-ontology-census.json") as string

  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const analyzer = new mod.RealClojureAnalyzer()
  const enumValues: string[] = [...new Set(Object.values(engine.ASTEngine.RelationshipType))].sort()
  const declaredKinds = new Set<string>(Object.values(engine.ASTEngine.SymbolKind))
  const KIND_MODULE: string = engine.ASTEngine.SymbolKind.Module
  const KIND_PROPERTY: string = engine.ASTEngine.SymbolKind.Property

  // ── candidate sites for the types the analyzer does NOT emit ────────────
  const cand: Record<string, number> = {
    // ---- `imports`: a libspec that brings names into this namespace -------
    importsLibspec: 0,
    importsReferName: 0,
    importsJavaClassItem: 0,
    importsStringLib: 0,
    // ---- `exports`: the namespace's public surface ------------------------
    exportsPublicTopLevelDef: 0,
    exportsNsSelfRow: 0,
    // ---- `overrides`: five separate candidate shapes, each measured --------
    // (a) A PROTOCOL METHOD IS SUPPLIED. `(defprotocol P (m [this]))` declares
    //     `m`; `(extend-type T P (m [this] ...))`, a deftype/defrecord body, a
    //     `reify`, or an `extend-protocol` group SUPPLIES it. Two distinct var
    //     identities, both named in the same file, and the shape haskell
    //     publishes for `instance C T where m`.
    overridesSuppliedMethodImplSites: 0,
    overridesSuppliedMethodSameFileDecl: 0,
    // (b) `defmethod`: a dispatch entry is inserted into the multimethod's var.
    overridesDefmethodLocal: 0,
    overridesDefmethodCrossNs: 0,
    // (c) `proxy`: the superclass is named, its method list is not in the file.
    overridesProxyMethodSites: 0,
    overridesProxySuperSameFileType: 0,
    // (d) A SECOND REAL DEFINITION of one namespace-level name. (Reader-conditional
    //     twins are ONE definition seen from two platforms and are counted apart.)
    overridesSecondDefinitionRaw: 0,
    overridesSecondDefinitionNonReaderConditional: 0,
    // (e) `gen-class`/`gen-interface` name a supertype — the `extends`/`implements`
    //     claim this lane made for months.
    genClassExtends: 0,
    genClassImplements: 0,
  }
  const candSamples: Record<string, string[]> = {}
  for (const k of Object.keys(cand)) candSamples[k] = []
  const bump = (k: string, at: string) => {
    cand[k]++
    if (candSamples[k]!.length < 6) candSamples[k]!.push(at)
  }

  const r7: Record<string, number> = {
    symbolEmptyName: 0, symbolUnknownKind: 0, symbolPlaceholderName: 0,
    edgeEmptySource: 0, edgeEmptyTarget: 0, edgePlaceholderSource: 0, edgePlaceholderTarget: 0,
    edgeQuotedTarget: 0, edgeDanglingSource: 0, edgeDanglingTarget: 0,
  }
  const r7Samples: Record<string, string[]> = {}
  for (const k of Object.keys(r7)) r7Samples[k] = []

  // ── corpus-wide identity, filled in PASS 1 ──────────────────────────────
  const corpusScoped = new Set<string>()     // "<scope>/<name>"
  const corpusNamespaces = new Set<string>() // every namespace this graph talks about
  const corpusLibNames = new Set<string>()   // prefixes of qualified targets + libspec names
  const fileLocalNames = new Map<string, Set<string>>()
  const edges: EdgeRec[] = []
  const importRowsByPair: Array<{ file: string; ns: string; module: string }> = []
  const exportRowsByPair: Array<{ file: string; ns: string; name: string }> = []

  let filesParsed = 0, filesFailed = 0, symbolsTotal = 0, throws = 0
  const perRepo: Record<string, any> = {}

  // ── PASS 1 — parse + analyze, collect identity and candidate counts ──────
  for (const repo of repos) {
    const files = listFiles(repo)
    let f = 0, s = 0, r = 0
    for (const file of files) {
      let content: string
      try { content = readFileSync(file, "utf8") } catch { continue }
      if (content.length > 1_500_000) continue
      let root: any
      try { root = parser.parse(content, file).rootNode } catch { filesFailed++; continue }
      let res: any
      try { res = analyzer.analyze(root, content, file) } catch { filesFailed++; continue }
      filesParsed++; f++
      const rel = path.relative(CORPUS_ROOT, file)
      const syms = (res.symbols ?? []) as any[]
      symbolsTotal += syms.length; s += syms.length
      const rels = (res.relationships ?? []) as any[]
      r += rels.length

      const localNames = new Set<string>()
      let nsName = ""
      for (const sym of syms) {
        const nm = typeof sym.name === "string" ? sym.name : ""
        if (nm.length === 0) { r7.symbolEmptyName++; sample(r7Samples, "symbolEmptyName", rel) }
        if (isPlaceholder(nm)) { r7.symbolPlaceholderName++; sample(r7Samples, "symbolPlaceholderName", `${rel} ${nm}`) }
        if (!declaredKinds.has(String(sym.kind))) { r7.symbolUnknownKind++; sample(r7Samples, "symbolUnknownKind", `${rel} ${nm} kind=${String(sym.kind)}`) }
        if (nm.length > 0) localNames.add(nm)
        if (sym.kind === KIND_MODULE) { nsName = nm; corpusNamespaces.add(nm) }
        const scope = typeof sym.scope === "string" ? sym.scope : ""
        if (scope && nm) corpusScoped.add(`${scope}/${nm}`)
      }
      fileLocalNames.set(rel, localNames)

      for (const e of rels) {
        const t = String(e.type ?? "")
        if (t.length === 0) continue
        edges.push({
          file: rel, ns: nsName, type: t,
          source: typeof e.source === "string" ? e.source : "",
          target: typeof e.target === "string" ? e.target : "",
          line: typeof e.line_number === "number" ? e.line_number : 0,
          confidence: typeof e.confidence === "number" ? e.confidence : -1,
          meta: (e.metadata ?? {}) as Record<string, any>,
          hasLine: typeof e.line_number === "number" && e.line_number > 0,
        })
        if (t === "references") {
          const tgt = typeof e.target === "string" ? e.target : ""
          if (tgt.length > 0) { corpusLibNames.add(prefixOf(tgt)); if (tgt.indexOf("/") === -1) corpusNamespaces.add(tgt) }
        }
      }
      for (const im of (res.imports ?? []) as any[]) {
        const m = typeof im.module === "string" ? im.module : ""
        if (m.length > 0) { corpusLibNames.add(m); importRowsByPair.push({ file: rel, ns: nsName, module: m }) }
      }
      for (const ex of (res.exports ?? []) as any[]) {
        const nm = typeof ex.name === "string" ? ex.name : ""
        if (nm.length > 0) exportRowsByPair.push({ file: rel, ns: nsName, name: nm })
      }

      if (nsName.length > 0) bump("exportsNsSelfRow", `${rel} ${nsName}`)
      countCandidates(root, rel, cand, bump, localNames, syms, KIND_PROPERTY)
    }
    perRepo[repo] = { files: f, symbols: s, relationships: r }
  }

  // ── PASS 2 — classify every edge against the whole corpus ───────────────
  const types: Record<string, Row> = {}
  const row = (t: string): Row =>
    (types[t] ??= {
      count: 0, files: new Set(), fileCount: 0, lined: 0, unlined: [], confidence: {},
      withEvidenceClass: 0, explained: 0, unexplainedSamples: [],
      srcLocal: 0, srcNotLocal: [], tgtLocal: 0, tgtCorpus: 0, tgtExternalNs: 0,
      tgtMember: 0, tgtQuoted: 0, tgtDangling: [], metaTop: {},
    })

  for (const e of edges) {
    const rr = row(e.type)
    rr.count++
    if (!rr.files.has(e.file)) { rr.files.add(e.file); rr.fileCount++
      if (rr.files.size <= 12) (rr as any).fileList = [...(rr as any).fileList ?? [], e.file] }
    const local = fileLocalNames.get(e.file) ?? new Set<string>()
    const site = `${e.file}:${e.line}`
    if (e.source.length === 0) { r7.edgeEmptySource++; sample(r7Samples, "edgeEmptySource", `${site} ${e.type} ->${e.target}`) }
    if (e.target.length === 0) { r7.edgeEmptyTarget++; sample(r7Samples, "edgeEmptyTarget", `${site} ${e.type} ${e.source}->`) }
    if (isPlaceholder(e.source)) { r7.edgePlaceholderSource++; sample(r7Samples, "edgePlaceholderSource", `${site} ${e.type} ${e.source}`) }
    if (isPlaceholder(e.target)) { r7.edgePlaceholderTarget++; sample(r7Samples, "edgePlaceholderTarget", `${site} ${e.type} ${e.target}`) }
    if (local.has(e.source)) rr.srcLocal++
    else { r7.edgeDanglingSource++; sample(r7Samples, "edgeDanglingSource", `${site} ${e.type} ${e.source} -> ${e.target}`); if (rr.srcNotLocal.length < 6) rr.srcNotLocal.push(`${site} ${e.source}->${e.target}`) }
    if (hasQuote(e.target)) { rr.tgtQuoted++; r7.edgeQuotedTarget++; sample(r7Samples, "edgeQuotedTarget", `${site} ${e.type} ${e.source}->${e.target}`) }
    else if (local.has(e.target)) rr.tgtLocal++
    else if (corpusScoped.has(e.target)) rr.tgtCorpus++
    else if (e.target.length > 0 && corpusNamespaces.has(e.target)) rr.tgtExternalNs++
    else if (e.target.length > 0 && corpusLibNames.has(prefixOf(e.target))) rr.tgtExternalNs++
    else if (e.target.length > 0 && e.target.indexOf("/") === -1 && hasDot(e.target)) rr.tgtExternalNs++  // a namespace shape
    else if (e.target.length > 0 && e.target.indexOf("/") === -1 && e.target.indexOf(".") !== 0) rr.tgtMember++
    else { r7.edgeDanglingTarget++; sample(r7Samples, "edgeDanglingTarget", `${site} ${e.type} ${e.source} -> ${e.target}`); if (rr.tgtDangling.length < 8) rr.tgtDangling.push(`${site} ${e.source}->${e.target}`) }
    if (e.hasLine) rr.lined++
    else if (rr.unlined.length < 6) rr.unlined.push(`${site} ${e.source}->${e.target}`)
    const ck = String(e.confidence)
    rr.confidence[ck] = (rr.confidence[ck] ?? 0) + 1
    if (typeof e.meta.evidenceClass === "string" && e.meta.evidenceClass.length > 0) rr.withEvidenceClass++
    const why = WHY_KEYS.find((k) => e.meta[k] !== undefined && e.meta[k] !== null)
    if (why) { rr.explained++; rr.metaTop[why] = (rr.metaTop[why] ?? 0) + 1 }
    else if (rr.unexplainedSamples.length < 6) rr.unexplainedSamples.push(`${site} ${e.source}->${e.target} meta=${Object.keys(e.meta).join(",")}`)
  }

  // ── duplication measurement: does an imports/exports row already have an edge? ──
  // Matched by NAME within the same FILE, not by the file's last namespace: a file
  // with `(in-ns …)` carries two namespaces and pairing every row with the last one
  // invents mismatches that are an artefact of the instrument.
  const refTargetsByFile = new Map<string, Set<string>>()
  const containsTargetsByFile = new Map<string, Set<string>>()
  for (const e of edges) {
    if (e.target.length === 0) continue
    if (e.type === "references" && e.target.indexOf("/") === -1) {
      let s = refTargetsByFile.get(e.file); if (!s) { s = new Set(); refTargetsByFile.set(e.file, s) }
      s.add(e.target)
    } else if (e.type === "contains") {
      let s = containsTargetsByFile.get(e.file); if (!s) { s = new Set(); containsTargetsByFile.set(e.file, s) }
      s.add(e.target)
    }
  }
  let importRowsMatched = 0, importRowsSelf = 0
  const importRowsUnmatched: string[] = []
  for (const rowImp of importRowsByPair) {
    if (rowImp.module === rowImp.ns) { importRowsSelf++; continue }
    if ((refTargetsByFile.get(rowImp.file) ?? new Set()).has(rowImp.module)) importRowsMatched++
    else if (importRowsUnmatched.length < 12) importRowsUnmatched.push(`${rowImp.file} ${rowImp.ns} -> ${rowImp.module}`)
  }
  let exportRowsMatched = 0, exportRowsSelfRow = 0
  const exportRowsUnmatched: string[] = []
  for (const rowExp of exportRowsByPair) {
    if (rowExp.name === rowExp.ns) { exportRowsSelfRow++; continue }
    if ((containsTargetsByFile.get(rowExp.file) ?? new Set()).has(rowExp.name)) exportRowsMatched++
    else if (exportRowsUnmatched.length < 12) exportRowsUnmatched.push(`${rowExp.file} ${rowExp.ns} -> ${rowExp.name}`)
  }

  const summary: Record<string, any> = {}
  for (const [t, rr] of Object.entries(types)) {
    const targetTotal = rr.tgtLocal + rr.tgtCorpus + rr.tgtExternalNs + rr.tgtMember
    summary[t] = {
      count: rr.count,
      files: [...rr.files].slice(0, 12),
      fileCount: rr.fileCount,
      linedPct: +(100 * rr.lined / rr.count).toFixed(2),
      confidence: rr.confidence,
      withEvidenceClass: rr.withEvidenceClass,
      explainedPct: +(100 * rr.explained / rr.count).toFixed(2),
      sourceResolvesInFilePct: +(100 * rr.srcLocal / rr.count).toFixed(2),
      targetResolvesPct: rr.count ? +(100 * targetTotal / rr.count).toFixed(2) : 100,
      target: {
        local: rr.tgtLocal, corpusScoped: rr.tgtCorpus, externalNamespace: rr.tgtExternalNs,
        memberOrForeign: rr.tgtMember, quoted: rr.tgtQuoted, dangling: rr.count - targetTotal - rr.tgtQuoted,
      },
      topExplanations: rr.metaTop,
      samples: { srcNotLocal: rr.srcNotLocal, danglingTarget: rr.tgtDangling, unlined: rr.unlined, unexplained: rr.unexplainedSamples },
    }
  }

  const silent = enumValues.filter((t) => types[t] === undefined)
  const totalRels = edges.length
  const out = {
    at: new Date().toISOString(),
    corpus: repos,
    filesParsed, filesFailed, throws, symbolsTotal, relationships: totalRels,
    enumValues,
    emittedTypes: Object.keys(types).sort(),
    silentTypes: silent,
    types: summary,
    r7, r7Samples,
    candidates: cand,
    candidateSamples: candSamples,
    duplication: {
      importRows: importRowsByPair.length,
      importRowsAlreadyCarriedByAReferencesEdge: importRowsMatched,
      importRowsUnmatchedSamples: importRowsUnmatched,
      exportRows: exportRowsByPair.length,
      exportRowsAlreadyCarriedByAContainsEdge: exportRowsMatched,
      exportRowsThatAreTheNamespaceItself: exportRowsSelfRow,
      exportRowsUnmatchedSamples: exportRowsUnmatched,
    },
    perRepo,
    outgoingOnly: "every edge counted here is emitted BY the file being analyzed; nothing here resolves who points AT a symbol",
  }
  writeFileSync(outPath, JSON.stringify(out, null, 1))

  console.log(`files=${filesParsed} failed=${filesFailed} symbols=${symbolsTotal} relationships=${totalRels}`)
  console.log(`enum types=${enumValues.length} fired=${Object.keys(types).length} silent=[${silent.join(" ")}]\n`)
  console.log("type".padEnd(14) + "count".padStart(8) + "files".padStart(7) + "line%".padStart(7) + "src%".padStart(7) + "tgt%".padStart(7) + "quoted".padStart(8) + "evClass".padStart(8) + "  confidences")
  for (const t of enumValues) {
    const s = summary[t]
    if (!s) { console.log(t.padEnd(14) + "SILENT"); continue }
    console.log(
      t.padEnd(14) + String(s.count).padStart(8) + String(s.fileCount).padStart(7) +
      String(s.linedPct).padStart(6) + "%" + String(s.sourceResolvesInFilePct).padStart(6) + "%" +
      String(s.targetResolvesPct).padStart(6) + "%" + String(s.target.quoted).padStart(8) +
      String(s.withEvidenceClass).padStart(8) + "  " + Object.entries(s.confidence).map(([k, v]) => `${k}×${v}`).join(" "),
    )
  }
  console.log("\nR7")
  for (const [k, v] of Object.entries(r7)) console.log(`  ${String(v).padStart(7)}  ${k}`)
  for (const k of Object.keys(r7Samples)) {
    if (r7Samples[k]!.length === 0) continue
    console.log(`      ${k}: ${r7Samples[k]!.slice(0, 4).join(" | ")}`)
  }
  console.log("\nCANDIDATE SITES (constructs the analyzer does not emit as an edge)")
  for (const k of Object.keys(cand)) console.log(`  ${String(cand[k]).padStart(7)}  ${k}\n            e.g. ${candSamples[k]![0] ?? ""}`)
  const d = out.duplication
  console.log(`\nDUPLICATION  imports rows ${d.importRows}, already carried by a references edge ${d.importRowsAlreadyCarriedByAReferencesEdge}`)
  console.log(`             exports rows ${d.exportRows}, already carried by a contains edge ${d.exportRowsAlreadyCarriedByAContainsEdge}, ns-self rows ${d.exportRowsThatAreTheNamespaceItself}`)
  console.log(`written ${outPath}`)
}

const WHY_KEYS = [
  "isGeneralCall", "isThreadedStep", "isBareStep", "isAnonShorthand",
  "isConstructor", "isCtorLiteral", "isJavaInterop", "isFieldAccess", "isStaticInterop",
  "isStaticInteropClass", "isClassReference", "isRecord", "isReify", "isExtendType",
  "isExtendProtocol", "isProxy", "isGenClass", "isTopLevel", "isLibraryDep", "isImport",
  "isMethodImpl", "isSuppliedMethod", "isSecondDefinition", "callArity",
]

function sample(map: Record<string, string[]>, key: string, value: string) {
  if (map[key]!.length < 6) map[key]!.push(value)
}

// ── the candidate census, over the raw tree ────────────────────────────────
/**
 * Every counter here answers "how many of these EXIST in the corpus?", which is
 * the only thing that separates an absent class from an absent measurement.
 */
function countCandidates(
  root: any, rel: string,
  cand: Record<string, number>, bump: (k: string, at: string) => void,
  localNames: Set<string>, syms: any[], KIND_PROPERTY: string,
): void {
  // per-file tables the probes need
  const protoMethodsOf = new Map<string, Set<string>>()   // protocol name -> method names
  const fieldNames = new Set<string>()
  const declaredTypes = new Set<string>()                 // deftype/defrecord/defprotocol/definterface names
  const publicTopLevelNames = new Map<string, number>()   // name -> how many top-level defs (for (d))
  let inReaderConditional = false

  // pass A over the tree: protocol signatures, type names, def-name occurrences
  const stackA: Array<{ n: any; rc: boolean }> = [{ n: root, rc: false }]
  while (stackA.length > 0) {
    const { n, rc } = stackA.pop()!
    let childRC = rc
    if (n.type === "read_cond_lit" || n.type === "splicing_read_cond_lit") childRC = true
    if (n.type === "list_lit" && !rc) {
      const head = executionHead(n)
      const headName = head && head.type === "sym_lit" ? symNameOf(head) : ""
      if (headName === "defprotocol" || headName === "definterface") {
        const pname = symNameOf(n.namedChild(1))
        const ms = new Set<string>()
        for (let i = 2; i < n.namedChildCount; i++) {
          const m = n.namedChild(i)
          if (m && m.type === "list_lit") { const mn = symNameOf(m.namedChild(0)); if (mn) ms.add(mn) }
        }
        protoMethodsOf.set(pname, ms)
        if (pname) declaredTypes.add(pname)
      }
      if (headName === "deftype" || headName === "defrecord") {
        const tname = symNameOf(n.namedChild(1))
        if (tname) declaredTypes.add(tname)
      }
      if (isPublicDefHead(suffixOf(headName))) {
        const nm = symNameOf(n.namedChild(1))
        if (nm.length > 0 && nm.indexOf("/") === -1) publicTopLevelNames.set(nm, (publicTopLevelNames.get(nm) ?? 0) + 1)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stackA.push({ n: c, rc: childRC }) }
  }
  for (const s of syms) if (s.kind === KIND_PROPERTY && typeof s.name === "string") fieldNames.add(s.name)

  // pass B: the sites themselves
  const stack: Array<{ n: any; rc: boolean }> = [{ n: root, rc: false }]
  while (stack.length > 0) {
    const { n, rc } = stack.pop()!
    let childRC = rc
    if (n.type === "read_cond_lit" || n.type === "splicing_read_cond_lit") childRC = true
    if (n.type === "list_lit") {
      const head = executionHead(n)
      const headName = head && head.type === "sym_lit" ? symNameOf(head) : ""
      const at = `${rel}:${(head ?? n).startPosition.row + 1}`
      const line = (head ?? n).startPosition.row + 1

      if (headName === "ns" || headName === "in-ns") {
        for (let i = 1; i < n.namedChildCount; i++) {
          const cl = n.namedChild(i)
          if (!cl || cl.type !== "list_lit") continue
          const clName = clauseNameOf(cl)
          if (clName !== "require" && clName !== "use" && clName !== "import" && clName !== "require-macros") continue
          for (let j = 1; j < cl.namedChildCount; j++) { const lib = cl.namedChild(j); if (lib) countLibspec(lib, at, bump, cand) }
        }
      } else if (headName === "require" || headName === "use" || headName === "import" || headName === "refer" || headName === "require-macros") {
        for (let j = 1; j < n.namedChildCount; j++) { const lib = n.namedChild(j); if (lib) countLibspec(lib, at, bump, cand) }
      } else if (headName === "gen-class" || headName === "gen-interface") {
        // (e) `:extends` / `:implements` options — the supertype claim.
        for (let i = 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "kwd_lit") continue
          const kw = c.childForFieldName("name")?.text ?? ""
          if (kw !== "extends" && kw !== "implements") continue
          const val = n.namedChild(i + 1)
          if (!val) continue
          const targets = val.type === "vec_lit" || val.type === "list_lit" ? val.namedChildCount : 1
          for (let k = 0; k < targets; k++) bump(kw === "extends" ? "genClassExtends" : "genClassImplements", `${at} ${headName} :${kw}`)
        }
      } else if (headName === "defmethod") {
        const nm = symNameOf(n.namedChild(1))
        bump(nm.indexOf("/") >= 0 ? "overridesDefmethodCrossNs" : "overridesDefmethodLocal", `${at} ${nm}`)
      } else if (headName === "proxy") {
        const vec = n.namedChild(1)
        if (vec && vec.type === "vec_lit") {
          let methods = 0
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "list_lit" && c.startIndex !== head.startIndex) methods++
          }
          for (let k = 0; k < methods; k++) bump("overridesProxyMethodSites", at)
          const sup = symNameOf(vec.namedChild(0))
          if (sup.length > 0 && (isUpperStart(sup) || hasDot(sup))) bump("overridesProxySuperSameFileType", `${at} super=${sup}`)
        }
      } else if (headName === "extend-type" || headName === "extend-protocol") {
        // the type being extended, and the protocol(s) it is given
        const typeName = headName === "extend-type" ? symNameOf(n.namedChild(1)) : ""
        const protos = new Set<string>()
        const groupTypes: string[] = []
        if (headName === "extend-type") {
          for (let i = 2; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "sym_lit") protos.add(suffixOf(symNameOf(c)))
          }
        } else {
          protos.add(suffixOf(symNameOf(n.namedChild(1))))
          for (let i = 2; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "sym_lit") groupTypes.push(symNameOf(c))
          }
          // the supplied methods sit under each type; the protocol is the same for all
          countSuppliedMethods(n, head, at, groupTypes.join(","), protos, protoMethodsOf, bump)
          groupTypes.length = 0
        }
        if (headName === "extend-type") countSuppliedMethods(n, head, at, typeName, protos, protoMethodsOf, bump)
      } else if (headName === "deftype" || headName === "defrecord") {
        const tname = symNameOf(n.namedChild(1))
        const protos = new Set<string>()
        let sawFields = false
        for (let i = 2; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "vec_lit" && !sawFields) { sawFields = true; continue }
          if (sawFields && c.type === "sym_lit") protos.add(suffixOf(symNameOf(c)))
        }
        countSuppliedMethods(n, head, at, tname, protos, protoMethodsOf, bump)
      } else if (headName === "reify") {
        const protos = new Set<string>()
        for (let i = 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "sym_lit" && i === 1) protos.add(suffixOf(symNameOf(c)))
        }
        // reify's protocols are the leading symbols; methods follow each
        countSuppliedMethods(n, head, at, "", protos, protoMethodsOf, bump)
      }
      // (d) a second top-level definition of one name, and the `exports` surface
      if (isPublicDefHead(suffixOf(headName)) && head && head.type === "sym_lit") {
        const nm = symNameOf(n.namedChild(1))
        if (nm.length > 0 && nm.indexOf("/") === -1 && isTopLevelChild(n)) {
          bump("overridesSecondDefinitionRaw", `${at} ${nm}${rc ? " (reader-conditional)" : ""}`)
          bump("exportsPublicTopLevelDef", `${at} ${nm}`)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push({ n: c, rc: childRC }) }
  }

  // (d) resolved outside the walk: a name defined twice at top level.
  for (const [nm, n] of publicTopLevelNames) {
    if (n > 1) bump("overridesSecondDefinitionNonReaderConditional", `${rel} ${nm} ×${n}`)
  }
  void fieldNames; void localNames; void inReaderConditional; void declaredTypes
}

/** `extend-type` / `deftype` / `defrecord` / `reify` supply methods to protocols;
 *  a supplied method whose name is a method the SAME FILE's protocol declares is the
 *  candidate `overrides` edge. */
function countSuppliedMethods(
  form: any, head: any, at: string, typeName: string,
  protos: Set<string>, protoMethodsOf: Map<string, Set<string>>, bump: (k: string, at: string) => void,
): void {
  for (let i = 0; i < form.namedChildCount; i++) {
    const c = form.namedChild(i)
    if (!c || c.type !== "list_lit") continue
    if (head && c.startIndex === head.startIndex) continue
    const mName = symNameOf(c.namedChild(0))
    if (!mName) continue
    bump("overridesSuppliedMethodImplSites", `${at} ${typeName}.${mName}`)
    for (const p of protos) {
      const ms = protoMethodsOf.get(p)
      if (ms && ms.has(mName)) bump("overridesSuppliedMethodSameFileDecl", `${at} ${typeName}.${mName} -> ${p}.${mName}`)
    }
  }
}

function countLibspec(node: any, at: string, bump: (k: string, at: string) => void, cand: Record<string, number>) {
  const spec = node.type === "quoting_lit" ? (node.namedChild(0) ?? node) : node
  if (spec.type === "read_cond_lit" || spec.type === "splicing_read_cond_lit") {
    for (let i = 0; i < spec.namedChildCount; i++) { const c = spec.namedChild(i); if (c) countLibspec(c, at, bump, cand) }
    return
  }
  if (spec.type === "vec_lit") {
    const libNode = firstNonMeta(spec)
    if (!libNode) return
    bump("importsLibspec", at)
    if (libNode.type === "str_lit") { bump("importsStringLib", at); return }
    if (libNode.type !== "sym_lit") return
    for (let k = 1; k < spec.namedChildCount; k++) {
      const part = spec.namedChild(k)
      if (!part) continue
      if (part.type === "kwd_lit") {
        const kw = part.childForFieldName("name")?.text ?? ""
        if (kw === "refer" || kw === "only") {
          const list = spec.namedChild(k + 1)
          if (list && (list.type === "vec_lit" || list.type === "list_lit")) {
            for (let r = 0; r < list.namedChildCount; r++) { const rn = list.namedChild(r); if (rn && rn.type === "sym_lit") bump("importsReferName", at) }
          }
        }
      } else if (part.type === "sym_lit" || part.type === "vec_lit" || part.type === "list_lit") {
        bump("importsJavaClassItem", at)
      }
    }
  } else if (spec.type === "list_lit") {
    const pkg = spec.namedChild(0)
    if (pkg && pkg.type === "sym_lit") {
      bump("importsLibspec", at)
      for (let k = 1; k < spec.namedChildCount; k++) { const c = spec.namedChild(k); if (c && (c.type === "sym_lit" || c.type === "list_lit")) bump("importsJavaClassItem", at) }
    }
  } else if (spec.type === "sym_lit") {
    bump("importsLibspec", at)
  }
}

// ── tree helpers (no regex) ────────────────────────────────────────────────
function executionHead(list: any): any {
  for (let i = 0; i < list.namedChildCount; i++) {
    const c = list.namedChild(i)
    if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c
  }
  return null
}
function symNameOf(node: any): string {
  if (!node) return ""
  if (node.type !== "sym_lit") return node.text ?? ""
  const name = node.childForFieldName("name")
  const ns = node.childForFieldName("namespace")
  const nsText = ns ? (ns.childForFieldName("name")?.text ?? ns.text ?? "") : ""
  if (name && nsText) return `${nsText}/${name.text}`
  if (name) return name.text
  return node.text ?? ""
}
function clauseNameOf(list: any): string {
  const h = executionHead(list)
  return h && h.type === "kwd_lit" ? (h.childForFieldName("name")?.text ?? "") : ""
}
function firstNonMeta(spec: any): any {
  let n = spec.namedChild(0)
  while (n && n.type === "meta_lit") {
    let inner: any = null
    for (let k = 0; k < n.namedChildCount; k++) {
      const c = n.namedChild(k)
      if (c && c.type === "sym_lit") { inner = c; break }
    }
    n = inner
  }
  return n
}
function isTopLevelChild(n: any): boolean {
  const p = n.parent
  if (!p) return true
  return p.type !== "list_lit" && p.type !== "vec_lit"
}
/** Def-family heads, as a char scan. `def` optionally followed by `-`/`_`/`+`,
 *  excluding the `default…`/`define…` spellings the analyzer's own rule excludes. */
function isDefLikeHead(bare: string): boolean {
  if (bare.length < 3) return false
  if (bare.slice(0, 3) !== "def") return false
  if (bare.length > 3) {
    const c = bare.charCodeAt(3)
    if (c !== 45 && c !== 95 && c !== 43) return false
    if (bare.length > 4) {
      const fifth = bare.charCodeAt(4)
      const isLetter = (x: number) => (x >= 97 && x <= 122) || (x >= 65 && x <= 90)
      if (!isLetter(fifth)) return false
    }
  }
  return true
}
function isPublicDefHead(bare: string): boolean {
  if (bare.length === 0) return false
  if (bare === "defn-" || bare === "declare") return false
  return isDefLikeHead(bare)
}

main().catch((e) => { console.error(e); process.exit(1) })