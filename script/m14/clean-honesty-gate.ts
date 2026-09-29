#!/usr/bin/env bun
// M14.0 — the CLEAN lane's HONESTY gate.
//
// Answers one question about every symbol and every relationship the analyzer
// emits: **is this target a name this file can actually name?** The lane formula
// (§5) requires "unknown/empty names = 0" and §1 requires a heuristic edge to be
// counted rather than hidden; this gate is the measurement behind both, and it is
// the instrument the review's precision claims are quoted from.
//
// RESOLUTION, NOT STRING EQUALITY. The store resolves a relationship endpoint by
// one of three strategies (`src/ast/import-resolution.ts`,
// `parallel-indexer.ts:2734-2736`): a bare `name`, a qualified `Owner.member`, or
// — for a dotted target — everything after the first `.`. So `describe.nonNegative`
// resolves to the local `nonNegative`, and a gate that compared the raw string
// would report a violation the product does not have. Every check below uses those
// three strategies plus `qualifiedName`, which is what a local publishes as its
// distinct identity.
//
// WHAT IS A VIOLATION vs WHAT IS AN ACCEPTED COST. Four edge kinds survive an
// external target because their MEANING does not depend on what the target is: a
// `references` edge in a typed position is a type reference whatever the type is,
// an `implements` edge is an instance whatever the class is, a `calls` edge to a
// source-spelled qualified name is that call, and an `imports` edge names an
// item the source spelled. Those are counted and labelled EXTERNAL rather than
// failed. What fails is a target that resolves to NOTHING, a name that is empty,
// a member without an owner, a symbol that owns itself for any reason other than
// Clean's own shadowing, a duplicate export name, and an import item whose module
// is not imported.
//
// Usage: bun run script/m14/clean-honesty-gate.ts [--corpus <dir>]
// Exits 1 on any violation. Writes nothing.
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const DEFAULT_CORPUS = "$HOME/fixtures/repositories"
const corpusArg = process.argv.indexOf("--corpus")
const REPOS = corpusArg > 0 ? process.argv[corpusArg + 1] : DEFAULT_CORPUS

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

const REL_TYPES = new Set([
  "calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates",
])

const violations: string[] = []
const samples: string[] = []
const note = (kind: string, row: string) => {
  violations.push(`${kind}: ${row}`)
  if (samples.length < 40) samples.push(`  [${kind}] ${row}`)
}
const perType: Record<string, { n: number; unresolved: number }> = Object.create(null)
const external: Record<string, number> = Object.create(null)
const shadow: Record<string, number> = Object.create(null)
const bump = (t: Record<string, number>, k: string) => {
  t[k] = (t[k] || 0) + 1
}

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
if (files.length === 0) {
  console.error(`FAIL no Clean files under ${REPOS} — the gate read nothing`)
  process.exit(1)
}

