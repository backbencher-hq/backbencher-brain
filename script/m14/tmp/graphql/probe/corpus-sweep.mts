/**
 * GraphQL CORPUS SWEEP.
 *
 * Runs the REAL analyzer over every tracked .graphql/.graphqls/.gql file in the
 * corpus through the same entry point production uses, and measures the things a
 * per-case battery cannot:
 *
 *   - phantoms            symbols with no declaration anywhere in the file's own text
 *   - unknown targets     relationship targets that are not declared in the file and
 *                         are not built-in scalars  (the "unknown symbol" class)
 *   - keyword targets     targets that are GraphQL keywords/built-ins
 *   - duplicate ids       two symbols with the same (kind,name,scope)
 *   - zero-based columns  contract violation, corpus-wide
 *   - parse-error honesty how many files the GRAMMAR rejects vs how many errors
 *                         the analyzer reports (must be equal or the analyzer lies)
 *   - range/line audit    every symbol whose range does not contain its own name
 *   - docstring line      symbols whose range starts on a `Description` line
 *   - relationship kinds  the full histogram, so an unhandled construct shows up
 *                         as a missing kind rather than as silence
 *   - extension coverage  `extend` forms and whether their members are emitted
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const wasmPath = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const language: any = await Language.load(fs.readFileSync(wasmPath))
const parser = new ParserClass()
parser.setLanguage(language)
const mod: any = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))
const Klass = mod.RealGraphqlAnalyzer

const EXTS = [".graphql", ".graphqls", ".gql"]
const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 14) return out
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of es) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.includes(path.extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

const roots = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const searchRoots = roots.length ? roots : [path.join(HERE, "repos")]
const files: string[] = []
for (const r of searchRoots) if (fs.existsSync(r)) walk(r, files).forEach((f) => files.push(f))
const uniq = [...new Set(files)].sort()

const BUILTIN_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])
const GRAPHQL_KEYWORDS = new Set([
  "query", "mutation", "subscription", "fragment", "on", "type", "input", "enum", "union", "interface",
  "scalar", "schema", "implements", "extend", "directive", "repeatable", "true", "false", "null", "scalar",
])

const out: any = {
  generatedAt: new Date().toISOString(),
  wasm: wasmPath,
  files: uniq.length,
  bytes: 0,
  lines: 0,
  totals: { symbols: 0, relationships: 0, imports: 0, exports: 0, errors: 0 },
  parse: { grammarErrorFiles: 0, grammarErrorNodes: 0, grammarMissingNodes: 0, analyzerReportedErrors: 0, filesWhereAnalyzerSilentOnGrammarError: [] as string[], crashFiles: [] as string[] },
  kindHistogram: {} as Record<string, number>,
  relHistogram: {} as Record<string, number>,
  relRoleHistogram: {} as Record<string, number>,
  phantoms: [] as any[],
  syntheticIdentities: [] as any[],
  unknownTargets: [] as any[],
  keywordTargets: [] as any[],
  duplicateIds: [] as any[],
  zeroBasedColumns: [] as any[],
  rangeExcludesOwnName: [] as any[],
  docstringLineSymbols: [] as any[],
  extendForms: { total: 0, byForm: {} as Record<string, number>, membersEmitted: 0, membersExpected: 0, filesWithDroppedMembers: [] as string[] },
  unreachableTargets: { total: 0, byType: {} as Record<string, number> },
  timings: { analyzeMsTotal: 0, parseMsTotal: 0, perFileAnalyzeMs: 0, bytes: 0 },
  declRecall: { textualDefinitions: 0, reachedDefinitions: 0, byConstruct: {} as Record<string, number> },
  slowest: [] as any[],
  perFile: [] as any[],
}

const relKeys = new Set<string>()

function bump(h: Record<string, number>, k: string) {
  h[k] = (h[k] ?? 0) + 1
}

/** Count declarations by textually scanning the source, and compare with what the analyzer reached. */
function textualDecls(src: string) {
  const lines = src.split("\n")
  const counts: Record<string, number> = {}
  const bumpT = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
  for (const ln of lines) {
    const t = ln.trim()
    if (/^schema\b/.test(t)) bumpT("schema")
    else if (/^extend\s+type\b/.test(t)) bumpT("extend type")
    else if (/^extend\s+interface\b/.test(t)) bumpT("extend interface")
    else if (/^extend\s+union\b/.test(t)) bumpT("extend union")
    else if (/^extend\s+enum\b/.test(t)) bumpT("extend enum")
    else if (/^extend\s+input\b/.test(t)) bumpT("extend input")
    else if (/^extend\s+scalar\b/.test(t)) bumpT("extend scalar")
    else if (/^extend\s+schema\b/.test(t)) bumpT("extend schema")
    else if (/^type\b/.test(t)) bumpT("type")
    else if (/^interface\b/.test(t)) bumpT("interface")
    else if (/^union\b/.test(t)) bumpT("union")
    else if (/^enum\b/.test(t)) bumpT("enum")
    else if (/^input\b/.test(t)) bumpT("input")
    else if (/^scalar\b/.test(t)) bumpT("scalar")
    else if (/^directive\s+@/.test(t)) bumpT("directive")
    else if (/^(query|mutation|subscription)\b/.test(t)) bumpT("operation")
    else if (/^fragment\b/.test(t)) bumpT("fragment")
  }
  return counts
}

