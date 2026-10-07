// JAVASCRIPT_FIX lane census — ONTOLOGY-WORKSTREAM Part 1 + Part 2 instrument.
//
// WHY THIS EXISTS, and why it is not `script/m14/firing-check-v2.mjs`:
// v2 is the shared instrument and is MASTER-owned; it also hardcodes
// REPO = the main checkout, so it cannot observe an edit in a lane worktree.
// This file is the LANE's own instrument and does two things v2 does not:
//
//   1. It walks the WHOLE corpus, not the first NFILES in directory order. The
//      whole point of the sample-size caveat in docs/analyzers/REVIEW-2026-10-04.md
//      is that a verdict can move on a file-count knob; a census that reports the
//      corpus TOTAL and what fraction it sampled removes the knob from the verdict.
//   2. It separates the two channels (relationships vs imports[]) the way v2 does,
//      AND answers the six questions of ONTOLOGY-WORKSTREAM Part 1 per type:
//      fires / oracle / labelled / resolved / confident / placeholder-clean.
//
// IT ALSO CARRIES A GRAMMAR-LEVEL CONSTRUCT CENSUS that is independent of the
// analyzer: it walks the tree-sitter AST and counts the CONSTRUCT each missing
// relationship type would be derived from. That is what makes a RULED verdict
// falsifiable — if the construct count is 0, the construct does not occur in the
// corpus; if it is non-zero, the analyzer is missing a construct that IS there.
// Source derivation cannot answer this, and firing-check cannot either.
//
// NO REGEX. Every test below is an extension comparison, a node-type string
// comparison, or a Set lookup. See docs/analyzers/ONTOLOGY-WORKSTREAM.md and the
// lane brief's rule 1. `bun run script/m14/js-ontology/js-census.ts` prints a
// self-check that the file contains no regular-expression literal.
//
// USAGE
//   bun run script/m14/js-ontology/js-census.ts                      # lodash, all files
//   bun run script/m14/js-ontology/js-census.ts --corpus svelte
//   bun run script/m14/js-ontology/js-census.ts --corpus lodash --limit 200
//   bun run script/m14/js-ontology/js-census.ts --json out.json

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../src/ast/engine"
import { ASTEngine } from "../../../src/ast/engine"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { isJsBuiltin, jsBuiltinHasMember } from "../../../src/ast/js-builtin-prototypes"

const REPO = "$HOME/backbencher-brain"
const DEFAULT_CORPUS = "$HOME/fixtures/repositories"
const JS_EXTS = [".js", ".mjs", ".cjs"]

// ---------------------------------------------------------------------------
// NO-REGEX SELF CHECK. A regex LITERAL in this file is a hard error, and the
// check is a char walk over the source that looks for `/` opening a literal —
// which is why the pattern is built from String.fromCharCode, not written out.
// ---------------------------------------------------------------------------
const SLASH = String.fromCharCode(47)
function assertNoRegexLiteral(): void {
  const src = readFileSync(new URL(import.meta.url).pathname, "utf8")
  const NL = "\n"
  let i = 0
  let inStr: string | null = null
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (inStr) {
      if (ch === "\\") { i += 2; continue }
      if (ch === inStr) inStr = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue }
    if (ch === SLASH && next === SLASH) {           // line comment
      while (i < src.length && src[i] !== NL) i++
      continue
    }
    if (ch === SLASH && next === "*") {             // block comment
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === SLASH)) i++
      i += 2
      continue
    }
    if (ch === SLASH) {
      // a division, an assignment, or a path inside a bare word is not a literal
      const prev = src[i - 1]
      const isDivider = prev === " " || prev === "(" || prev === "," || prev === "=" ||
        prev === "{" || prev === "[" || prev === ":" || prev === NL || prev === ";"
      if (next === undefined || isDivider) { i++; continue }
      console.error(`js-census: possible regex literal at source offset ${i} — rule 1 of the lane brief forbids it`)
      process.exit(2)
    }
    i++
  }
}
assertNoRegexLiteral()