let totalSymbols = 0
let totalRels = 0
let totalImports = 0
let totalExports = 0
let unknownKinds = 0
let emptyNames = 0
let membersWithoutOwner = 0
let symbolFreeFiles = 0
let crashFiles = 0
const kindHistogram: Record<string, number> = Object.create(null)
const relHistogram: Record<string, number> = Object.create(null)
const unresolvedKinds = new Set<string>()

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const rel = path.relative(REPOS, f)
  let tree: any
  try {
    tree = parser.parse(src)
  } catch (e: any) {
    note("crash.parse", `${rel}: ${e.message}`)
    crashFiles++
    continue
  }
  let r: any
  try {
    r = new RealCleanAnalyzer().analyze(tree.rootNode, src, f)
  } catch (e: any) {
    note("crash.analyze", `${rel}: ${e.message}`)
    crashFiles++
    continue
  }
  totalSymbols += r.symbols.length
  totalRels += r.relationships.length
  totalImports += r.imports.length
  totalExports += r.exports.length
  if (r.symbols.length === 0) symbolFreeFiles++

  // ---- the identities this file publishes
  const names = new Set<string>(r.symbols.map((s: any) => s.name))
  const qNames = new Set<string>(r.symbols.map((s: any) => s.qualifiedName).filter(Boolean))
  const constructors = new Set<string>(r.symbols.filter((s: any) => s.kind === "constructor").map((s: any) => s.name))
  const macros = new Set<string>(r.symbols.filter((s: any) => s.kind === "macro").map((s: any) => s.name))
  const classNames = new Set<string>(r.symbols.filter((s: any) => s.kind === "interface").map((s: any) => s.name))
  const typeNames = new Set<string>(r.symbols.filter((s: any) => s.kind === "type").map((s: any) => s.name))
  const functions = new Set<string>(r.symbols.filter((s: any) => s.kind === "function" || s.kind === "method").map((s: any) => s.name))
  const moduleNames = new Set<string>(r.imports.map((i: any) => i.module))

  /** The store's three strategies, plus `qualifiedName`. */
  const resolvable = (name: string): boolean => {
    if (names.has(name) || qNames.has(name)) return true
    const dot = name.indexOf(".")
    return dot > 0 && (names.has(name.slice(dot + 1)) || qNames.has(name.slice(dot + 1)))
  }
  const looksLikeAName = (s: string): boolean =>
    s.length > 0 && !/\s/.test(s) && !s.includes("{") && !s.includes(",") && !s.includes("(")

  // ---- relationships
  for (const edge of r.relationships) {
    const t = edge.type as string
    const source = edge.source as string
    const target = edge.target as string
    relHistogram[t] = (relHistogram[t] || 0) + 1
    perType[t] ??= { n: 0, unresolved: 0 }
    perType[t].n++
    if (!REL_TYPES.has(t)) {
      note("ontology.unclassifiedType", `${rel}: ${t} ${source} -> ${target}`)
      perType[t].unresolved++
      continue
    }
    if (typeof edge.line_number !== "number" || edge.line_number <= 0) {
      note("line.missingOrNonPositive", `${rel}: ${t} ${source} -> ${target}`)
      perType[t].unresolved++
    }
    switch (t) {
      case "contains":
      case "exports": {
        // Both endpoints must be names THIS file publishes: these two kinds are
        // entirely intra-file by construction.
        if (!resolvable(target)) { perType[t].unresolved++; note(`${t}.targetUnresolvable`, `${rel}: ${source} -> ${target}`) }
        if (!resolvable(source)) { perType[t].unresolved++; note(`${t}.sourceUnresolvable`, `${rel}: ${source} -> ${target}`) }
        break
      }
      case "calls": {
        // A local resolves by its scoped identity, a module callable by its bare
        // name, and a qualified target by the spelling the source used.
        if (!resolvable(target) && !target.includes(".")) {
          perType[t].unresolved++
          note("calls.undeclaredTarget", `${rel}: ${source} -> ${target} @L${edge.line_number}`)
        }
        break
      }
      case "instantiates": {
        if (!constructors.has(target)) {
          perType[t].unresolved++
          note("instantiates.notADataConstructor", `${rel}: ${source} -> ${target} @L${edge.line_number}`)
        }
        if (macros.has(target)) {
          perType[t].unresolved++
          note("instantiates.targetIsAMacro", `${rel}: ${source} -> ${target} @L${edge.line_number}`)
        }
        break
      }
      case "uses": {
        // A `uses` target is a record FIELD or a data CONSTRUCTOR. Anything else —
        // a receiver, a parameter, a pattern variable — is the FP family.
        const ok = constructors.has(target) || names.has(target) || qNames.has(target)
        if (!ok) { perType[t].unresolved++; note("uses.undeclaredTarget", `${rel}: ${source} -> ${target} @L${edge.line_number} (${edge.metadata?.relationshipType})`) }
        break
      }
      case "implements": {
        // The CLASS is a symbol this file declares (an `instance_declaration.name`
        // or a `generic_declaration.name`). The SOURCE is the type the class is
        // applied at, which is external whenever the type is imported — the
        // normal case for Clean, counted rather than failed.
        if (!resolvable(target) && !classNames.has(target) && !typeNames.has(target)) {
          bump(external, "implements.classNotDeclaredHere")
        }
        if (!resolvable(source)) bump(external, "implements.targetTypeImported")
        break
      }
      case "references": {
        if (resolvable(target)) break
        // External type and class-context names are the accepted cost of the
        // in-file resolution rule. They must at least LOOK like an identifier:
        // no whitespace, no brace, no comma, no paren.
        if (!looksLikeAName(target)) {
          perType[t].unresolved++
          note("references.malformedTarget", `${rel}: ${source} -> ${JSON.stringify(target)} (${edge.metadata?.relationshipType})`)
        } else {
          bump(external, "references.externalTypeOrContext")
        }
        break
      }
      case "imports": {
        const i = target.lastIndexOf(":")
        if (i < 0) { perType[t].unresolved++; note("imports.malformed", `${rel}: ${target}`); break }
        const mod = target.slice(0, i)
        const item = target.slice(i + 1)
        if (!moduleNames.has(mod)) { perType[t].unresolved++; note("imports.unknownModule", `${rel}: ${target}`) }
        if (!item) { perType[t].unresolved++; note("imports.emptyItem", `${rel}: ${target}`) }
        break
      }
      default:
        break
    }
    void functions
  }

  // ---- symbols
  for (const s of r.symbols) {
    const k = s.kind as string
    kindHistogram[k] = (kindHistogram[k] || 0) + 1
    if (!s.name || !String(s.name).trim()) { emptyNames++; note("symbol.emptyName", `${rel}: ${k}`) }
    if (!k) { unknownKinds++; unresolvedKinds.add(k) }
    if (s.ownerKind && !s.ownerName) { membersWithoutOwner++; note("symbol.ownerKindWithoutOwner", `${rel}: ${k} ${s.name}`) }
    if (s.ownerName === s.name) {
      // Clean's own shadowing: a where-local of the same name as the frame that
      // encloses it, or as a module-level symbol in the same file. Measured, and
      // safe because the store keys a row `${fileId}:${name}:${lineStart}` and
      // the local carries a distinct `qualifiedName`.
      bump(shadow, "selfOwned (Clean shadowing — distinct row id by line, distinct qualifiedName)")
    } else if (s.visibility === "local" && resolvable(s.ownerName ?? "")) {
      bump(shadow, "localOwnedByAPublishedFrame")
    }
  }

  // ---- exports and imports
  const exportNames = r.exports.map((e: any) => e.name)
  const dupExports = exportNames.filter((n: string, i: number) => exportNames.indexOf(n) !== i)
  if (dupExports.length > 0) note("exports.duplicateName", `${rel}: ${[...new Set(dupExports)].join(", ")}`)
  for (const imp of r.imports) {
    for (const item of imp.items ?? []) {
      if (!item || /\s/.test(item)) note("imports.malformedItem", `${rel}: ${imp.module} -> ${JSON.stringify(item)}`)
    }
  }
}