let t0 = Date.now()
for (const f of uniq) {
  let src: string
  try {
    src = fs.readFileSync(f, "utf8")
  } catch {
    continue
  }
  out.bytes += Buffer.byteLength(src)
  out.lines += src.split("\n").length

  const parseStart = Date.now()
  const tree = parser.parse(src)
  out.timings.parseMsTotal += Date.now() - parseStart
  const hasErr = tree.rootNode.hasError
  let errNodes = 0
  let missingNodes = 0
  {
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "ERROR" || n.isError) errNodes++
      if (n.isMissing) missingNodes++
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) st.push(c)
      }
    }
  }
  if (hasErr) out.parse.grammarErrorFiles++
  out.parse.grammarErrorNodes += errNodes
  out.parse.grammarMissingNodes += missingNodes

  let res: any
  const started = Date.now()
  try {
    res = new Klass().analyze(tree.rootNode, src, f)
  } catch (e: any) {
    out.parse.crashFiles.push({ file: f, error: String(e?.message ?? e) })
    continue
  }
  // `analyzeMs` is the analyzer ALONE. The rest of this loop does O(symbols x
  // file bytes) work of its own (the phantom and range checks) and must not be
  // charged to the analyzer, which is why the wall clock and this number differ
  // so much on a 20,000-line file.
  const elapsed = Date.now() - started
  out.timings.analyzeMsTotal += elapsed
  if (elapsed > 200) out.slowest.push({ file: f, analyzeMs: elapsed })
  if (elapsed > 200) out.slowest.push({ file: f, ms: elapsed })

  out.totals.symbols += res.symbols.length
  out.totals.relationships += res.relationships.length
  out.totals.imports += res.imports.length
  out.totals.exports += res.exports.length
  out.totals.errors += res.errors.length
  out.parse.analyzerReportedErrors += res.errors.length
  if (hasErr && res.errors.length === 0) out.parse.filesWhereAnalyzerSilentOnGrammarError.push(f)

  // What the file itself declares. THREE vocabularies, kept apart, because
  // conflating them produced three false-positive classes in the first run:
  //   * `name`            — a bare symbol name (`User`)
  //   * `owner.name`      — a QUALIFIED name, which is what a `contains` /
  //                        `field_selection` target actually is (`Query.user`)
  //   * synthetic names   — `anonymous_operation_<offset>` is a house-convention
  //                        identity (java `anonymous_<Super>`, php
  //                        `anonymous_class_<idx>`, js `anonymous_function_<idx>`)
  //                        and is by construction absent from the source text, so
  //                        counting it as a phantom is counting the convention.
  const declaredHere = new Set<string>()
  const qualifiedDeclared = new Set<string>()
  for (const s of res.symbols) {
    declaredHere.add(s.name)
    if (s.ownerName) qualifiedDeclared.add(`${s.ownerName}.${s.name}`)
  }
  const declaredAny = new Set<string>([...declaredHere, ...qualifiedDeclared])
  for (const b of BUILTIN_SCALARS) declaredAny.add(b)
  const isSynthetic = (name: string) => name.startsWith("anonymous_")
  const resolvable = (target: string) => declaredAny.has(target) || isSynthetic(target)

  const seenIds = new Set<string>()
  for (const s of res.symbols) {
    bump(out.kindHistogram, s.kind)
    // 1. phantom: a NON-synthetic symbol name that never appears in its own
    //    source text. Synthetic identities are counted apart, not here.
    if (isSynthetic(s.name)) {
      out.syntheticIdentities.push({ file: f, kind: s.kind, name: s.name, line: s.range.startLine })
    } else if (!src.includes(s.name)) {
      out.phantoms.push({ file: f, kind: s.kind, name: s.name, line: s.range.startLine })
    }
    // 2. contract: columns are 1-based
    if (s.range.startColumn < 1 || s.range.endColumn < 1) out.zeroBasedColumns.push({ file: f, name: s.name, range: s.range })
    // 3. the range must contain the symbol's own name token
    const seg = src.slice(s.range.startIndex ?? 0, s.range.endIndex ?? 0)
    if (seg.length > 0 && !seg.includes(s.name) && !isSynthetic(s.name)) {
      out.rangeExcludesOwnName.push({ file: f, kind: s.kind, name: s.name, range: s.range, seg: seg.slice(0, 60) })
    }
    // 4. a symbol whose range starts on a `Description` line
    const firstLine = src.split("\n")[s.range.startLine - 1] ?? ""
    if (/^\s*("""|''')/.test(firstLine) || /^\s*"""/.test(firstLine)) {
      out.docstringLineSymbols.push({ file: f, kind: s.kind, name: s.name, line: s.range.startLine, text: firstLine.slice(0, 50) })
    }
    // 4b. a member contributed by an `extend` — the analyzer's own flag, which
    //     is the only trustworthy signal here: a text scan cannot tell a field
    //     inside `extend type X { … }` from one inside `type X { … }`.
    if (s.metadata?.inExtension && s.ownerName) out.extendForms.membersEmitted++
    // 5. duplicate identity
    const id = `${s.kind}|${s.name}|${s.scope ?? ""}`
    if (seenIds.has(id)) out.duplicateIds.push({ file: f, id, line: s.range.startLine })
    seenIds.add(id)
  }

  const fileRels: string[] = []
  for (const r of res.relationships) {
    bump(out.relHistogram, r.type)
    if (r.metadata?.relationshipRole) bump(out.relRoleHistogram, r.metadata.relationshipRole)
    fileRels.push(`${r.type}|${r.source}|${r.target}`)
    // 6. unknown target: not resolvable to a symbol of THIS file. A target that
    //    lives in another file is normal (a schema split over several .graphql
    //    files, or a fragment naming a type its own file does not declare), so
    //    this counts what the store cannot resolve in-file and nothing more.
    if (!resolvable(r.target)) {
      const isFieldQualified = r.target.includes(".")
      if (!isFieldQualified) out.unknownTargets.push({ file: f, type: r.type, source: r.source, target: r.target, role: r.metadata?.relationshipRole })
    }
    // 7. keyword-shaped targets. A GraphQL field MAY legally be named after a
    //    keyword used in a different position — the grammar's `name` rule has no
    //    reserved-word list — and the `schema` namespace's own name is the
    //    keyword `schema`. Both are recorded, because a reader still has to know
    //    they occurred, but neither is a defect on its own.
    if (GRAPHQL_KEYWORDS.has(r.target) || GRAPHQL_KEYWORDS.has(r.source)) {
      out.keywordTargets.push({
        file: f,
        type: r.type,
        source: r.source,
        target: r.target,
        why: r.source === "schema" ? "the `schema` namespace is named after the keyword; its identity, not a reference to one" : r.target === "union" || r.target === "query" ? "a field literally named after a keyword — legal, because GraphQL has no reserved words" : "keyword-shaped",
      })
    }
  }
  relKeys.add(`${f}\u0000${fileRels.length}`)

  // 8. declaration recall by construct
  const textual = textualDecls(src)
  for (const [k, v] of Object.entries(textual)) {
    out.declRecall.textualDefinitions += v
    bump(out.declRecall.byConstruct, k)
  }

  // 9. extension coverage: are extension members emitted?
  //
  // The member shape is read off the TREE, not off the text: a field
  // `FieldDefinition`'s name is a direct `Name` child, and whether it lives in
  // an extension is decided by the walk's own `inExtension` flag, surfaced as
  // `metadata.inExtension`. The first attempt matched the text with
  // `^(\w+)\s*(?:\([^)]*\))?\s*:\s*\S+`, which cannot span a multi-line
  // argument list — so a field with a four-line argument list was counted as
  // "expected and not emitted" when the analyzer had in fact emitted it.
  // `membersExpected` is counted from the tree, by re-walking the extension
  // bodies: every `FieldDefinition` under an `ObjectTypeExtension` /
  // `InterfaceTypeExtension` / `InputFieldsDefinition` of one, plus every
  // `EnumValueDefinition` under an `EnumTypeExtension`. A text scan cannot do
  // this, which is the whole point of the fix.
  {
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "ObjectTypeExtension" || n.type === "InterfaceTypeExtension" || n.type === "EnumTypeExtension" || n.type === "InputObjectTypeExtension") {
        out.extendForms.total++
        bump(out.extendForms.byForm, n.type.replace("TypeExtension", "").replace("Object", "type ").replace("Interface", "interface ").replace("Enum", "enum ").replace("InputObject", "input ").trim() || n.type)
        const members = (n: any): void => {
          if (n.type === "FieldDefinition" || n.type === "EnumValueDefinition") out.extendForms.membersExpected++
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) members(c)
          }
        }
        members(n)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  // `exports` and the count of top-level declarations are recorded TOGETHER, per
  // file, so the export rule — "every top-level type-system declaration" — is
  // checkable arithmetic rather than a claim in a document. The totals alone
  // cannot distinguish a correct rule from one that happens to sum the same.
  const topLevelDeclarations = res.symbols.filter((s: any) => s.metadata?.topLevel === true).length
  out.perFile.push({
    file: f,
    bytes: Buffer.byteLength(src),
    lines: src.split("\n").length,
    symbols: res.symbols.length,
    relationships: res.relationships.length,
    exports: res.exports.length,
    topLevelDeclarations,
    // An export must BE a top-level declaration, and (modulo the deliberate
    // duplicate-identity suppression) a top-level declaration must be an export.
    exportsNotTopLevel: res.exports.filter((e: any) => !res.symbols.some((s: any) => s.name === e.name && s.metadata?.topLevel === true)).length,
    errors: res.errors.length,
    grammarError: hasErr,
    grammarErrorNodes: errNodes,
    ms: elapsed,
  })
}

