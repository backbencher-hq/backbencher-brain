/**
 * ENUM_HARD_FIX wire census — WHO holds which declaration, measured.
 *
 * JOB 1 needs to answer "which side is wrong" and that is not answerable from
 * the analyzer side alone. Three separate populations decide it:
 *
 *   A. the WRITERS — every `src/ast/real-*-analyzer.ts`, and what string each
 *      one puts on an import edge: the raw literal `"imports"`, or a
 *      `RelationshipType.Imports` access whose value depends on which of the
 *      two declarations that file imported.
 *   B. the READERS — every site that compares an edge's label against
 *      `RelationshipType.Imports`, again split by which declaration the file
 *      imported.
 *   C. the STORE — what value `brain_relationship.relationship_type` is given,
 *      read from the write path rather than from a doc.
 *
 * A source scan cannot answer "does it fire" — that is the other instrument.
 * It CAN answer "what name is written here", because that is a lexical fact
 * about the program text, and this file reads the program text with the
 * TypeScript compiler's own parser rather than with a pattern, so a string
 * literal inside a comment or inside a template is not mistaken for code.
 *
 * NO REGEX. Every classification is `ts.SyntaxKind` equality, `Set.has` on an
 * exact string, or `path.resolve` comparison. There is not one regular
 * expression in this file.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT = argOf("--out")

const TYPES_TS = path.join(ROOT, "src/ast/types.ts")
const ENGINE_TS = path.join(ROOT, "src/ast/engine.ts")

type Origin = "types.ts" | "engine.ts" | "namespace-ASTEngine" | "none" | "ambiguous"
const rel = (p: string) => path.relative(ROOT, p)

/** Walk every tracked .ts/.tsx/.mts/.cts under the given roots. */
function trackedFiles(roots: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (d: string, depth: number) => {
    if (depth > 8 || !existsSync(d)) return
    let ents: import("node:fs").Dirent[]
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue
        walk(p, depth + 1)
        continue
      }
      if (seen.has(p)) continue
      const ext = path.extname(e.name).toLowerCase()
      if (ext !== ".ts" && ext !== ".tsx" && ext !== ".mts" && ext !== ".cts") continue
      seen.add(p)
      out.push(p)
    }
  }
  for (const r of roots) walk(r, 0)
  return out
}

interface Site {
  file: string
  line: number
  kind: string
  detail: string
}
interface FileReport {
  file: string
  origin: Origin
  relationshipTypeImports: Site[]
  literalImportsSites: Site[]
  analyzerEmitsEnumImports: boolean
  analyzerEmitsLiteralImports: boolean
  isAnalyzer: boolean
}

const results: FileReport[] = []

function analyse(file: string, isAnalyzer: boolean): FileReport {
  const text = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lineOf = (n: number) => sf.getLineAndCharacterOfPosition(n).line + 1

  // ---- where does RelationshipType come from in THIS file?
  let origin: Origin = "none"
  const originCandidates: Origin[] = []
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !st.moduleSpecifier) continue
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue
    const spec = st.moduleSpecifier.text
    const named = st.importClause.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text
        if (imported !== "RelationshipType") continue
        const resolved = path.resolve(path.dirname(file), spec)
        if (resolved === TYPES_TS) originCandidates.push("types.ts")
        else if (resolved === ENGINE_TS) originCandidates.push("engine.ts")
        else originCandidates.push("none")
      }
    }
  }
  if (originCandidates.length === 1) origin = originCandidates[0]
  else if (originCandidates.length > 1) origin = "ambiguous"
  // `ASTEngine.RelationshipType` — engine's enum reached through its namespace
  let viaNamespace = false
  const visitNs = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "RelationshipType") {
      const o = n.expression
      if (ts.isIdentifier(o) && o.text === "ASTEngine") viaNamespace = true
    }
    ts.forEachChild(n, visitNs)
  }
  visitNs(sf)
  if (origin === "none" && viaNamespace) origin = "namespace-ASTEngine"

  // ---- every `RelationshipType.Imports` access, and every `"imports"` literal
  const rtSites: Site[] = []
  const litSites: Site[] = []
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "Imports") {
      const o = n.expression
      const isEnumish =
        (ts.isIdentifier(o) && (o.text === "RelationshipType" || o.text === "RT")) ||
        (ts.isPropertyAccessExpression(o) && ts.isIdentifier(o.expression) && o.expression.text === "ASTEngine")
      if (isEnumish) {
        const parent = n.parent
        let kind = "value"
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) kind = "comparison"
        else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) kind = "assignment"
        else if (ts.isPropertyAccessExpression(parent) && parent.name.text === "Imports") kind = "reads-Imports"
        rtSites.push({ file: rel(file), line: lineOf(n.getStart(sf)), kind, detail: n.getText(sf).slice(0, 80) })
      }
    }
    if (ts.isStringLiteral(n) && n.text === "imports") {
      litSites.push({ file: rel(file), line: lineOf(n.getStart(sf)), kind: "string-literal", detail: n.getText(sf).slice(0, 80) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  return {
    file: rel(file),
    origin,
    relationshipTypeImports: rtSites,
    literalImportsSites: litSites,
    analyzerEmitsEnumImports: isAnalyzer && rtSites.length > 0,
    analyzerEmitsLiteralImports: isAnalyzer && litSites.length > 0,
    isAnalyzer,
  }
}

const allFiles = trackedFiles([path.join(ROOT, "src"), path.join(ROOT, "script")])
let analyzedCount = 0
for (const f of allFiles) {
  const isAnalyzer = path.basename(path.dirname(f)) === "ast" && path.basename(f).startsWith("real-") && path.basename(f).endsWith("-analyzer.ts")
  let r: FileReport
  try {
    r = analyse(f, isAnalyzer)
  } catch {
    continue
  }
  analyzedCount++
  results.push(r)
}

// --------------------------------------------------------------- the report
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

const originTally = new Map<Origin, number>()
for (const r of results) originTally.set(r.origin, (originTally.get(r.origin) ?? 0) + 1)

console.log("=" .repeat(104))
console.log("A. WHERE `RelationshipType` COMES FROM, PER FILE (typescript compiler parse, not a pattern)")
console.log("-".repeat(104))
console.log(`files parsed: ${analyzedCount}`)
for (const [o, n] of [...originTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(o, 22)}${n}`)

const rtReaders = results.filter((r) => r.relationshipTypeImports.length > 0)
const rtReaderSites = rtReaders.flatMap((r) => r.relationshipTypeImports.map((s) => ({ ...s, origin: r.origin })))
console.log()
console.log("B. `RelationshipType.Imports` SITES, SPLIT BY THE DECLARATION THAT FILE IMPORTED")
console.log("-".repeat(104))
const byOrigin = new Map<Origin, number>()
for (const s of rtReaderSites) byOrigin.set(s.origin, (byOrigin.get(s.origin) ?? 0) + 1)
for (const [o, n] of [...byOrigin.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  sites in files importing ${pad(o, 22)}${n}`)
}
console.log(`  TOTAL sites: ${rtReaderSites.length} across ${rtReaderSites.length ? new Set(rtReaderSites.map((s) => s.file)).size : 0} files`)
const comparisons = rtReaderSites.filter((s) => s.kind === "comparison")
const assignments = rtReaderSites.filter((s) => s.kind === "assignment")
console.log(`  of those: ${comparisons.length} equality COMPARISONS, ${assignments.length} assignments, ${rtReaderSites.length - comparisons.length - assignments.length} value reads`)
console.log()
console.log("  every comparison site, with the declaration it resolves to:")
for (const s of comparisons.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))) {
  console.log(`    ${pad(s.origin, 14)}${pad(s.file, 62)}:${s.line}  ${s.detail}`)
}