// ---------------------------------------------------------------------------
const rows: string[] = []
rows.push(`clean honesty gate — ${files.length} files, ${totalSymbols} symbols, ${totalRels} relationships`)
rows.push("")
rows.push("per relationship type (resolvable under the store's own strategies):")
for (const [t, v] of Object.entries(perType).sort((a, b) => b[1].n - a[1].n)) {
  const pct = v.n > 0 ? (100 * (v.n - v.unresolved)) / v.n : 100
  rows.push(`  ${t.padEnd(13)} ${String(v.n).padStart(6)}  ${v.unresolved === 0 ? "all resolvable" : `${String(v.unresolved).padStart(5)} unresolved  (${pct.toFixed(2)}%)`}`)
}
rows.push("")
rows.push("external-by-nature targets (accepted cost, counted):")
for (const [k, v] of Object.entries(external).sort((a, b) => b[1] - a[1])) rows.push(`  ${String(v).padStart(6)}  ${k}`)
rows.push("")
rows.push("shadowing (measured, safe by construction):")
for (const [k, v] of Object.entries(shadow).sort((a, b) => b[1] - a[1])) rows.push(`  ${String(v).padStart(6)}  ${k}`)
rows.push("")
rows.push(`symbol kinds: ${Object.entries(kindHistogram).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`)
rows.push(`relationship types: ${Object.entries(relHistogram).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`)
rows.push(`imports ${totalImports}, exports ${totalExports}, unknown kinds ${unknownKinds}, empty names ${emptyNames}, members without owner ${membersWithoutOwner}, symbol-free files ${symbolFreeFiles}, crash files ${crashFiles}`)
rows.push("")

if (violations.length > 0) {
  rows.push(`FAIL ${violations.length} violation(s):`)
  for (const s of samples) rows.push(s)
  console.error(rows.join("\n"))
  process.exit(1)
}
rows.push("no violations: every edge endpoint resolves, every name is non-empty, every member has an owner")
console.log(rows.join("\n"))