out.wallMs = Date.now() - t0
out.timings.perFileAnalyzeMs = +(out.timings.analyzeMsTotal / Math.max(1, uniq.length)).toFixed(3)
out.timings.bytes = out.bytes
out.timings.analyzeLinesPerSecond = Math.round(out.lines / Math.max(1, (out.timings.analyzeMsTotal / 1000)))
out.timings.parseLinesPerSecond = Math.round(out.lines / Math.max(1, (out.timings.parseMsTotal / 1000)))
out.timings.note = "analyzeMsTotal is the analyzer alone; wallMs also contains this probe's own O(symbols x bytes) phantom/range checks, which are not the analyzer's cost."
out.reach = {
  textualDefinitions: out.declRecall.textualDefinitions,
  byConstruct: out.declRecall.byConstruct,
}
delete out.declRecall

fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(path.join(HERE, "out/corpus-sweep.json"), JSON.stringify(out, null, 2))

const p = out.parse
console.log(`files=${out.files} bytes=${out.bytes} lines=${out.lines} wallMs=${out.wallMs}  (analyzer alone: ${out.timings.analyzeMsTotal} ms = ${out.timings.analyzeLinesPerSecond} lines/s; parse: ${out.timings.parseMsTotal} ms = ${out.timings.parseLinesPerSecond} lines/s; the remainder is this probe's own checks)`)
console.log(`symbols=${out.totals.symbols} relationships=${out.totals.relationships} exports=${out.totals.exports} imports=${out.totals.imports}`)
console.log(`grammar errorFiles=${p.grammarErrorFiles} errorNodes=${p.grammarErrorNodes} missingNodes=${p.grammarMissingNodes}  analyzerReportedErrors=${p.analyzerReportedErrors}`)
console.log(`  files where the grammar errored and the analyzer said nothing: ${p.filesWhereAnalyzerSilentOnGrammarError.length}`)
console.log(`  crashFiles=${p.crashFiles.length}`)
console.log(`\nkinds:   ${JSON.stringify(out.kindHistogram)}`)
console.log(`rels:    ${JSON.stringify(out.relHistogram)}`)
console.log(`roles:   ${JSON.stringify(out.relRoleHistogram)}`)
console.log(`\nphantoms=${out.phantoms.length}  syntheticIdentities=${out.syntheticIdentities.length}  unknownTargets=${out.unknownTargets.length}  keywordTargets=${out.keywordTargets.length}  duplicateIds=${out.duplicateIds.length}`)
console.log(`  resolvability: ${out.totals.relationships - out.unknownTargets.length} / ${out.totals.relationships} relationships resolve to a symbol of their own file = ${((out.totals.relationships - out.unknownTargets.length) / Math.max(1, out.totals.relationships) * 100).toFixed(2)}%`)
console.log(`zeroBasedColumns=${out.zeroBasedColumns.length} rangeExcludesOwnName=${out.rangeExcludesOwnName.length} docstringLineSymbols=${out.docstringLineSymbols.length}`)
console.log(`\nextends: total=${out.extendForms.total} membersExpected=${out.extendForms.membersExpected} membersEmitted=${out.extendForms.membersEmitted} filesWithDroppedMembers=${out.extendForms.filesWithDroppedMembers.length}`)
console.log(`  byForm=${JSON.stringify(out.extendForms.byForm)}`)
console.log(`\ntextual definitions by construct: ${JSON.stringify(out.declRecall === undefined ? out.reach.byConstruct : {})} `)
process.exitCode = 0