// ---------------------------------------------------------------------------
// corpus walk
// ---------------------------------------------------------------------------
function hasExt(name: string, exts: string[]): boolean {
  for (const e of exts) if (name.endsWith(e)) return true
  return false
}
function isSkippedDir(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist-test" || name === "coverage"
}
function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  let ents: ReturnType<typeof readdirSync>
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents as any[]) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!isSkippedDir(e.name)) walkFiles(p, exts, out) }
    else if (hasExt(e.name, exts)) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// grammar-level construct census — the falsifier for a RULED verdict.
// Walks the raw tree-sitter AST. Never consults the analyzer.
// ---------------------------------------------------------------------------
interface ConstructCounts {
  files: number
  nodes: number
  classHeritage: number
  classDecl: number
  classExpr: number
  heritageBases: Set<string>
  // a heritage base whose name looks like a DECLARED interface type — the only
  // thing that could be an `implements` in a language with no implements clause.
  heritageBaseFiles: Set<string>
  // class declarations that have a heritage AND at least one method_definition:
  // the population an `overrides` edge could be derived from at all.
  classWithHeritageAndMembers: number
  memberNameMatches: number
  memberNameMatchDetail: Map<string, number>
  // any node whose type names an implements construct, at any depth.
  implementsNodeTypes: Map<string, number>
  // private names (a `#name` is class-scoped, never a prototype member)
  privateMembers: number
  accessors: number
  staticMembers: number
  prototypeAssignments: number
  importStatements: number
  exportStatements: number
  cjsRequire: number
  cjsModuleExports: number
  newExpressions: number
  callExpressions: number
  instanceOfChecks: number
  decoratorNodes: number
  jsxElements: number
}
function newConstructCounts(): ConstructCounts {
  return {
    files: 0, nodes: 0, classHeritage: 0, classDecl: 0, classExpr: 0,
    heritageBases: new Set(), heritageBaseFiles: new Set(),
    classWithHeritageAndMembers: 0, memberNameMatches: 0, memberNameMatchDetail: new Map(),
    implementsNodeTypes: new Map(), privateMembers: 0, accessors: 0, staticMembers: 0,
    prototypeAssignments: 0, importStatements: 0, exportStatements: 0, cjsRequire: 0,
    cjsModuleExports: 0, newExpressions: 0, callExpressions: 0, instanceOfChecks: 0,
    decoratorNodes: 0, jsxElements: 0,
  }
}

/** Members declared by a class body, with the kind distinctions the override
 *  rule needs. Purely structural: node types and the `static` token. */
function classBodyMembers(body: any): { name: string; isStatic: boolean; isAccessor: boolean; isPrivate: boolean }[] {
  const out: { name: string; isStatic: boolean; isAccessor: boolean; isPrivate: boolean }[] = []
  for (let i = 0; i < body.namedChildCount; i++) {
    const c = body.namedChild(i)
    if (!c) continue
    if (c.type !== "method_definition") continue
    const nameNode = c.childForFieldName("name")
    if (!nameNode) continue
    let isStatic = false
    let isAccessor = false
    for (let k = 0; k < c.childCount; k++) {
      const t = c.child(k)
      if (!t) continue
      if (t.type === "static") isStatic = true
      if (t.type === "get" || t.type === "set") isAccessor = true
    }
    out.push({ name: nameNode.text, isStatic, isAccessor, isPrivate: nameNode.type === "private_property_identifier" })
  }
  return out
}