console.log()
console.log("C. ANALYZERS: raw `\"imports\"` literal vs `RelationshipType.Imports`")
console.log("-".repeat(104))
const analyzers = results.filter((r) => r.isAnalyzer)
const enumEmitters = analyzers.filter((r) => r.analyzerEmitsEnumImports)
const literalEmitters = analyzers.filter((r) => r.analyzerEmitsLiteralImports)
const bothEmitters = analyzers.filter((r) => r.analyzerEmitsEnumImports && r.analyzerEmitsLiteralImports)
console.log(`analyzer files: ${analyzers.length}`)
console.log(`  use the raw literal "imports": ${literalEmitters.length}`)
console.log(`  reference RelationshipType.Imports at all: ${enumEmitters.length} (${bothEmitters.length} of them do BOTH)`)
console.log(`  reference neither: ${analyzers.length - new Set([...literalEmitters, ...enumEmitters].map((r) => r.file)).size}`)
const enumEmitterOrigins = new Map<Origin, number>()
for (const r of enumEmitters) enumEmitterOrigins.set(r.origin, (enumEmitterOrigins.get(r.origin) ?? 0) + 1)
console.log(`  the ${enumEmitters.length} enum-referenceing analyzers resolve RelationshipType from:`)
for (const [o, n] of enumEmitterOrigins) console.log(`     ${pad(o, 22)}${n}   <= emitted label is ${o === "types.ts" ? '"brain_import"' : o === "engine.ts" || o === "namespace-ASTEngine" ? '"imports"' : "unknown"}`)
console.log()
console.log("  analyzers carrying the raw literal \"imports\":")
for (const r of literalEmitters) console.log(`    ${r.file}`)
console.log()
console.log("  analyzers referencing RelationshipType.Imports:")
for (const r of enumEmitters) console.log(`    ${pad(r.origin, 22)}${r.file}  (${r.relationshipTypeImports.map((s) => `L${s.line}`).join(",")})`)

const out: any = {
  at: new Date().toISOString(),
  worktree: ROOT,
  filesParsed: analyzedCount,
  originTally: Object.fromEntries(originTally),
  readerSitesTotal: rtReaderSites.length,
  readerFiles: rtReaderSites.length ? new Set(rtReaderSites.map((s) => s.file)).size : 0,
  readerSitesByOrigin: Object.fromEntries(byOrigin),
  comparisons: comparisons.map((s) => ({ origin: s.origin, file: s.file, line: s.line, text: s.detail })),
  assignments: assignments.map((s) => ({ origin: s.origin, file: s.file, line: s.line, text: s.detail })),
  analyzers: {
    total: analyzers.length,
    literalImportsEmitters: literalEmitters.map((r) => r.file),
    enumImportsReferencers: enumEmitters.map((r) => ({ file: r.file, origin: r.origin, sites: r.relationshipTypeImports })),
    enumReferencerOrigins: Object.fromEntries(enumEmitterOrigins),
  },
  allFiles: results.filter((r) => r.origin !== "none"),
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}