function censusConstructs(root: any, c: ConstructCounts): void {
  // (1) first pass: every class declaration/expression and its members, by name
  const classesByName = new Map<string, { name: string; base?: string; members: string[] }>()
  const implementsTypes = new Set<string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    c.nodes++
    const t = n.type as string
    if (t.includes("implements") || t.includes("interface")) implementsTypes.add(t)
    if (t === "class_declaration" || t === "class") {
      const nameNode = n.childForFieldName("name")
      const name = nameNode ? nameNode.text : undefined
      const body = n.namedChildren.find((x: any) => x.type === "class_body")
      const members = body ? classBodyMembers(body) : []
      for (const m of members) {
        if (m.isAccessor) c.accessors++
        if (m.isStatic) c.staticMembers++
        if (m.isPrivate) c.privateMembers++
      }
      if (t === "class_declaration") c.classDecl++
      else c.classExpr++
      if (name) {
        const heritage = n.namedChildren.find((x: any) => x.type === "class_heritage")
        let base: string | undefined
        if (heritage) {
          c.classHeritage++
          for (const h of heritage.namedChildren) {
            if (h.type === "identifier" || h.type === "member_expression") { base = base ?? h.text }
          }
          if (base) { c.heritageBases.add(base); c.heritageBaseFiles.add(base) }
        }
        classesByName.set(name, { name, base, members: members.map((m) => m.name) })
      }
    }
    if (t === "prototype_assignment") c.prototypeAssignments++
    if (t === "import_statement") c.importStatements++
    if (t === "export_statement") c.exportStatements++
    if (t === "new_expression") c.newExpressions++
    if (t === "call_expression") {
      c.callExpressions++
      const fn = n.childForFieldName("function")
      if (fn && fn.type === "identifier" && fn.text === "require") c.cjsRequire++
    }
    if (t === "assignment_expression") {
      const left = n.childForFieldName("left")
      if (left && left.type === "member_expression") {
        const obj = left.childForFieldName("object")
        if (obj && obj.type === "identifier" && obj.text === "module") {
          const prop = left.childForFieldName("property")
          if (prop && prop.type === "property_identifier" && prop.text === "exports") c.cjsModuleExports++
        }
        // X.prototype.m = fn  -- the prototype-inheritance construct. The object
        // is a member_expression whose property is `prototype`.
        if (obj && obj.type === "member_expression") {
          const op = obj.childForFieldName("property")
          if (op && op.text === "prototype") c.prototypeAssignments++
        }
      }
    }
    if (t === "binary_expression" && n.childForFieldName("operator")?.text === "instanceof") c.instanceOfChecks++
    if (t === "decorator") c.decoratorNodes++
    if (t === "jsx_element" || t === "jsx_self_closing_element") c.jsxElements++
    for (let i = 0; i < n.namedChildCount; i++) {
      const ch = n.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  for (const t of implementsTypes) c.implementsNodeTypes.set(t, (c.implementsNodeTypes.get(t) ?? 0) + 1)
  // module.exports = ... / exports.x = ...
  const m2: any[] = [root]
  while (m2.length) {
    const n = m2.pop()
    if (!n) continue
    for (let i = 0; i < n.namedChildCount; i++) {
      const ch = n.namedChild(i)
      if (ch) m2.push(ch)
    }
  }
  // override CANDIDATES: in-file base declares a same-named member
  for (const cls of classesByName.values()) {
    if (!cls.base) continue
    const base = classesByName.get(cls.base)
    if (!base) continue
    c.classWithHeritageAndMembers++
    for (const m of cls.members) {
      if (base.members.includes(m)) {
        c.memberNameMatches++
        c.memberNameMatchDetail.set(`${cls.name}.${m}->${base.name}.${m}`, (c.memberNameMatchDetail.get(`${cls.name}.${m}->${base.name}.${m}`) ?? 0) + 1)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// relationship tallies
// ---------------------------------------------------------------------------
const PROD: string[] = [...new Set(Object.values(ASTEngine.RelationshipType))]

interface TypeStat {
  count: number
  files: number
  fileNames: string[]
  conf: Map<string, number>
  evidence: Map<string, number>
  srcResolved: number
  tgtResolved: number
  tgtBuiltin: number
  emptyEndpoint: number
  placeholderEndpoint: number
  placeholderSites: Map<string, number>
  reservedSites: Map<string, number>
  samples: string[]
}
function newTypeStat(): TypeStat {
  return {
    count: 0, files: 0, fileNames: [], conf: new Map(), evidence: new Map(),
    srcResolved: 0, tgtResolved: 0, tgtBuiltin: 0, emptyEndpoint: 0,
    placeholderEndpoint: 0, placeholderSites: new Map(), reservedSites: new Map(), samples: [],
  }
}

// R7: "no analyzer may NAME something with a placeholder literal." The set is
// CASE-SENSITIVE on purpose. A first cut lower-cased both sides and convicted 15
// edges on lodash that were not placeholders: minified lodash declares a variable
// spelled `Na` (lowercases to `na`) and a vendor file writes `realm.null` /
// `win.Undefined`, where `null` and `Undefined` are PROPERTY names written in the
// source. Both were convicted and both were innocent. A rule with false positives
// gets disabled, which is worse than no rule (REVIEW-2026-10-04 §5).
const PLACEHOLDERS = new Set([
  "unknown", "<unknown>", "UNKNOWN", "?", "n/a", "N/A", "none_", "<name>",
  "unnamed", "<unnamed>", "todo", "TODO", "<T>", "<type>", "<file>", "<module>",
])
// Reported SEPARATELY and never as an R7 conviction: spellings that are reserved
// words or host globals in JavaScript. A member property legitimately spelled
// `null` exists in the source, so an edge naming it is not a placeholder — but a
// reader deserves to see that the name collides with a global.
const RESERVED_SPELLINGS = new Set(["null", "undefined", "NaN", "this", "super", "arguments", "globalThis"])

function isPlaceholder(s: string): boolean {
  const t = s.trim()
  if (PLACEHOLDERS.has(t)) return true
  if (t.length > 2 && t.startsWith("<") && t.endsWith(">")) return true
  return false
}
function isReservedSpelling(s: string): boolean {
  return RESERVED_SPELLINGS.has(s.trim())
}
function isEmpty(s: string): boolean {
  return s === undefined || s === null || String(s).trim().length === 0
}
/** `Owner.member` — the endpoint is resolved when its LEAF names a symbol. */
function leafOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i < 0 ? name : name.slice(i + 1)
}
function memberLeaf(name: string): string {
  // `Owner.member` or `mod.path:item`
  const i = name.lastIndexOf(".")
  if (i < 0) return name
  return name.slice(i + 1)
}

function bump(m: Map<string, number>, k: string): void { m.set(k, (m.get(k) ?? 0) + 1) }

// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2)
  const getArg = (name: string, dflt?: string) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
  }
  const corpusDir = getArg("--corpus", "lodash") as string
  const limit = Number(getArg("--limit", "0"))
  const jsonOut = getArg("--json")
  const dir = join(DEFAULT_CORPUS, corpusDir)
  const root = join(REPO, "..")

  let files = walkFiles(dir, JS_EXTS).sort()
  const corpusTotal = files.length
  if (limit > 0) files = files.slice(0, limit)

  console.log(`js-census  corpus=${corpusDir}  files on disk=${corpusTotal}  analyzed=${files.length}`)
  const parser = await getParser("javascript")

  const tally = new Map<string, TypeStat>()
  for (const t of PROD) tally.set(t, newTypeStat())
  const constructs = newConstructCounts()
  let importsTotal = 0
  let filesWithImports = 0
  let importItemFiles = 0
  let parsed = 0
  let parseFailed = 0
  let errorFiles = 0
  let errorNodes = 0
  let symbolsTotal = 0
  let emptySymbolNames = 0
  const kindTally = new Map<string, number>()
  const importSamples: string[] = []
  const relSampleByType = new Map<string, string[]>()
  const perFileTypes = new Map<string, Set<string>>()

  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { parseFailed++; continue }
    let pr: any
    try { pr = await parser.parse(content) } catch { parseFailed++; continue }
    parsed++
    censusConstructs(pr.rootNode, constructs)
    const res: any = new RealJavaScriptAnalyzer().analyze(pr.rootNode, content, f)
    const symNames = new Set<string>()
    for (const s of res.symbols ?? []) {
      if (isEmpty(s.name)) emptySymbolNames++
      symNames.add(s.name)
      bump(kindTally, String(s.kind))
    }
    symbolsTotal += (res.symbols ?? []).length
    if ((res.errors ?? []).length) { errorFiles++; errorNodes += res.errors.length }
    const imps = res.imports ?? []
    importsTotal += imps.length
    if (imps.length) filesWithImports++
    if (imps.some((i: any) => (i.items ?? []).length > 0)) importItemFiles++
    if (importSamples.length < 6) {
      const first = imps[0]
      if (first) {
        const items = (first.items ?? []).slice(0, 3)
        importSamples.push(`${f.replace(dir + "/", "")} -> module=${first.module} items=${items.length}${items.length ? " [" + items.join(", ") + "]" : ""}`)
      }
    }
    const seen = perFileTypes.get(f) ?? new Set<string>()
    for (const r of res.relationships ?? []) {
      const t = (r.type ?? r.relationshipType) as string
      const st = tally.get(t) ?? newTypeStat()
      if (!tally.has(t)) tally.set(t, st)
      st.count++
      seen.add(t)
      bump(st.conf, String(r.confidence))
      bump(st.evidence, String(r.metadata?.evidenceClass ?? (r.metadata?.reasonCode ? "reasonCode:" + r.metadata.reasonCode : "(none)")))
      const src = String(r.source ?? r.from ?? "")
      const tgt = String(r.target ?? r.to ?? "")
      if (isEmpty(src) || isEmpty(tgt)) st.emptyEndpoint++
      if (isPlaceholder(src) || isPlaceholder(tgt)) {
        st.placeholderEndpoint++
        bump(st.placeholderSites, `${f.replace(dir + "/", "")}: ${src || "(empty)"} -> ${tgt || "(empty)"}`)
      }
      if (isReservedSpelling(src) || isReservedSpelling(tgt)) bump(st.reservedSites, tgt || src)
      if (!isEmpty(src) && (symNames.has(src) || symNames.has(leafOf(src)))) st.srcResolved++
      if (!isEmpty(tgt) && (symNames.has(tgt) || symNames.has(memberLeaf(tgt)) || symNames.has(tgt.split(":").pop() ?? ""))) st.tgtResolved++
      else if (!isEmpty(tgt) && isJsBuiltin(leafOf(tgt)) && jsBuiltinHasMember(leafOf(tgt), memberLeaf(tgt))) st.tgtBuiltin++
      if (st.fileNames.length < 8 && !st.fileNames.includes(f.replace(dir + "/", ""))) st.fileNames.push(f.replace(dir + "/", ""))
      if (!st.fileNames.includes(f.replace(dir + "/", ""))) st.fileNames.push(f.replace(dir + "/", ""))
      const ss = relSampleByType.get(t) ?? []
      if (ss.length < 5) { ss.push(`${f.replace(dir + "/", "")}: ${src} -> ${tgt} (c=${r.confidence})`); relSampleByType.set(t, ss) }
    }
    perFileTypes.set(f, seen)
  }

  // per-file counts for types that fired
  const filesPerType = new Map<string, number>()
  for (const [, s] of perFileTypes) for (const t of s) filesPerType.set(t, (filesPerType.get(t) ?? 0) + 1)

  console.log(`\nparsed=${parsed}  failed=${parseFailed}  errorFiles=${errorFiles}  errorNodes=${errorNodes}`)
  console.log(`symbols=${symbolsTotal}  emptySymbolNames=${emptySymbolNames}`)
  console.log(`kinds: ${[...kindTally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  console.log(`imports[] channel: ${importsTotal} edges in ${filesWithImports} files (with named items: ${importItemFiles})`)
  for (const s of importSamples) console.log(`   ${s}`)

  console.log(`\n=== RELATIONSHIP CHANNEL — per production type (${PROD.length}) ===`)
  console.log(`type          fired  edges  files  srcResolved  tgtResolved  tgtBuiltin  empty  placeholder`)
  let firedCount = 0
  for (const t of PROD) {
    const st = tally.get(t)!
    const n = st.count
    if (n > 0) firedCount++
    console.log(
      `${t.padEnd(13)} ${(n > 0 ? "YES" : "no").padEnd(6)} ${String(n).padStart(6)} ${String(filesPerType.get(t) ?? 0).padStart(6)} ${String(st.srcResolved).padStart(11)} ${String(st.tgtResolved).padStart(11)} ${String(st.tgtBuiltin).padStart(10)} ${String(st.emptyEndpoint).padStart(6)} ${String(st.placeholderEndpoint).padStart(11)}`,
    )
  }
  console.log(`fired (relationship channel): ${firedCount}/${PROD.length}`)
  console.log(`imports on its own channel: ${importsTotal > 0 ? "YES" : "no"} (${importsTotal} edges / ${filesWithImports} files)`)

  for (const t of PROD) {
    const st = tally.get(t)!
    if (!st.count) continue
    console.log(`\n--- ${t} (${st.count} edges) ---`)
    console.log(`   confidence: ${[...st.conf.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`)
    console.log(`   evidenceClass/reasonCode: ${[...st.evidence.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`)
    console.log(`   files: ${st.fileNames.slice(0, 8).join(", ")}`)
    for (const s of (relSampleByType.get(t) ?? [])) console.log(`   e.g. ${s}`)
    if (st.placeholderEndpoint > 0) {
      console.log(`   R7 PLACEHOLDER-LITERAL ENDPOINTS: ${st.placeholderEndpoint}`)
      for (const [k, v] of [...st.placeholderSites.entries()].slice(0, 12)) console.log(`      ${k}  x${v}`)
    }
    if (st.reservedSites.size > 0) {
      console.log(`   reserved/host-global spellings (NOT R7 placeholders): ${[...st.reservedSites.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`)
    }
  }

  console.log(`\n=== GRAMMAR-LEVEL CONSTRUCT CENSUS (independent of the analyzer) ===`)
  console.log(`AST nodes visited: ${constructs.nodes}`)
  console.log(`class_declaration: ${constructs.classDecl}   class expression: ${constructs.classExpr}`)
  console.log(`class_heritage (the ONLY construct an \`extends\` edge can come from): ${constructs.classHeritage}`)
  console.log(`distinct heritage bases: ${constructs.heritageBases.size} -> ${[...constructs.heritageBases].slice(0, 25).join(", ")}`)
  console.log(`classes with an in-file declared base: ${constructs.classWithHeritageAndMembers}`)
  console.log(`in-file same-name member matches (the population \`overrides\` could be derived from): ${constructs.memberNameMatches}`)
  for (const [k, v] of [...constructs.memberNameMatchDetail.entries()].slice(0, 15)) console.log(`     ${k}  x${v}`)
  console.log(`node types containing "implements"/"interface": ${constructs.implementsNodeTypes.size === 0 ? "(none, in any file)" : [...constructs.implementsNodeTypes.keys()].join(", ")}`)
  console.log(`import_statement: ${constructs.importStatements}   export_statement: ${constructs.exportStatements}`)
  console.log(`CJS require(): ${constructs.cjsRequire}   module.exports assignment: ${constructs.cjsModuleExports}`)
  console.log(`new_expression: ${constructs.newExpressions}   call_expression: ${constructs.callExpressions}`)
  console.log(`instanceof checks: ${constructs.instanceOfChecks}   decorator nodes: ${constructs.decoratorNodes}   jsx elements: ${constructs.jsxElements}`)
  console.log(`private #members: ${constructs.privateMembers}   accessors: ${constructs.accessors}   static members: ${constructs.staticMembers}`)

  if (jsonOut) {
    const out: any = {
      corpus: corpusDir, dir, corpusTotalFiles: corpusTotal, analyzedFiles: files.length,
      parsed, parseFailed, errorFiles, errorNodes, symbolsTotal, emptySymbolNames,
      importsTotal, filesWithImports, importItemFiles,
      kinds: Object.fromEntries(kindTally),
      types: Object.fromEntries([...tally.entries()].map(([t, s]) => [t, {
        count: s.count, files: filesPerType.get(t) ?? 0, fileNames: s.fileNames,
        confidence: Object.fromEntries(s.conf), evidence: Object.fromEntries(s.evidence),
        srcResolved: s.srcResolved, tgtResolved: s.tgtResolved, tgtBuiltin: s.tgtBuiltin,
        emptyEndpoint: s.emptyEndpoint, placeholderEndpoint: s.placeholderEndpoint,
        placeholderSites: Object.fromEntries(s.placeholderSites),
        reservedSpellings: Object.fromEntries(s.reservedSites),
        samples: relSampleByType.get(t) ?? [],
      }])),
      fired: firedCount, productionTypes: PROD.length,
      constructs: {
        ...constructs,
        heritageBases: [...constructs.heritageBases],
        heritageBaseFiles: [...constructs.heritageBaseFiles],
        implementsNodeTypes: Object.fromEntries(constructs.implementsNodeTypes),
        memberNameMatchDetail: Object.fromEntries(constructs.memberNameMatchDetail),
      },
    }
    writeFileSync(jsonOut as string, JSON.stringify(out, null, 2))
    console.log(`\nwrote ${jsonOut}`)
  }
}

main().catch((e) => { console.error(String(e)); process.exit(1) })